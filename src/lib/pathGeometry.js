/**
 * Pure path geometry. No Vue, no DOM.
 *
 * A path definition uses normalized coordinates (0..1) relative to the
 * overlay region:
 *   {
 *     start: { x, y },
 *     segments: [
 *       { type: 'line', to: { x, y } },
 *       { type: 'quadratic', control: { x, y }, to: { x, y } },
 *       { type: 'cubic', control1: { x, y }, control2: { x, y }, to: { x, y } },
 *     ],
 *   }
 *
 * `buildPathGeometry` maps it to pixels for a given region size and flattens
 * it into a densely sampled polyline with cumulative arc lengths, which is
 * what all tracking calculations operate on.
 */

const SAMPLE_SPACING_PX = 4

const toPx = (p, width, height) => ({ x: p.x * width, y: p.y * height })

function quadraticAt(p0, c, p1, t) {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  }
}

function cubicAt(p0, c1, c2, p1, t) {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

function segmentEvaluator(from, seg, width, height) {
  const to = toPx(seg.to, width, height)
  switch (seg.type) {
    case 'quadratic': {
      const c = toPx(seg.control, width, height)
      return { to, at: (t) => quadraticAt(from, c, to, t), approxLength: dist(from, c) + dist(c, to) }
    }
    case 'cubic': {
      const c1 = toPx(seg.control1, width, height)
      const c2 = toPx(seg.control2, width, height)
      return {
        to,
        at: (t) => cubicAt(from, c1, c2, to, t),
        approxLength: dist(from, c1) + dist(c1, c2) + dist(c2, to),
      }
    }
    case 'line':
    default:
      return {
        to,
        at: (t) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }),
        approxLength: dist(from, to),
      }
  }
}

/** SVG `d` attribute for the definition, in pixels, using exact curves. */
export function toSvgPathData(definition, width, height) {
  const s = toPx(definition.start, width, height)
  const f = (n) => n.toFixed(2)
  let d = `M ${f(s.x)} ${f(s.y)}`
  for (const seg of definition.segments) {
    const to = toPx(seg.to, width, height)
    if (seg.type === 'quadratic') {
      const c = toPx(seg.control, width, height)
      d += ` Q ${f(c.x)} ${f(c.y)} ${f(to.x)} ${f(to.y)}`
    } else if (seg.type === 'cubic') {
      const c1 = toPx(seg.control1, width, height)
      const c2 = toPx(seg.control2, width, height)
      d += ` C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(to.x)} ${f(to.y)}`
    } else {
      d += ` L ${f(to.x)} ${f(to.y)}`
    }
  }
  return d
}

/**
 * Flatten a path definition into a pixel-space polyline.
 * @returns {{ width, height, points: {x,y}[], lengths: number[], totalLength: number, start, end, d: string }}
 */
export function buildPathGeometry(definition, width, height) {
  if (!definition?.start || !definition.segments?.length) {
    throw new Error('Path definition needs a start point and at least one segment')
  }
  const start = toPx(definition.start, width, height)
  const points = [start]
  let from = start
  for (const seg of definition.segments) {
    const ev = segmentEvaluator(from, seg, width, height)
    const steps = Math.max(1, Math.ceil(ev.approxLength / SAMPLE_SPACING_PX))
    for (let i = 1; i <= steps; i++) points.push(ev.at(i / steps))
    from = ev.to
  }

  const lengths = new Float64Array(points.length)
  for (let i = 1; i < points.length; i++) {
    lengths[i] = lengths[i - 1] + dist(points[i - 1], points[i])
  }
  const totalLength = lengths[points.length - 1]

  return {
    width,
    height,
    points,
    lengths,
    totalLength,
    start,
    end: points[points.length - 1],
    d: toSvgPathData(definition, width, height),
  }
}

/**
 * Nearest point on the polyline to `p`, optionally restricted to the arc
 * length window [minLen, maxLen]. Restricting the window is what keeps
 * tracking local: a finger cannot "snap" to a far-away part of the path.
 * @returns {{ point: {x,y}, length: number, distance: number }}
 */
export function projectOntoPath(geometry, p, minLen = 0, maxLen = Infinity) {
  const { points, lengths } = geometry
  const lo = Math.max(0, minLen)
  const hi = Math.min(geometry.totalLength, maxLen)
  let best = { point: points[0], length: 0, distance: Infinity }

  for (let i = 1; i < points.length; i++) {
    const segStart = lengths[i - 1]
    const segEnd = lengths[i]
    if (segEnd < lo || segStart > hi) continue

    const a = points[i - 1]
    const b = points[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const segLen2 = dx * dx + dy * dy
    let t = segLen2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / segLen2 : 0

    // Clamp t so the projection stays inside the allowed window.
    const segLen = segEnd - segStart
    const tMin = segLen > 0 ? Math.max(0, (lo - segStart) / segLen) : 0
    const tMax = segLen > 0 ? Math.min(1, (hi - segStart) / segLen) : 1
    t = Math.min(tMax, Math.max(tMin, t))

    const q = { x: a.x + dx * t, y: a.y + dy * t }
    const d = dist(p, q)
    if (d < best.distance) best = { point: q, length: segStart + segLen * t, distance: d }
  }
  return best
}

/** Point and tangent angle (radians) at a given arc length. */
export function pointAtLength(geometry, length) {
  const { points, lengths, totalLength } = geometry
  const L = Math.min(totalLength, Math.max(0, length))
  // Binary search for the segment containing L.
  let lo = 1
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (lengths[mid] < L) lo = mid + 1
    else hi = mid
  }
  const a = points[lo - 1]
  const b = points[lo]
  const segLen = lengths[lo] - lengths[lo - 1]
  const t = segLen > 0 ? (L - lengths[lo - 1]) / segLen : 0
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  }
}

/** Evenly spaced direction markers along the path (excluding the ends). */
export function directionMarkers(geometry, spacingPx) {
  const markers = []
  const { totalLength } = geometry
  if (!(spacingPx > 0) || totalLength < spacingPx * 2) return markers
  const count = Math.floor(totalLength / spacingPx) - 1
  const offset = (totalLength - (count - 1) * spacingPx) / 2
  for (let i = 0; i < count; i++) {
    const length = offset + i * spacingPx
    const p = pointAtLength(geometry, length)
    markers.push({ length, progress: length / totalLength, x: p.x, y: p.y, angle: (p.angle * 180) / Math.PI })
  }
  return markers
}
