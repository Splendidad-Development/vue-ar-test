<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import CameraBackground from '../components/CameraBackground.vue'
import DestinationContent from '../components/DestinationContent.vue'
import TracePath from '../components/TracePath.vue'
import { cameraError, useCamera } from '../composables/useCamera.js'
import { useExperienceState } from '../composables/useExperienceState.js'
import {
  defaultDestinationId,
  destinations,
  failureDestination,
  forkOptions,
  tracePaths,
  traceRules,
} from '../config/destinations.js'

const { state, can, is, transition } = useExperienceState()
const {
  stream,
  facingMode,
  error: cameraFailure,
  start: startCamera,
  stop: stopCamera,
} = useCamera({ onEnded: (err) => fail(err) })

const error = ref(null)
const destinationId = ref(defaultDestinationId)
const victoryDestination = computed(() => destinations[destinationId.value])
const destinationOptions = Object.values(destinations)
/** Which content to reveal: the selected victory reward or the failure content. */
const outcome = ref(null)
const revealed = computed(() => (outcome.value === 'failure' ? failureDestination : victoryDestination.value))

/** Bumped on restart/exit so the path and content remount with fresh state. */
const session = ref(0)
const contentVisible = ref(false)
let revealTimer = 0

/** Outcomes may be swapped between branches each attempt (forkOptions.shuffle). */
function arrangePaths() {
  if (!forkOptions.shuffle || Math.random() < 0.5) return tracePaths
  const outcomes = tracePaths.map((p) => p.outcome).reverse()
  return tracePaths.map((p, i) => ({ ...p, outcome: outcomes[i] }))
}
const paths = ref(arrangePaths())

const secure = typeof window !== 'undefined' && window.isSecureContext
const inExperience = computed(() => is('ready', 'tracing', 'success', 'failure'))
const finished = computed(() => is('success', 'failure'))
const connecting = computed(() => is('requesting-permission', 'loading-camera'))
// Mirror front-facing cameras (incl. most laptop webcams) so movement feels natural.
const mirrored = computed(
  () => facingMode.value === 'user' || (facingMode.value == null && !window.matchMedia?.('(pointer: coarse)').matches),
)

function resetSession() {
  clearTimeout(revealTimer)
  contentVisible.value = false
  outcome.value = null
  paths.value = arrangePaths()
  session.value++
}

/** Trace again without restarting the camera. */
function tryAgain() {
  if (!finished.value) return
  resetSession()
  transition('ready')
}

async function start() {
  if (!transition('requesting-permission')) return
  error.value = null
  const result = await startCamera()
  if (result === 'cancelled') return
  if (result === 'error') return fail(cameraFailure.value)
  transition('loading-camera')
}

function fail(err) {
  stopCamera()
  resetSession()
  error.value = err ?? cameraError('unknown')
  transition('error')
}

/** Restart (and retry after an error): release the camera and run the flow again. */
function restart() {
  if (!can('requesting-permission')) return
  stopCamera()
  resetSession()
  start()
}

function exit() {
  stopCamera()
  resetSession()
  error.value = null
  transition('welcome')
}

function onCameraPlaying() {
  if (is('loading-camera') && transition('ready')) prefetchContent()
}

function onCameraError(err) {
  if (is('loading-camera', 'ready', 'tracing', 'success', 'failure')) fail(cameraError('playback', err))
}

function onTraceStart() {
  if (is('ready')) transition('tracing')
}

function onTraceReset() {
  if (is('tracing')) transition('ready')
}

function onTraceComplete({ outcome: result }) {
  if (!transition(result === 'failure' ? 'failure' : 'success')) return
  outcome.value = result
  revealTimer = setTimeout(() => (contentVisible.value = true), 900)
}

/** Warm the HTTP cache while the user traces so the reveal is instant. */
function prefetchContent() {
  failureDestination.images?.forEach((img) => (new Image().src = img.src))
  const d = victoryDestination.value
  if (d.mode !== '3d') d.images?.forEach((img) => (new Image().src = img.src))
  if (d.mode !== '2d' && d.models?.length) {
    import('../components/ThreeScene.vue').catch(() => {})
    d.models.forEach((m) => fetch(m.src).catch(() => {}))
  }
}

onBeforeUnmount(() => clearTimeout(revealTimer))

const steps = [
  { title: 'Allow camera', text: 'Your surroundings become the backdrop.', icon: 'camera' },
  { title: 'Choose a trail', text: 'Two paths fork from the start — trace one with your finger.', icon: 'finger' },
  { title: 'Find the reward', text: 'One trail leads to treasure, the other to a dead end.', icon: 'star' },
]

const btn =
  'grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-slate-950/45 text-white shadow-lg backdrop-blur-md outline-none transition hover:bg-slate-900/70 active:scale-95 focus-visible:ring-4 focus-visible:ring-cyan-300/80'
const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-fuchsia-500 px-8 py-4 text-base font-bold text-white shadow-[0_10px_40px_-8px_rgba(56,189,248,0.8)] outline-none transition hover:brightness-110 active:scale-[0.98] focus-visible:ring-4 focus-visible:ring-white/80 disabled:opacity-60'
const secondaryBtn =
  'inline-flex items-center justify-center rounded-full border border-white/25 bg-white/10 px-6 py-3 text-sm font-semibold text-white outline-none transition hover:bg-white/20 active:scale-[0.98] focus-visible:ring-4 focus-visible:ring-cyan-300/80'
</script>

<template>
  <main class="fixed inset-0 select-none overflow-hidden bg-slate-950 font-sans text-white" :data-state="state">
    <!-- Live camera (behind everything) -->
    <CameraBackground v-if="stream" :stream="stream" :mirrored="mirrored" @playing="onCameraPlaying" @error="onCameraError" />

    <!-- Tracing + destination -->
    <template v-if="inExperience">
      <TracePath
        :key="`path-${session}`"
        class="z-10"
        :paths="paths"
        :rules="traceRules"
        :disguise="forkOptions.disguise"
        :locked="finished"
        :dimmed="contentVisible"
        @start="onTraceStart"
        @reset="onTraceReset"
        @complete="onTraceComplete"
      />

      <!-- Completion flash: gold for victory, red for failure -->
      <div
        v-if="finished"
        :key="`flash-${session}`"
        class="pointer-events-none absolute inset-0 z-10"
        :class="
          is('success')
            ? 'animate-[burst_1.2s_ease-out_forwards] bg-[radial-gradient(circle_at_center,rgba(253,230,138,0.35),transparent_60%)]'
            : 'animate-fade-out bg-[radial-gradient(circle_at_center,transparent_30%,rgba(225,29,72,0.45)_100%)]'
        "
      />

      <Transition
        enter-active-class="transition-opacity duration-700"
        enter-from-class="opacity-0"
        leave-active-class="pointer-events-none transition-opacity duration-300"
        leave-to-class="opacity-0"
      >
        <DestinationContent
          v-if="contentVisible && finished"
          :key="`content-${session}`"
          class="z-20"
          :destination="revealed"
        >
          <button type="button" :class="[secondaryBtn, 'pointer-events-auto mt-3 [@media(max-height:500px)]:mt-1.5 [@media(max-height:500px)]:py-2']" data-testid="try-again" @click="tryAgain">
            {{ is('failure') ? 'Try again' : 'Play again' }}
          </button>
        </DestinationContent>
      </Transition>
    </template>

    <!-- Floating controls -->
    <div
      v-if="inExperience || connecting"
      class="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-between px-[max(1rem,env(safe-area-inset-left))] pt-[calc(env(safe-area-inset-top)+1rem)] [@media(max-height:500px)]:pt-3"
    >
      <button
        v-if="inExperience"
        type="button"
        :class="[btn, 'pointer-events-auto']"
        aria-label="Restart experience"
        title="Restart"
        data-testid="restart"
        @click="restart"
      >
        <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
        </svg>
      </button>
      <span v-else />
      <button type="button" :class="[btn, 'pointer-events-auto']" aria-label="Exit experience" title="Exit" data-testid="exit" @click="exit">
        <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>

    <!-- Connecting to the camera -->
    <Transition enter-active-class="transition-opacity duration-300" enter-from-class="opacity-0" leave-active-class="pointer-events-none transition-opacity duration-500" leave-to-class="opacity-0">
      <div v-if="connecting" class="absolute inset-0 z-40 grid place-items-center bg-slate-950/70 px-6 backdrop-blur-sm">
        <div class="flex max-w-xs flex-col items-center text-center" role="status" aria-live="polite">
          <span class="relative mb-5 grid h-16 w-16 place-items-center">
            <span class="absolute inset-0 animate-spin rounded-full border-4 border-white/15 border-t-cyan-300" />
            <svg viewBox="0 0 24 24" class="h-7 w-7 text-cyan-200" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </span>
          <p class="text-lg font-semibold">
            {{ is('requesting-permission') ? 'Waiting for camera permission…' : 'Starting camera…' }}
          </p>
          <p class="mt-1 text-sm text-white/70">
            {{ is('requesting-permission') ? 'Choose “Allow” when your browser asks.' : 'Just a moment.' }}
          </p>
        </div>
      </div>
    </Transition>

    <!-- Error -->
    <div v-if="is('error') && error" class="absolute inset-0 z-40 grid place-items-center bg-slate-950 px-6" data-testid="error">
      <div class="flex max-w-sm flex-col items-center text-center" role="alert">
        <span class="mb-5 grid h-16 w-16 place-items-center rounded-full bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/40">
          <svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <path d="M3 3l18 18" />
          </svg>
        </span>
        <h2 class="text-xl font-bold">{{ error.title }}</h2>
        <p class="mt-2 text-white/80">{{ error.message }}</p>
        <p v-if="error.hint" class="mt-2 text-sm text-white/60">{{ error.hint }}</p>
        <div class="mt-7 flex flex-wrap justify-center gap-3">
          <button v-if="error.retryable" type="button" :class="primaryBtn" data-testid="retry" @click="restart">Try again</button>
          <button type="button" :class="secondaryBtn" data-testid="back" @click="exit">Back to start</button>
        </div>
      </div>
    </div>

    <!-- Welcome -->
    <Transition leave-active-class="pointer-events-none transition duration-500 ease-in" leave-to-class="opacity-0 scale-105">
      <section
        v-if="is('welcome')"
        class="absolute inset-0 z-30 overflow-y-auto bg-slate-950"
        aria-labelledby="welcome-title"
      >
        <!-- Ambient background -->
        <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div class="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-cyan-500/30 blur-3xl" />
          <div class="absolute -right-24 top-1/3 h-96 w-96 rounded-full bg-fuchsia-600/25 blur-3xl" />
          <div class="absolute -bottom-32 left-1/4 h-80 w-80 rounded-full bg-indigo-600/30 blur-3xl" />
          <svg class="absolute inset-0 h-full w-full opacity-30" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path
              d="M 18 86 L 18 70 C 18 50 82 66 80 46 Q 78 30 50 30 L 30 30 Q 16 30 24 18 L 74 14"
              fill="none"
              stroke="url(#welcome-trail)"
              stroke-width="4"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
              pathLength="1"
              stroke-dasharray="1"
              class="animate-draw-in"
            />
            <defs>
              <linearGradient id="welcome-trail" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0" stop-color="#22d3ee" />
                <stop offset="1" stop-color="#e879f9" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <div
          class="relative mx-auto flex min-h-full max-w-md flex-col justify-center px-6 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+2rem)] landscape:max-w-3xl"
        >
          <div class="landscape:grid landscape:grid-cols-2 landscape:items-center landscape:gap-10">
            <div>
              <p class="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />
                Camera experience
              </p>
              <h1 id="welcome-title" class="text-4xl font-black leading-tight tracking-tight sm:text-5xl">
                Follow the
                <span class="bg-gradient-to-r from-cyan-300 via-sky-400 to-fuchsia-400 bg-clip-text text-transparent">light trail</span>
              </h1>
              <p class="mt-3 text-base text-white/75">
                Pick one of two glowing trails drawn over your camera view. Only one of them leads to the reward.
              </p>
            </div>

            <div>
              <ol class="mt-8 space-y-3 landscape:mt-0">
                <li v-for="(s, i) in steps" :key="s.title" class="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
                  <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-400/30 to-fuchsia-500/30 text-cyan-100">
                    <svg v-if="s.icon === 'camera'" viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
                    </svg>
                    <svg v-else-if="s.icon === 'finger'" viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M9 11V5a2 2 0 1 1 4 0v5l4.5.9a2 2 0 0 1 1.6 2.3L18 20H10l-4-5.5a1.8 1.8 0 0 1 2.8-2.2L9 13" />
                    </svg>
                    <svg v-else viewBox="0 0 24 24" class="h-5 w-5" fill="currentColor" aria-hidden="true">
                      <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5z" />
                    </svg>
                  </span>
                  <div>
                    <p class="text-sm font-semibold"><span class="text-white/50">{{ i + 1 }}.</span> {{ s.title }}</p>
                    <p class="text-sm text-white/65">{{ s.text }}</p>
                  </div>
                </li>
              </ol>

              <fieldset class="mt-6">
                <legend class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Reward type</legend>
                <div class="grid grid-cols-3 gap-1 rounded-full border border-white/15 bg-white/5 p-1">
                  <label
                    v-for="opt in destinationOptions"
                    :key="opt.id"
                    class="cursor-pointer rounded-full px-3 py-2 text-center text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan-300"
                    :class="destinationId === opt.id ? 'bg-white text-slate-900 shadow' : 'text-white/75 hover:text-white'"
                  >
                    <input v-model="destinationId" type="radio" name="destination" :value="opt.id" class="sr-only" />
                    {{ opt.label }}
                  </label>
                </div>
              </fieldset>

              <button type="button" :class="[primaryBtn, 'mt-6 w-full']" data-testid="start" @click="start">
                Start Experience
                <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>

              <p v-if="!secure" class="mt-4 rounded-xl bg-amber-500/15 px-3 py-2 text-center text-xs text-amber-200 ring-1 ring-amber-400/30">
                Camera access needs HTTPS or localhost. Open this page over a secure connection.
              </p>
              <p class="mt-4 text-center text-xs text-white/50">
                Camera video stays on your device — nothing is recorded or uploaded.
              </p>
            </div>
          </div>
        </div>
      </section>
    </Transition>
  </main>
</template>
