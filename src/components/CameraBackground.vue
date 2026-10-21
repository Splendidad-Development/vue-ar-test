<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'

/**
 * Full-screen live camera preview. Only displays the stream; frames are never
 * captured, stored or uploaded.
 */
const props = defineProps({
  stream: { type: Object, default: null },
  mirrored: { type: Boolean, default: false },
  /** ms to wait for the first frame before reporting a playback error. */
  timeout: { type: Number, default: 10000 },
})
const emit = defineEmits(['playing', 'error'])

const video = ref(null)
const visible = ref(false)
let timer = 0
let reported = false

function clearTimer() {
  clearTimeout(timer)
  timer = 0
}

function onPlaying() {
  clearTimer()
  visible.value = true
  if (!reported) {
    reported = true
    emit('playing')
  }
}

watch(
  [() => props.stream, video],
  ([stream, el]) => {
    if (!el) return
    clearTimer()
    reported = false
    visible.value = false
    el.srcObject = stream
    if (!stream) return
    timer = setTimeout(() => emit('error', new Error('Camera preview timed out')), props.timeout)
    el.play().catch((err) => {
      // AbortError just means a newer load replaced this one.
      if (err?.name !== 'AbortError') {
        clearTimer()
        emit('error', err)
      }
    })
  },
  { immediate: true, flush: 'post' },
)

onBeforeUnmount(() => {
  clearTimer()
  if (video.value) video.value.srcObject = null
})
</script>

<template>
  <div class="pointer-events-none fixed inset-0 bg-slate-950" aria-hidden="true">
    <video
      ref="video"
      class="h-full w-full object-cover transition-opacity duration-700"
      :class="[visible ? 'opacity-100' : 'opacity-0', mirrored && '-scale-x-100']"
      autoplay
      muted
      playsinline
      disablepictureinpicture
      @playing="onPlaying"
    />
    <!-- Soft vignette keeps the overlay readable on bright scenes. -->
    <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(2,6,23,0.55)_100%)]" />
  </div>
</template>
