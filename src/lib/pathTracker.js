import { pointAtLength, projectOntoPath } from './pathGeometry.js'

/**
 * Pure finger-tracing state machine. No Vue, no DOM.
 *
 * Works in pixel space against a geometry from `buildPathGeometry`, but keeps
 * progress as an arc-length fraction so it survives viewport resizes.
 *
 * Anti-shortcut strategy:
 *  - Tracing must begin near the start point.
 *  - The finger is only matched against a small arc-length window around the
 *    furthest validly traced point (the "frontier"), so jumping to a later part
 *    of the path, or straight to the destination, never matches.
 *  - Coverage is measured in bins that are only filled by continuous on-path
 *    forward movement; completion requires a minimum coverage.
 */

export const DEFAULT_RULES = {
  /** Path tolerance (max finger distance from the line) as a ratio of min(width, height), clamped in px. */
  tolerance: { ratio: 0.07, minPx: 28, maxPx: 72 },
  /** Between tolerance and tolerance * driftFactor the finger is "drifting": progress pauses but it is not a deviation. */
  driftFactor: 1.6,
  /** Touch-down radius around the start point (and resume point), in tolerance units. */
  startRadiusFactor: 1.4,
  /** Radius around the destination that counts as "reached", in tolerance units. */
  destinationRadiusFactor: 1.2,
  /** Minimum fraction of the path that must be traced on-path, in the forward direction. */
  minCoverage: 0.85,
  /** How far ahead / behind the frontier the finger may be matched, in tolerance units. */
  lookAheadFactor: 3,
  lookBehindFactor: 2.5,
  /** Lifting the finger keeps progress; touching down near the frontier resumes. */
  allowResume: true,
  /** Off-path excursions allowed before progress resets. Use Infinity to disable. */
  maxDeviations: 8,
  /** Number of coverage bins. */
  coverageBins: 80,
}

export function resolveRules(rules = {}) {
  return { ...DEFAULT_RULES, ...rules, tolerance: { ...DEFAULT_RULES.tolerance, ...rules.tolerance } }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

export function createPathTracker(userRules) {
  const rules = resolveRules(userRules)

  let geometry = null
  let tol = rules.tolerance.minPx

  // Progress is stored as fractions so resizes keep it.
  let frontier = 0 // furthest valid progress, 0..1
  let current = 0 // finger's matched progress, 0..1
  let bins = new Uint8Array(rules.coverageBins)
  let covered = 0
  let phase = 'idle' // idle | tracing | paused | complete
  let proximity = 'none' // none | on | drifting | off
  let deviations = 0
  let awaitingLift = false
  let lastSample = null
  let lastAccepted = null // last on-path matched progress during continuous movement
  let nearest = null
  let incompleteNotified = false

  function computeTolerance() {
    if (!geometry) return
    const { ratio, minPx, maxPx } = rules.tolerance
    tol = Math.min(maxPx, Math.max(minPx, Math.min(geometry.width, geometry.height) * ratio))
  }

  function setGeometry(g) {
    geometry = g
    computeTolerance()
    // Positions in px are now stale; force a fresh sample on the next move.
    lastSample = null
    lastAccepted = null
  }

  function markCoverage(from, to) {
    const n = bins.length
    const a = Math.max(0, Math.floor(Math.min(from, to) * n))
    const b = Math.min(n - 1, Math.floor(Math.max(from, to) * n - 1e-9))
    for (let i = a; i <= b; i++) {
      if (!bins[i]) {
        bins[i] = 1
        covered++
      }
    }
  }

  function clearProgress() {
    frontier = 0
    current = 0
    bins = new Uint8Array(rules.coverageBins)
    covered = 0
    deviations = 0
    lastSample = null
    lastAccepted = null
    nearest = null
    incompleteNotified = false
  }

  function reset() {
    clearProgress()
    phase = 'idle'
    proximity = 'none'
    awaitingLift = false
  }

  function snapshot(events = []) {
    return {
      events,
      phase,
      proximity,
      progress: frontier,
      current,
      coverage: covered / bins.length,
      deviations,
      tolerance: tol,
      nearest,
      frontierPoint: geometry ? pointAtLength(geometry, frontier * geometry.totalLength) : null,
    }
  }

  function processSample(p, events) {
    const total = geometry.totalLength
    const frontierLen = frontier * total
    const hit = projectOntoPath(
      geometry,
      p,
      frontierLen - tol * rules.lookBehindFactor,
      frontierLen + tol * rules.lookAheadFactor,
    )
    nearest = hit.point

    let next
    if (hit.distance <= tol) next = 'on'
    else if (hit.distance <= tol * rules.driftFactor) next = 'drifting'
    else next = 'off'

    if (next === 'off' && proximity !== 'off') {
      deviations++
      events.push('deviate')
      if (deviations > rules.maxDeviations) {
        clearProgress()
        phase = 'idle'
        proximity = 'none'
        awaitingLift = true
        events.push('reset')
        return
      }
    }
    if (next === 'on' && (proximity === 'off' || proximity === 'drifting')) events.push('return')
    proximity = next

    if (next !== 'on') {
      lastAccepted = null
      return
    }

    const progress = hit.length / total
    current = progress
    if (lastAccepted !== null && progress > lastAccepted) markCoverage(lastAccepted, progress)
    lastAccepted = progress
    if (progress > frontier) frontier = progress

    const reachedEnd =
      dist(p, geometry.end) <= tol * rules.destinationRadiusFactor &&
      frontier * total >= total - tol * rules.destinationRadiusFactor
    if (reachedEnd) {
      // Treat the tail inside the destination radius as traced.
      markCoverage(progress, 1)
      if (covered / bins.length >= rules.minCoverage) {
        frontier = 1
        current = 1
        phase = 'complete'
        events.push('complete')
      } else if (!incompleteNotified) {
        incompleteNotified = true
        events.push('incomplete')
      }
    }
  }

  function pointerDown(p) {
    if (!geometry || phase === 'complete') return snapshot()
    awaitingLift = false
    const events = []
    const radius = tol * rules.startRadiusFactor
    const nearStart = dist(p, geometry.start) <= radius
    const hasProgress = frontier > 0
    const resumePoint = pointAtLength(geometry, frontier * geometry.totalLength)
    const nearResume = hasProgress && rules.allowResume && dist(p, resumePoint) <= radius

    if (nearResume) {
      phase = 'tracing'
      events.push('resume')
    } else if (nearStart) {
      if (hasProgress) {
        clearProgress()
        events.push('reset')
      }
      phase = 'tracing'
      events.push('start')
    } else {
      if (hasProgress && !rules.allowResume) clearProgress()
      awaitingLift = true
      const nearEnd = dist(p, geometry.end) <= tol * rules.destinationRadiusFactor * 1.5
      events.push(nearEnd ? 'reject-shortcut' : 'reject-start')
      return snapshot(events)
    }

    proximity = 'none'
    lastSample = p
    lastAccepted = null
    processSample(p, events)
    return snapshot(events)
  }

  /** Accepts one point or an array of (coalesced) points, in order. */
  function pointerMove(input) {
    if (!geometry || phase !== 'tracing' || awaitingLift) return snapshot()
    const pts = Array.isArray(input) ? input : [input]
    const events = []
    const step = Math.max(4, tol / 2)
    for (const p of pts) {
      // Sub-sample long jumps so fast swipes are evaluated continuously.
      if (lastSample) {
        const d = dist(lastSample, p)
        const n = Math.min(64, Math.floor(d / step))
        for (let i = 1; i <= n && phase === 'tracing'; i++) {
          const t = i / (n + 1)
          processSample({ x: lastSample.x + (p.x - lastSample.x) * t, y: lastSample.y + (p.y - lastSample.y) * t }, events)
        }
      }
      if (phase !== 'tracing') break
      processSample(p, events)
      lastSample = p
      if (phase !== 'tracing') break
    }
    return snapshot(events)
  }

  function pointerUp() {
    const events = []
    awaitingLift = false
    lastSample = null
    lastAccepted = null
    if (phase === 'tracing') {
      if (frontier > 0 && rules.allowResume) {
        phase = 'paused'
        events.push('pause')
      } else {
        clearProgress()
        phase = 'idle'
        events.push('reset')
      }
    }
    if (phase !== 'complete') proximity = 'none'
    return snapshot(events)
  }

  return {
    rules,
    setGeometry,
    pointerDown,
    pointerMove,
    pointerUp,
    /** Pointer cancel behaves like a lift: progress is kept if resume is allowed. */
    cancel: pointerUp,
    reset,
    getState: () => snapshot(),
  }
}

const PROXIMITY_RANK = { on: 0, drifting: 1, off: 2, none: 3 }

/**
 * Tracks several paths at once (e.g. a fork with a victory and a failure
 * branch sharing the same start).
 *
 * Every path whose start (or resume point) is touched becomes a candidate.
 * Candidates are traced in parallel; once the finger is on one candidate and
 * off another, the stray one is dropped. The first candidate to complete
 * decides the outcome. Events and the main snapshot come from the "primary"
 * candidate: the one the finger is closest to following.
 *
 * Snapshots carry `pathId` (primary) and `progressById` (every path).
 */
export function createPathSetTracker(ids, userRules) {
  const trackers = new Map(ids.map((id) => [id, createPathTracker(userRules)]))
  let candidates = []
  let primary = ids[0]
  let completed = null

  const stateOf = (id, snaps) => snaps?.get(id) ?? trackers.get(id).getState()

  function pickPrimary(snaps) {
    if (completed) return completed
    const pool = candidates.length ? candidates : ids
    return [...pool].sort((a, b) => {
      const sa = stateOf(a, snaps)
      const sb = stateOf(b, snaps)
      return PROXIMITY_RANK[sa.proximity] - PROXIMITY_RANK[sb.proximity] || sb.progress - sa.progress
    })[0]
  }

  function combine(snaps, events) {
    primary = pickPrimary(snaps)
    const snap = stateOf(primary, snaps)
    const progressById = Object.fromEntries(ids.map((id) => [id, stateOf(id, snaps).progress]))
    return { ...snap, events: events ?? snap.events ?? [], pathId: primary, progressById }
  }

  function drop(id) {
    trackers.get(id).reset()
    candidates = candidates.filter((c) => c !== id)
  }

  function pointerDown(p) {
    if (completed) return combine(null, [])
    const snaps = new Map()
    const accepted = []
    for (const [id, t] of trackers) {
      const s = t.pointerDown(p)
      snaps.set(id, s)
      if (s.events.includes('start') || s.events.includes('resume')) accepted.push(id)
    }
    if (!accepted.length) {
      candidates = []
      const shortcut = [...snaps.values()].some((s) => s.events.includes('reject-shortcut'))
      return combine(snaps, [shortcut ? 'reject-shortcut' : 'reject-start'])
    }
    // Paths that did not accept this touch start over.
    for (const id of ids) if (!accepted.includes(id)) trackers.get(id).reset()
    candidates = accepted
    return combine(snaps)
  }

  function pointerMove(pts) {
    if (completed || !candidates.length) return combine(null, [])
    const snaps = new Map(candidates.map((id) => [id, trackers.get(id).pointerMove(pts)]))

    const done = candidates.find((id) => snaps.get(id).phase === 'complete')
    if (done) {
      completed = done
      for (const id of candidates) if (id !== done) trackers.get(id).reset()
      candidates = [done]
      return combine(snaps)
    }

    if (candidates.length > 1) {
      const anyOn = candidates.some((id) => snaps.get(id).proximity === 'on')
      for (const id of [...candidates]) {
        const s = snaps.get(id)
        const stray = (anyOn && s.proximity === 'off') || s.phase === 'idle'
        if (stray && candidates.length > 1) {
          drop(id)
          snaps.delete(id)
        }
      }
    }
    const result = combine(snaps)
    if (result.phase === 'idle') candidates = [] // reset after too many deviations
    return result
  }

  function pointerUp() {
    if (completed) return combine(null, [])
    const snaps = new Map(candidates.map((id) => [id, trackers.get(id).pointerUp()]))
    const result = combine(snaps)
    candidates = candidates.filter((id) => trackers.get(id).getState().progress > 0)
    return result
  }

  function reset() {
    for (const t of trackers.values()) t.reset()
    candidates = []
    completed = null
    primary = ids[0]
  }

  return {
    setGeometry: (id, g) => trackers.get(id).setGeometry(g),
    pointerDown,
    pointerMove,
    pointerUp,
    cancel: pointerUp,
    reset,
    getState: () => combine(null, []),
  }
}
