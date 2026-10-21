<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

// Three.js is only downloaded when 3D content is actually revealed.
const ThreeScene = defineAsyncComponent(() => import('./ThreeScene.vue'))

const props = defineProps({
  destination: { type: Object, required: true },
})

const tone = computed(() => props.destination.tone ?? 'victory')
const showImages = computed(() => ['2d', 'mixed'].includes(props.destination.mode))
const showModels = computed(() => ['3d', 'mixed'].includes(props.destination.mode) && props.destination.models?.length)
const images = computed(() => (showImages.value ? (props.destination.images ?? []) : []))

const imageStatus = reactive({}) // id → 'loading' | 'loaded' | 'error'
for (const img of props.destination.images ?? []) imageStatus[img.id] = 'loading'

const revealed = ref(false)
let raf = 0
onMounted(() => {
  // Next frame so the enter transitions actually animate.
  raf = requestAnimationFrame(() => (revealed.value = true))
})

// Images may define a `landscape` override for position/size.
const landscapeQuery = window.matchMedia('(orientation: landscape)')
const isLandscape = ref(landscapeQuery.matches)
const onOrientation = (e) => (isLandscape.value = e.matches)
landscapeQuery.addEventListener('change', onOrientation)

const layoutOf = (img) => (isLandscape.value && img.landscape ? { ...img, ...img.landscape } : img)

const boxStyle = (source) => {
  const img = layoutOf(source)
  return {
  left: `${(img.position?.x ?? 0.5) * 100}%`,
  top: `${(img.position?.y ?? 0.5) * 100}%`,
  width: `${(img.size?.width ?? 0.4) * 100}%`,
  height: `${(img.size?.height ?? 0.3) * 100}%`,
  transitionDelay: `${img.delay ?? 0}ms`,
  }
}

// Tap-to-enlarge
const expanded = ref(null)
const closeButton = ref(null)
let lastFocus = null

async function expand(img) {
  if (!img.interactive || imageStatus[img.id] !== 'loaded') return
  lastFocus = document.activeElement
  expanded.value = img
  await nextTick()
  closeButton.value?.focus()
}

function collapse() {
  expanded.value = null
  lastFocus?.focus?.()
}

function onKeydown(e) {
  if (e.key === 'Escape' && expanded.value) collapse()
}
window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('keydown', onKeydown)
  landscapeQuery.removeEventListener('change', onOrientation)
})
</script>

<template>
  <div class="absolute inset-0" data-testid="destination-content" :data-mode="destination.mode" :data-tone="tone">
    <ThreeScene
      v-if="showModels"
      :models="destination.models"
      :lighting="destination.lighting"
      :camera="destination.camera"
    />

    <!-- 2D images -->
    <div v-if="images.length" class="pointer-events-none absolute inset-0">
      <div
        v-for="img in images"
        :key="img.id"
        class="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.3,1.15)]"
        :class="revealed ? 'scale-100 opacity-100 blur-0' : 'scale-75 opacity-0 blur-md'"
        :style="boxStyle(img)"
      >
        <button
          v-if="imageStatus[img.id] !== 'error'"
          type="button"
          class="pointer-events-auto relative flex h-full w-full items-center justify-center rounded-3xl outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/80"
          :class="img.interactive ? 'cursor-zoom-in' : 'pointer-events-none cursor-default'"
          :tabindex="img.interactive ? 0 : -1"
          :aria-label="img.interactive ? `Enlarge: ${img.alt}` : img.alt"
          @click="expand(img)"
        >
          <span
            v-if="imageStatus[img.id] === 'loading'"
            class="absolute inset-[15%] animate-pulse rounded-3xl bg-white/15 backdrop-blur"
          />
          <img
            :src="img.src"
            :alt="img.alt"
            class="h-full w-full object-contain drop-shadow-[0_12px_30px_rgba(0,0,0,0.45)] transition-opacity duration-500"
            :class="imageStatus[img.id] === 'loaded' ? 'opacity-100' : 'opacity-0'"
            draggable="false"
            decoding="async"
            @load="imageStatus[img.id] = 'loaded'"
            @error="imageStatus[img.id] = 'error'"
          />
        </button>
        <div
          v-else
          class="flex h-full w-full flex-col items-center justify-center gap-1 rounded-3xl border border-white/20 bg-slate-950/55 p-3 text-center text-xs text-white/80 backdrop-blur"
          role="img"
          :aria-label="`${img.alt} (failed to load)`"
        >
          <svg viewBox="0 0 24 24" class="h-6 w-6 text-white/60" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M3 16l5-5 5 5M14 14l2-2 5 5M4 4l16 16" stroke-linecap="round" />
          </svg>
          Image unavailable
        </div>
        <p
          v-if="img.caption"
          class="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-950/60 px-3 py-1 text-xs text-white backdrop-blur"
        >
          {{ img.caption }}
        </p>
      </div>
    </div>

    <!-- Title card -->
    <div
      class="pointer-events-none absolute inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] flex justify-center [@media(max-height:500px)]:bottom-3"
    >
      <div
        v-if="destination.title"
        class="animate-pop-in rounded-3xl border bg-slate-950/55 px-5 py-3 text-center shadow-2xl backdrop-blur-md [animation-delay:350ms] [@media(max-height:500px)]:py-2"
        :class="tone === 'failure' ? 'border-rose-400/40' : 'border-white/20'"
      >
        <h2
          class="bg-gradient-to-r bg-clip-text text-lg font-bold text-transparent"
          :class="tone === 'failure' ? 'from-rose-200 via-rose-300 to-rose-500' : 'from-amber-100 via-amber-200 to-amber-400'"
        >
          {{ destination.title }}
        </h2>
        <p v-if="destination.message" class="mt-0.5 text-sm text-white/80">{{ destination.message }}</p>
        <slot />
      </div>
    </div>

    <!-- Enlarged image -->
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0 scale-95"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="expanded"
        class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-6 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        :aria-label="expanded.alt"
        @click.self="collapse"
      >
        <img :src="expanded.src" :alt="expanded.alt" class="max-h-[80dvh] max-w-full object-contain drop-shadow-2xl" />
        <button
          ref="closeButton"
          type="button"
          class="absolute right-[max(1rem,env(safe-area-inset-right))] top-[calc(env(safe-area-inset-top)+1rem)] grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur outline-none hover:bg-white/20 focus-visible:ring-4 focus-visible:ring-cyan-300/80"
          aria-label="Close enlarged image"
          @click="collapse"
        >
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </Transition>
  </div>
</template>
