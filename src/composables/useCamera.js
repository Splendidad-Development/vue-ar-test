import { getCurrentInstance, onBeforeUnmount, ref, shallowRef } from 'vue'

/**
 * Camera stream management. Video only (never audio); the stream is only
 * displayed, never recorded or uploaded.
 */

const ERRORS = {
  insecure: {
    code: 'insecure',
    title: 'Secure connection required',
    message: 'Camera access only works over HTTPS or on localhost.',
    hint: 'Open this page using an https:// address.',
    retryable: false,
  },
  unsupported: {
    code: 'unsupported',
    title: 'Camera not supported',
    message: 'This browser does not support camera access.',
    hint: 'Try a recent version of Safari, Chrome, Firefox or Edge.',
    retryable: false,
  },
  denied: {
    code: 'denied',
    title: 'Camera permission denied',
    message: 'The experience needs your camera to show the world behind the path.',
    hint: 'Allow camera access in your browser’s site settings, then try again.',
    retryable: true,
  },
  'not-found': {
    code: 'not-found',
    title: 'No camera found',
    message: 'We could not find a camera on this device.',
    hint: 'Connect a camera or try another device.',
    retryable: true,
  },
  busy: {
    code: 'busy',
    title: 'Camera unavailable',
    message: 'The camera is being used by another app or could not be started.',
    hint: 'Close other apps or tabs using the camera, then try again.',
    retryable: true,
  },
  ended: {
    code: 'ended',
    title: 'Camera disconnected',
    message: 'The camera stopped unexpectedly.',
    hint: 'Check the camera and try again.',
    retryable: true,
  },
  playback: {
    code: 'playback',
    title: 'Camera preview failed',
    message: 'The camera started but the video preview could not be shown.',
    hint: 'Try again, or reload the page.',
    retryable: true,
  },
  unknown: {
    code: 'unknown',
    title: 'Camera error',
    message: 'Something went wrong while starting the camera.',
    hint: 'Try again.',
    retryable: true,
  },
}

export function cameraError(code, cause) {
  return { ...(ERRORS[code] ?? ERRORS.unknown), cause: cause?.message ?? cause ?? null }
}

function mapMediaError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return cameraError('denied', err)
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return cameraError('not-found', err)
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return cameraError('busy', err)
    case 'TypeError':
      return cameraError('unsupported', err)
    default:
      return cameraError('unknown', err)
  }
}

function stopStream(s) {
  s?.getTracks().forEach((t) => t.stop())
}

/**
 * @param {{ onEnded?: (error) => void }} [options]
 */
export function useCamera({ onEnded } = {}) {
  const stream = shallowRef(null)
  const error = ref(null)
  const facingMode = ref(null)
  // Incremented on every start/stop so late getUserMedia results are discarded.
  let requestId = 0

  function handleTrackEnded() {
    if (!stream.value) return
    stop()
    error.value = cameraError('ended')
    onEnded?.(error.value)
  }

  /** @returns {Promise<'ok' | 'error' | 'cancelled'>} */
  async function start() {
    stop()
    const id = requestId
    error.value = null

    if (typeof window === 'undefined' || !window.isSecureContext) {
      error.value = cameraError('insecure')
      return 'error'
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      error.value = cameraError('unsupported')
      return 'error'
    }

    let s
    try {
      try {
        s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
      } catch (err) {
        // Some devices reject the size hints; retry with the bare minimum.
        if (err?.name !== 'OverconstrainedError') throw err
        s = await navigator.mediaDevices.getUserMedia({ audio: false, video: true })
      }
    } catch (err) {
      if (id !== requestId) return 'cancelled'
      error.value = mapMediaError(err)
      return 'error'
    }

    if (id !== requestId) {
      // Exit/restart happened while the permission prompt was open.
      stopStream(s)
      return 'cancelled'
    }

    const [track] = s.getVideoTracks()
    facingMode.value = track?.getSettings?.().facingMode ?? null
    track?.addEventListener('ended', handleTrackEnded)
    stream.value = s
    return 'ok'
  }

  function stop() {
    requestId++
    const s = stream.value
    if (!s) return
    s.getVideoTracks().forEach((t) => t.removeEventListener('ended', handleTrackEnded))
    stopStream(s)
    stream.value = null
    facingMode.value = null
  }

  if (getCurrentInstance()) onBeforeUnmount(stop)

  return { stream, error, facingMode, start, stop }
}
