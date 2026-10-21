# Trail AR (Vue 3 + Vite + Tailwind + Three.js)

A camera-backed, touch-first experience: the live camera feed fills the screen, the user traces a glowing virtual path with their finger, and reaching the destination reveals 2D images and/or animated Three.js models as screen overlays (they are not anchored to the physical world).

```sh
npm install
npm run dev      # camera needs https:// or localhost
npm run build
```

To test on a phone, serve over HTTPS (e.g. `npx vite --host` behind an HTTPS tunnel). Plain `http://<lan-ip>` will not get camera access.

## Where things live

| File | Responsibility |
| --- | --- |
| `src/config/destinations.js` | Trace path (normalized 0..1 coords, `line` / `quadratic` / `cubic` segments), completion rules, and destination content (`2d`, `3d`, `mixed`). |
| `src/lib/pathGeometry.js` | Pure geometry: flattening, projection onto the path, markers. |
| `src/lib/pathTracker.js` | Pure tracing rules: start-near-beginning, local matching window (no shortcuts), coverage, deviations, resume, completion. `DEFAULT_RULES` documents every option. |
| `src/composables/usePathTracing.js` | Pointer events, resize handling, and rAF-smoothed progress for the tracker. |
| `src/composables/useCamera.js` | `getUserMedia` (rear camera preferred, video only), error mapping, track cleanup. |
| `src/composables/useThreeScene.js` | Transparent WebGL overlay, `GLTFLoader`, animation, drag/tap interaction, full disposal. |
| `src/composables/useExperienceState.js` | State machine: `welcome → requesting-permission → loading-camera → ready ⇄ tracing → success`, plus `error`. |
| `src/views/ARExperience.vue` | Orchestrates the flow, restart and exit. |

Reward assets are in `public/images` and `public/models`. Models are auto-centered and scaled to `fitSize`, so any `.glb` / `.gltf` can be dropped in. Images and models accept an optional `landscape` override for wide viewports.
