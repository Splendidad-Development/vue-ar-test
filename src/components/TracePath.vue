<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { usePathTracing } from '../composables/usePathTracing.js'

const props = defineProps({
  /** [{ id, outcome: 'victory' | 'failure', start, segments }] */
  paths: { type: Array, required: true },
  rules: { type: Object, default: () => ({}) },
  /** Show the same "?" marker on every destination. */
  disguise: { type: Boolean, default: false },
  /** Ignore input (e.g. after completion). */
  locked: { type: Boolean, default: false },
  /** Fade the paths into the background while content is shown. */
  dimmed: { type: Boolean, default: false },
})
const emit = defineEmits(['start', 'reset', 'complete'])

const region = ref(null)
const cursor = ref(null)
const tether = ref(null)
const progressBar = ref(null)
/** id → { fill, glow } SVG elements, updated per frame. */
const progressEls = {}
const setProgressEl = (id, kind) => (el) => {
  progressEls[id] ??= {}
  progressEls[id][kind] = el
}

const resumePoint = ref(null)
const flash = ref(null)
const shakeKey = ref(0)
let flashTimer = 0

const outcomeOf = (id) => props.paths.find((p) => p.id === id)?.outcome ?? 'victory'

const FLASH = {
  'reject-start': 'Start from the glowing point at the beginning',
  'reject-shortcut': 'No shortcuts — begin at the start point',
  return: 'Back on track!',
  reset: 'Too many detours — start again from the beginning',
  incomplete: 'Trace the whole path to reach the destination',
}

function showFlash(text, ms = 1600) {
  flash.value = text
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = null), ms)
}

function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* unsupported */
  }
}

function onEvent(name, snap) {
  if (import.meta.env.DEV) console.debug(`[trace] ${name}`, snap.pathId, Math.round(snap.progress * 100), snap.deviations)
  switch (name) {
    case 'start':
    case 'resume':
      resumePoint.value = null
      flash.value = null
      emit('start')
      break
    case 'deviate':
      resumePoint.value = snap.frontierPoint
      vibrate(15)
      break
    case 'pause':
      resumePoint.value = snap.frontierPoint
      break
    case 'return':
      resumePoint.value = null
      break
    case 'reset':
      resumePoint.value = null
      emit('reset')
      break
    case 'reject-start':
    case 'reject-shortcut':
      shakeKey.value++
      break
    case 'complete': {
      const outcome = outcomeOf(snap.pathId)
      resumePoint.value = null
      flash.value = null
      vibrate(outcome === 'victory' ? [30, 60, 40] : [120])
      emit('complete', { pathId: snap.pathId, outcome })
      break
    }
  }
  if (FLASH[name]) showFlash(FLASH[name], name === 'reset' ? 2400 : 1600)
}

/** Per-frame visuals are written straight to the DOM (no reactive churn). */
function onFrame({ progress, progressById, pointer, nearest, proximity }) {
  if (progressBar.value) progressBar.value.style.transform = `scaleX(${progress})`
  for (const [id, els] of Object.entries(progressEls)) {
    const p = progressById[id] ?? 0
    for (const el of [els.fill, els.glow]) {
      if (!el) continue
      el.style.strokeDashoffset = String(1 - p)
      el.style.opacity = p > 0.001 ? '1' : '0'
    }
  }
  if (cursor.value) {
    cursor.value.style.opacity = pointer ? '1' : '0'
    if (pointer) cursor.value.style.transform = `translate3d(${pointer.x}px, ${pointer.y}px, 0)`
  }
  if (tether.value) {
    const show = pointer && nearest && (proximity === 'drifting' || proximity === 'off')
    tether.value.style.opacity = show ? '1' : '0'
    if (show) {
      tether.value.setAttribute('x1', pointer.x)
      tether.value.setAttribute('y1', pointer.y)
      tether.value.setAttribute('x2', nearest.x)
      tether.value.setAttribute('y2', nearest.y)
    }
  }
}

const { layout, state, reset } = usePathTracing(region, {
  paths: props.paths,
  rules: props.rules,
  disabled: () => props.locked,
  onEvent,
  onFrame,
})

onBeforeUnmount(() => clearTimeout(flashTimer))

const complete = computed(() => state.phase === 'complete')
/** 'victory' | 'failure' once a destination is reached. */
const result = computed(() => (complete.value ? outcomeOf(state.pathId) : null))
const lineWidth = computed(() => Math.min(30, Math.max(14, state.tolerance * 0.55)))

const items = computed(() =>
  (layout.value ?? []).map((item) => ({
    ...item,
    outcome: outcomeOf(item.id),
    reached: complete.value && state.pathId === item.id,
  })),
)

/** Shared start points are drawn once. */
const starts = computed(() => {
  const seen = new Map()
  for (const { geometry } of items.value) {
    const key = `${Math.round(geometry.start.x)},${Math.round(geometry.start.y)}`
    if (!seen.has(key)) seen.set(key, geometry.start)
  }
  return [...seen.values()]
})

function gradientStops(item) {
  if (item.reached && item.outcome === 'failure') return ['#fda4af', '#f43f5e', '#be123c']
  if (item.reached) return ['#fde68a', '#fbbf24', '#f59e0b']
  return ['#22d3ee', '#38bdf8', '#e879f9']
}

function destinationLook(item) {
  if (item.reached) {
    return item.outcome === 'failure'
      ? { icon: 'cross', classes: 'scale-110 bg-gradient-to-br from-rose-400 to-rose-700 shadow-[0_0_40px_rgba(244,63,94,1)]', ring: '' }
      : { icon: 'star', classes: 'scale-125 bg-gradient-to-br from-amber-200 to-amber-500 shadow-[0_0_40px_rgba(253,230,138,1)]', ring: '' }
  }
  const dim = complete.value ? 'opacity-30 grayscale' : ''
  if (props.disguise) {
    return { icon: 'mystery', classes: `bg-gradient-to-br from-violet-400 to-indigo-600 shadow-[0_0_28px_rgba(167,139,250,0.85)] ${dim}`, ring: 'bg-violet-400/40' }
  }
  return item.outcome === 'failure'
    ? { icon: 'cross', classes: `bg-gradient-to-br from-rose-400 to-rose-600 shadow-[0_0_28px_rgba(244,63,94,0.8)] ${dim}`, ring: 'bg-rose-400/40' }
    : { icon: 'star', classes: `bg-gradient-to-br from-fuchsia-400 to-violet-600 shadow-[0_0_28px_rgba(232,121,249,0.85)] ${dim}`, ring: 'bg-fuchsia-400/40' }
}

const message = computed(() => {
  if (result.value === 'victory') return 'Destination reached!'
  if (result.value === 'failure') return 'Dead end!'
  // Live deviation feedback always wins over transient messages.
  if (state.phase === 'tracing' && state.proximity === 'off') return 'Off the path — slide back to the glowing marker'
  if (state.phase === 'tracing' && state.proximity === 'drifting') return 'Stay on the line'
  if (flash.value) return flash.value
  if (state.phase === 'paused') return 'Paused — touch the glowing marker to continue'
  if (state.phase === 'tracing') {
    if (state.percent >= 80) return 'Almost there!'
    return 'Nice — keep following the line'
  }
  return props.paths.length > 1
    ? 'Touch the start point, then choose a path and trace it'
    : 'Touch the glowing start point and trace the path'
})

const tone = computed(() => {
  if (result.value) return result.value
  if (state.phase === 'tracing') {
    if (state.proximity === 'off') return 'off'
    if (state.proximity === 'drifting') return 'drifting'
    return 'on'
  }
  return 'idle'
})

const cursorClass = computed(
  () =>
    ({
      on: 'border-cyan-300 bg-cyan-300/25 shadow-[0_0_24px_rgba(34,211,238,0.8)]',
      drifting: 'border-amber-300 bg-amber-300/25 shadow-[0_0_24px_rgba(252,211,77,0.8)]',
      off: 'border-rose-400 bg-rose-400/25 shadow-[0_0_24px_rgba(251,113,133,0.8)]',
      victory: 'border-amber-200 bg-amber-200/30 shadow-[0_0_28px_rgba(253,230,138,0.9)]',
      failure: 'border-rose-300 bg-rose-500/30 shadow-[0_0_28px_rgba(244,63,94,0.9)]',
      idle: 'border-white/80 bg-white/20',
    })[tone.value],
)

const toneTextClass = computed(
  () =>
    ({
      on: 'text-cyan-100',
      drifting: 'text-amber-100',
      off: 'text-rose-100',
      victory: 'text-amber-100',
      failure: 'text-rose-200',
      idle: 'text-white',
    })[tone.value],
)

const sparks = Array.from({ length: 14 }, (_, i) => ({
  angle: `${(360 / 14) * i}deg`,
  dist: `${70 + (i % 3) * 22}px`,
  color: ['bg-amber-200', 'bg-cyan-300', 'bg-fuchsia-300'][i % 3],
}))

defineExpose({ reset })
</script>

<template>
  <div
    class="pointer-events-none absolute inset-0 transition-opacity duration-1000"
    :class="dimmed ? 'opacity-30' : 'opacity-100'"
    :data-result="result"
  >
    <!-- Progress indicator -->
    <div
      class="absolute left-1/2 top-[calc(env(safe-area-inset-top)+1rem)] w-[min(18rem,calc(100%-9rem))] -translate-x-1/2 transition-opacity duration-500 [@media(max-height:500px)]:top-3"
      :class="dimmed && 'opacity-0'"
    >
      <div class="rounded-full border border-white/15 bg-slate-950/55 px-4 py-2 shadow-lg backdrop-blur-md">
        <div class="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
          <span>{{ result === 'failure' ? 'Dead end' : complete ? 'Complete' : 'Trace the path' }}</span>
          <span class="tabular-nums text-white">{{ state.percent }}%</span>
        </div>
        <div
          class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/15"
          role="progressbar"
          aria-label="Path progress"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="state.percent"
        >
          <div
            ref="progressBar"
            class="h-full origin-left scale-x-0 rounded-full bg-gradient-to-r will-change-transform"
            :class="
              result === 'failure'
                ? 'from-rose-300 via-rose-500 to-rose-700'
                : complete
                  ? 'from-amber-200 via-amber-300 to-amber-400'
                  : 'from-cyan-300 via-sky-400 to-fuchsia-400'
            "
          />
        </div>
      </div>
    </div>

    <!-- Interactive tracing region (touch-action: none only here) -->
    <div
      ref="region"
      class="absolute inset-x-5 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] top-[calc(env(safe-area-inset-top)+5.5rem)] mx-auto max-w-3xl touch-none select-none [@media(max-height:500px)]:bottom-14 [@media(max-height:500px)]:top-16"
      :class="[locked ? 'pointer-events-none' : 'pointer-events-auto cursor-crosshair', result === 'failure' && 'animate-shake']"
      data-testid="trace-region"
    >
      <svg
        v-if="items.length"
        class="absolute inset-0 h-full w-full overflow-visible"
        :viewBox="`0 0 ${items[0].geometry.width} ${items[0].geometry.height}`"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            v-for="item in items"
            :id="`trace-progress-${item.id}`"
            :key="item.id"
            gradientUnits="userSpaceOnUse"
            :x1="item.geometry.start.x"
            :y1="item.geometry.start.y"
            :x2="item.geometry.end.x"
            :y2="item.geometry.end.y"
          >
            <stop v-for="(color, i) in gradientStops(item)" :key="i" :offset="i / 2" :stop-color="color" />
          </linearGradient>
        </defs>

        <!-- Layers are drawn across all paths so shared segments blend cleanly. -->
        <g fill="none" stroke-linecap="round" stroke-linejoin="round">
          <!-- Dark outline + white core: readable on light and dark scenes -->
          <path v-for="item in items" :key="`o-${item.id}`" :d="item.geometry.d" stroke="rgba(2,6,23,0.55)" :stroke-width="lineWidth + 8" />
          <path
            v-for="item in items"
            :key="`b-${item.id}`"
            :d="item.geometry.d"
            stroke="white"
            :stroke-opacity="complete && !item.reached ? 0.35 : 0.85"
            :stroke-width="lineWidth"
          />
          <!-- Flowing dashes hint at the direction of travel -->
          <path
            v-for="item in items"
            :key="`f-${item.id}`"
            :d="item.geometry.d"
            class="animate-path-flow"
            stroke="#0ea5e9"
            stroke-opacity="0.75"
            :stroke-width="Math.max(3, lineWidth * 0.22)"
            stroke-dasharray="2 22"
          />
        </g>

        <!-- Direction chevrons (covered by the progress fill as it advances) -->
        <g fill="none" stroke="rgba(15,23,42,0.75)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <template v-for="item in items" :key="`m-${item.id}`">
            <path
              v-for="m in item.markers"
              :key="m.length"
              d="M -4 -6 L 3 0 L -4 6"
              :transform="`translate(${m.x} ${m.y}) rotate(${m.angle})`"
            />
          </template>
        </g>

        <!-- Progress per path (dash offset driven per frame) -->
        <g v-for="item in items" :key="`p-${item.id}`" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path
            :ref="setProgressEl(item.id, 'glow')"
            :d="item.geometry.d"
            :stroke="`url(#trace-progress-${item.id})`"
            stroke-opacity="0.35"
            :stroke-width="lineWidth * 2.2"
            pathLength="1"
            stroke-dasharray="1 1"
            style="stroke-dashoffset: 1; opacity: 0"
          />
          <path
            :ref="setProgressEl(item.id, 'fill')"
            :d="item.geometry.d"
            :stroke="`url(#trace-progress-${item.id})`"
            :stroke-width="lineWidth"
            pathLength="1"
            stroke-dasharray="1 1"
            style="stroke-dashoffset: 1; opacity: 0"
          />
        </g>

        <!-- Deviation tether from finger to nearest point on the path -->
        <line
          ref="tether"
          :stroke="tone === 'off' ? '#fb7185' : '#fcd34d'"
          stroke-width="3"
          stroke-dasharray="6 6"
          stroke-linecap="round"
          style="opacity: 0"
        />

        <!-- Idle guide: lights travel from the start to each destination -->
        <template v-if="state.phase === 'idle' && !state.touching">
          <circle v-for="(item, i) in items" :key="`g-${item.id}-${item.geometry.d}`" :r="lineWidth * 0.4" fill="white" opacity="0">
            <animateMotion :path="item.geometry.d" dur="3s" :begin="`${i * 1.5}s`" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="3s" :begin="`${i * 1.5}s`" repeatCount="indefinite" />
          </circle>
        </template>
      </svg>

      <!-- Start marker(s) -->
      <div
        v-for="(start, i) in starts"
        :key="`s-${i}`"
        class="absolute -translate-x-1/2 -translate-y-1/2 transition-opacity duration-300"
        :style="{ left: `${start.x}px`, top: `${start.y}px` }"
        :class="state.phase !== 'idle' && 'opacity-70'"
      >
        <span v-if="state.phase === 'idle'" class="absolute inset-0 animate-pulse-ring rounded-full bg-cyan-300/60" />
        <span
          :key="shakeKey"
          class="relative grid h-11 w-11 place-items-center rounded-full border-[3px] border-white bg-cyan-400 shadow-[0_0_24px_rgba(34,211,238,0.9)]"
          :class="shakeKey && 'animate-shake'"
        >
          <span class="h-3 w-3 rounded-full bg-white" />
        </span>
        <span
          v-if="state.phase === 'idle'"
          class="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-950/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur"
        >
          Start here
        </span>
      </div>

      <!-- Destination markers -->
      <div
        v-for="item in items"
        :key="`d-${item.id}`"
        class="absolute -translate-x-1/2 -translate-y-1/2"
        :style="{ left: `${item.geometry.end.x}px`, top: `${item.geometry.end.y}px` }"
        :data-testid="`destination-${item.outcome}`"
      >
        <span
          v-if="!complete"
          class="absolute inset-0 animate-pulse-ring rounded-full"
          :class="state.pathId === item.id && state.percent >= 80 ? 'bg-amber-300/70' : destinationLook(item).ring"
        />
        <template v-if="item.reached && item.outcome === 'victory'">
          <span class="absolute inset-0 animate-burst rounded-full border-4 border-amber-200" />
          <span class="absolute inset-0 animate-burst rounded-full bg-amber-200/40 [animation-delay:150ms]" />
          <span
            v-for="(s, i) in sparks"
            :key="i"
            class="absolute left-1/2 top-1/2 -ml-1 -mt-1 h-2 w-2 animate-spark rounded-full"
            :class="s.color"
            :style="{ '--angle': s.angle, '--dist': s.dist }"
          />
        </template>
        <template v-if="item.reached && item.outcome === 'failure'">
          <span class="absolute inset-0 animate-burst rounded-full border-4 border-rose-400" />
          <span class="absolute inset-0 animate-burst rounded-full bg-rose-600/50 [animation-delay:120ms]" />
        </template>
        <span
          class="relative grid h-14 w-14 place-items-center rounded-full border-[3px] border-white transition-all duration-500"
          :class="destinationLook(item).classes"
        >
          <svg v-if="destinationLook(item).icon === 'star'" viewBox="0 0 24 24" class="h-7 w-7 text-white" fill="currentColor" aria-hidden="true">
            <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5z" />
          </svg>
          <svg
            v-else-if="destinationLook(item).icon === 'cross'"
            viewBox="0 0 24 24"
            class="h-7 w-7 text-white"
            fill="none"
            stroke="currentColor"
            stroke-width="3.2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
          </svg>
          <span v-else class="text-2xl font-black text-white" aria-hidden="true">?</span>
        </span>
      </div>

      <!-- Where to come back to after leaving the path or lifting the finger -->
      <div
        v-if="resumePoint && !complete"
        class="absolute -translate-x-1/2 -translate-y-1/2"
        :style="{ left: `${resumePoint.x}px`, top: `${resumePoint.y}px` }"
      >
        <span class="absolute inset-0 animate-pulse-ring rounded-full bg-amber-300/70" />
        <span class="relative block h-8 w-8 rounded-full border-[3px] border-white bg-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.9)]" />
      </div>

      <!-- Finger feedback, positioned per frame -->
      <div
        ref="cursor"
        class="pointer-events-none absolute left-0 top-0 opacity-0 transition-opacity duration-150 will-change-transform"
      >
        <div class="-ml-8 -mt-8 h-16 w-16 rounded-full border-[3px] transition-colors duration-150" :class="cursorClass" />
      </div>
    </div>

    <!-- Status message -->
    <div
      class="absolute inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] flex justify-center transition-opacity duration-500 [@media(max-height:500px)]:bottom-3"
      :class="dimmed && 'opacity-0'"
    >
      <p
        class="max-w-sm rounded-2xl border border-white/15 bg-slate-950/60 px-4 py-2.5 text-center text-sm font-medium shadow-lg backdrop-blur-md transition-colors"
        :class="toneTextClass"
        role="status"
        aria-live="polite"
        data-testid="trace-message"
      >
        {{ message }}
      </p>
    </div>
  </div>
</template>
