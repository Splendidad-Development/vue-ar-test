<script setup>
import { computed, ref } from 'vue'
import { useThreeScene } from '../composables/useThreeScene.js'

const props = defineProps({
  models: { type: Array, required: true },
  lighting: { type: Object, default: undefined },
  camera: { type: Object, default: undefined },
})

const container = ref(null)
// Config is read once at mount; the parent remounts this component to change it.
const { status } = useThreeScene(container, {
  models: props.models,
  lighting: props.lighting,
  camera: props.camera,
})

const interactive = computed(() => props.models.some((m) => m.interactive))
</script>

<template>
  <div class="absolute inset-0">
    <div
      ref="container"
      class="absolute inset-0"
      :class="interactive ? 'touch-none' : 'pointer-events-none'"
      data-testid="three-container"
    />

    <div class="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+5rem)] flex flex-col items-center gap-2">
      <p
        v-if="status.loading > 0"
        class="flex items-center gap-2 rounded-full bg-slate-950/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur"
        role="status"
      >
        <span class="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        Loading 3D model…
      </p>
      <p
        v-if="!status.supported"
        class="rounded-full bg-rose-500/80 px-3 py-1.5 text-xs font-medium text-white backdrop-blur"
        role="alert"
      >
        3D content isn’t available on this device.
      </p>
      <p
        v-else-if="status.failed.length"
        class="rounded-full bg-amber-500/80 px-3 py-1.5 text-xs font-medium text-white backdrop-blur"
        role="alert"
      >
        A model failed to load — showing a placeholder.
      </p>
    </div>
  </div>
</template>
