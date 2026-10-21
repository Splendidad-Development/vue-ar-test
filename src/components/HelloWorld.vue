<script setup>
import { ref } from 'vue'
import heroImg from '../assets/hero.png'
import viteLogo from '../assets/vite.svg'
import vueLogo from '../assets/vue.svg'

const count = ref(0)
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-screen bg-gray-100">
    <img :src="heroImg" alt="Hero Image" class="w-64 h-64 mb-4" />
    <h1 class="text-4xl font-bold text-indigo-200 mb-2">Hello, Vue 3 + Vite + Tailwind!</h1>
    <p class="text-lg text-gray-600 mb-4">Count: {{ count }}</p>
    <button @click="count++" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">Increment</button>
  </div>
</template>
