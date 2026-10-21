import { readonly, ref } from 'vue'

/**
 * Experience state machine. Only the transitions listed here are allowed.
 *
 *   welcome ─start─▶ requesting-permission ─▶ loading-camera ─▶ ready ⇄ tracing ─▶ success | failure
 *                          ▲      (any camera failure) ─▶ error ─retry─┘
 *   try again: success | failure ─▶ ready (camera keeps running)
 *   restart: ready | tracing | success | failure ─▶ requesting-permission
 *   exit:    any ─▶ welcome
 */
export const TRANSITIONS = {
  welcome: ['requesting-permission'],
  'requesting-permission': ['loading-camera', 'error', 'welcome'],
  'loading-camera': ['ready', 'error', 'welcome'],
  ready: ['tracing', 'requesting-permission', 'error', 'welcome'],
  tracing: ['ready', 'success', 'failure', 'requesting-permission', 'error', 'welcome'],
  success: ['ready', 'requesting-permission', 'error', 'welcome'],
  failure: ['ready', 'requesting-permission', 'error', 'welcome'],
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
