import { readonly, ref } from 'vue'

/**
 * Experience state machine. Only the transitions listed here are allowed.
 *
 *   welcome ─start─▶ requesting-permission ─▶ loading-camera ─▶ ready ⇄ tracing ─▶ success
 *                          ▲      (any camera failure) ─▶ error ─retry─┘
 *   restart: ready | tracing | success ─▶ requesting-permission
 *   exit:    any ─▶ welcome
 */
export const TRANSITIONS = {
  welcome: ['requesting-permission'],
  'requesting-permission': ['loading-camera', 'error', 'welcome'],
  'loading-camera': ['ready', 'error', 'welcome'],
  ready: ['tracing', 'requesting-permission', 'error', 'welcome'],
  tracing: ['ready', 'success', 'requesting-permission', 'error', 'welcome'],
  success: ['requesting-permission', 'error', 'welcome'],
  error: ['requesting-permission', 'welcome'],
}

export function useExperienceState(initial = 'welcome') {
  const state = ref(initial)

  const can = (to) => TRANSITIONS[state.value]?.includes(to) ?? false

  function transition(to) {
    if (!can(to)) {
      if (import.meta.env?.DEV) console.warn(`[experience] blocked transition ${state.value} → ${to}`)
      return false
    }
    state.value = to
    return true
  }

  const is = (...names) => names.includes(state.value)

  return { state: readonly(state), can, is, transition }
}
