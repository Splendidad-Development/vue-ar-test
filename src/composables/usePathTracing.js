import { onBeforeUnmount, onMounted, reactive, shallowRef } from 'vue'
import { buildPathGeometry, directionMarkers } from '../lib/pathGeometry.js'
import { createPathSetTracker } from '../lib/pathTracker.js'

/**
 * Connects the pure path-set tracker to a DOM region. Supports one or more
 * paths (e.g. a fork with victory and failure branches).
 *
 * - Pointer events on `regionRef` (single active pointer, coalesced events).
 * - Rebuilds geometry when the region resizes (rotation, browser resize).
 * - Reactive `state` changes only when a value actually changes (phase,
 *   proximity, whole-percent progress); per-move visuals are pushed through
 *   `onFrame`, which runs inside a requestAnimationFrame loop that only runs
 *   while something is moving.
 *
 * @param {import('vue').Ref<HTMLElement|null>} regionRef
 * @param {{
 *   paths: { id: string }[],   path definitions (see src/config/destinations.js)
 *   rules?: object,
 *   disabled?: () => boolean,
 *   onEvent?: (name: string, snapshot: object) => void,
 *   onFrame?: (frame: { progress: number, progressById: Record<string, number>, pointer: {x,y}|null, nearest: {x,y}|null, proximity: string }) => void,
 * }} options
 */
export function usePathTracing(regionRef, { paths, rules, disabled = () => false, onEvent, onFrame }) {
  const ids = paths.map((p) => p.id)
  const tracker = createPathSetTracker(ids, rules)
  /** [{ id, definition, geometry, markers }] — rebuilt on resize. */
  const layout = shallowRef(null)
  const state = reactive({
    pathId: ids[0],
    phase: 'idle',
    proximity: 'none',
    percent: 0,
    coverage: 0,
    deviations: 0,
    tolerance: 0,
    touching: false,
  })

  // Non-reactive per-frame data.
  let rect = null
  let pointer = null
  let nearest = null
  // Per-path progress: target from the tracker, display eased towards it.
  const target = Object.fromEntries(ids.map((id) => [id, 0]))
  const display = { ...target }
  let activePointerId = null
  let raf = 0
  let lastFrameTime = 0
  let resizeObserver = null

  function requestFrame() {
    if (!raf) raf = requestAnimationFrame(renderFrame)
  }

  function renderFrame(now) {
    raf = 0
    const dt = lastFrameTime ? Math.min(0.1, (now - lastFrameTime) / 1000) : 1 / 60
    lastFrameTime = now
    // Exponential smoothing (~55 ms time constant): fluid but never laggy.
    const k = 1 - Math.exp(-dt * 18)
    let moving = false
    for (const id of ids) {
      const diff = target[id] - display[id]
      display[id] = Math.abs(diff) < 0.0005 ? target[id] : display[id] + diff * k
      if (display[id] !== target[id]) moving = true
    }
    onFrame?.({ progress: display[state.pathId], progressById: display, pointer, nearest, proximity: state.proximity })
    if (moving) requestFrame()
    else lastFrameTime = 0
  }

  function apply(snap) {
    state.pathId = snap.pathId
    state.phase = snap.phase
    state.proximity = snap.proximity
    state.percent = Math.round(snap.progress * 100)
    state.coverage = Math.round(snap.coverage * 100) / 100
    state.deviations = snap.deviations
    state.tolerance = Math.round(snap.tolerance)
    Object.assign(target, snap.progressById)
    nearest = snap.proximity === 'none' ? null : snap.nearest
    for (const name of snap.events) onEvent?.(name, snap)
    requestFrame()
  }

  /** Client coords → normalized (0..1) in the region → geometry pixels. */
  function toLocal(e) {
    const g = layout.value[0].geometry
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height
    return { x: nx * g.width, y: ny * g.height }
  }

  function releasePointer() {
    const el = regionRef.value
    const id = activePointerId
    // Clear first so a synchronous lostpointercapture is ignored.
    activePointerId = null
    if (id !== null && el?.hasPointerCapture?.(id)) el.releasePointerCapture(id)
    pointer = null
    state.touching = false
  }

  function onPointerDown(e) {
    if (activePointerId !== null || !layout.value || disabled()) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    rect = regionRef.value.getBoundingClientRect()
    activePointerId = e.pointerId
    regionRef.value.setPointerCapture?.(e.pointerId)
    state.touching = true
    pointer = toLocal(e)
    apply(tracker.pointerDown(pointer))
  }

  function onPointerMove(e) {
    if (e.pointerId !== activePointerId || !layout.value) return
    const coalesced = e.getCoalescedEvents?.()
    const pts = (coalesced?.length ? coalesced : [e]).map(toLocal)
    pointer = pts[pts.length - 1]
    apply(tracker.pointerMove(pts))
  }

  function onPointerEnd(e) {
    if (e.pointerId !== activePointerId) return
    releasePointer()
    apply(tracker.pointerUp())
  }

  /** Window blur, tab switch, or geometry change while touching: treat as a lift. */
  function interrupt() {
    if (activePointerId === null) return
    releasePointer()
    apply(tracker.cancel())
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') interrupt()
  }

  function rebuild() {
    const el = regionRef.value
    if (!el) return
    rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return
    interrupt()
    const built = paths.map((definition) => {
      const geometry = buildPathGeometry(definition, rect.width, rect.height)
      tracker.setGeometry(definition.id, geometry)
      return { id: definition.id, definition, geometry }
    })
    const snap = tracker.getState()
    for (const item of built) item.markers = directionMarkers(item.geometry, Math.max(44, snap.tolerance * 2.2))
    layout.value = built
    // Jump the display straight to the current progress after a resize.
    Object.assign(display, snap.progressById)
    apply(snap)
  }

  function reset() {
    releasePointer()
    tracker.reset()
    apply(tracker.getState())
  }

  onMounted(() => {
    const el = regionRef.value
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerEnd)
    el.addEventListener('pointercancel', onPointerEnd)
    el.addEventListener('lostpointercapture', onPointerEnd)
    window.addEventListener('blur', interrupt)
    document.addEventListener('visibilitychange', onVisibilityChange)
    resizeObserver = new ResizeObserver(rebuild)
    resizeObserver.observe(el)
    rebuild()
  })

  onBeforeUnmount(() => {
    const el = regionRef.value
    releasePointer()
    el?.removeEventListener('pointerdown', onPointerDown)
    el?.removeEventListener('pointermove', onPointerMove)
    el?.removeEventListener('pointerup', onPointerEnd)
    el?.removeEventListener('pointercancel', onPointerEnd)
    el?.removeEventListener('lostpointercapture', onPointerEnd)
    window.removeEventListener('blur', interrupt)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    resizeObserver?.disconnect()
    cancelAnimationFrame(raf)
    raf = 0
  })

  return { layout, state, reset }
}
