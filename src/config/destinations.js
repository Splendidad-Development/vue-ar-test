/**
 * Experience configuration: the trace path, completion rules and the content
 * revealed at the destination. UI components only read from here.
 *
 * Coordinates in `path` are normalized (0..1) relative to the tracing region,
 * so the path scales with the viewport.
 */

/** Trace path: an S-curve from bottom-left to top-right with a straight run in between. */
export const tracePath = {
  start: { x: 0.18, y: 0.86 },
  segments: [
    { type: 'line', to: { x: 0.18, y: 0.7 } },
    { type: 'cubic', control1: { x: 0.18, y: 0.5 }, control2: { x: 0.82, y: 0.66 }, to: { x: 0.8, y: 0.46 } },
    { type: 'quadratic', control: { x: 0.78, y: 0.3 }, to: { x: 0.5, y: 0.3 } },
    { type: 'line', to: { x: 0.3, y: 0.3 } },
    { type: 'quadratic', control: { x: 0.16, y: 0.3 }, to: { x: 0.24, y: 0.18 } },
    { type: 'line', to: { x: 0.74, y: 0.14 } },
  ],
}

/** Completion rules. See DEFAULT_RULES in src/lib/pathTracker.js for every option. */
export const traceRules = {
  tolerance: { ratio: 0.07, minPx: 28, maxPx: 72 },
  minCoverage: 0.85,
  allowResume: true,
  maxDeviations: 8,
}

/**
 * Destination content.
 *
 * images[]:
 *   src           URL or imported asset
 *   alt           accessible description
 *   position      normalized center { x, y } over the viewport
 *   size          normalized box { width, height }; the image is contained inside (aspect ratio preserved)
 *   delay         reveal delay in ms
 *   caption       optional caption shown under the image
 *   interactive   tap to enlarge
 *   landscape     optional { position, size } used when the viewport is wider than tall
 *
 * models[]:
 *   src           .glb / .gltf URL
 *   position      world units; the camera sits at z = 5 looking at the origin
 *   rotation      radians
 *   scale         multiplier on top of `fitSize`
 *   fitSize       model is normalized so its largest dimension equals this (world units)
 *   animation     { spin: rad/s, float: amplitude, entrance: 'pop' | 'none', clips: play embedded glTF clips }
 *   interactive   drag to rotate, tap to bounce
 *   landscape     optional { position, fitSize, scale } used when the viewport is wider than tall
 *
 * lighting: ambient + directional lights and environment reflection strength for the 3D scene.
 * camera:   optional { fov, frame } — `frame` is the world-space square kept visible at any aspect ratio.
 */

const lighting = {
  environment: 0.55,
  ambient: { color: '#ffffff', intensity: 0.35 },
  directional: [
    { color: '#ffffff', intensity: 1.6, position: { x: 3, y: 5, z: 4 } },
    { color: '#7dd3fc', intensity: 0.9, position: { x: -4, y: -2, z: 2 } },
  ],
}

const gemModel = {
  id: 'reward-gem',
  src: '/models/reward-gem.glb',
  position: { x: 0, y: 0.1, z: 0 },
  rotation: { x: 0.25, y: 0, z: 0 },
  scale: 1,
  fitSize: 2.2,
  animation: { spin: 0.8, float: 0.12, entrance: 'pop', clips: true },
  interactive: true,
}

export const destinations = {
  '2d': {
    id: '2d',
    label: '2D',
    mode: '2d',
    title: 'Badge unlocked',
    message: 'You followed the trail to the end.',
    images: [
      {
        id: 'badge',
        src: '/images/reward-badge.svg',
        alt: 'Golden explorer badge',
        position: { x: 0.5, y: 0.4 },
        size: { width: 0.62, height: 0.36 },
        landscape: { position: { x: 0.33, y: 0.47 }, size: { width: 0.32, height: 0.6 } },
        delay: 0,
        interactive: true,
      },
      {
        id: 'card',
        src: '/images/reward-card.svg',
        alt: 'Reward card reading "Trail complete"',
        position: { x: 0.5, y: 0.7 },
        size: { width: 0.78, height: 0.16 },
        landscape: { position: { x: 0.68, y: 0.47 }, size: { width: 0.4, height: 0.3 } },
        delay: 250,
        interactive: true,
      },
    ],
    models: [],
  },

  '3d': {
    id: '3d',
    label: '3D',
    mode: '3d',
    title: 'Crystal found',
    message: 'Drag to spin it, tap to make it bounce.',
    images: [],
    models: [gemModel],
    lighting,
  },

  mixed: {
    id: 'mixed',
    label: 'Mixed',
    mode: 'mixed',
    title: 'Treasure unlocked',
    message: 'Drag the crystal to spin it. Tap the badge to enlarge.',
    images: [
      {
        id: 'badge',
        src: '/images/reward-badge.svg',
        alt: 'Golden explorer badge',
        position: { x: 0.5, y: 0.7 },
        size: { width: 0.44, height: 0.22 },
        landscape: { position: { x: 0.68, y: 0.45 }, size: { width: 0.26, height: 0.46 } },
        delay: 300,
        interactive: true,
      },
    ],
    models: [
      {
        ...gemModel,
        position: { x: 0, y: 0.9, z: 0 },
        fitSize: 1.8,
        landscape: { position: { x: -1.4, y: 0.15, z: 0 }, fitSize: 2 },
      },
    ],
    lighting,
  },
}

export const defaultDestinationId = 'mixed'
