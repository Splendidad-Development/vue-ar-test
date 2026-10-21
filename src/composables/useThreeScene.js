import { onBeforeUnmount, onMounted, reactive } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * Three.js lifecycle for a transparent overlay canvas.
 *
 * Models are screen-space overlays in front of a fixed virtual camera; they
 * are not anchored to the physical world.
 *
 * One renderer per mounted component; everything (geometries, materials,
 * textures, environment map, renderer/context) is disposed on unmount, and
 * models that finish loading after unmount are disposed immediately.
 */

const DEFAULT_CAMERA = { fov: 40, frame: 3.4 }
const DEFAULT_LIGHTING = {
  ambient: { color: '#ffffff', intensity: 1 },
  directional: [{ color: '#ffffff', intensity: 2, position: { x: 3, y: 5, z: 4 } }],
}

const easeOutBack = (t) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

function disposeObject(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose()
    const materials = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []
    for (const m of materials) {
      for (const value of Object.values(m)) if (value?.isTexture) value.dispose()
      m.dispose()
    }
  })
}

function placeholderModel() {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: '#a78bfa', metalness: 0.3, roughness: 0.35, flatShading: true }),
  )
  const group = new THREE.Group()
  group.add(mesh)
  return { scene: group, animations: [] }
}

/**
 * @param {import('vue').Ref<HTMLElement|null>} containerRef
 * @param {{ models: object[], lighting?: object, camera?: object }} config
 */
export function useThreeScene(containerRef, config) {
  const status = reactive({
    supported: true,
    loading: 0,
    loaded: 0,
    failed: [], // ids of models that fell back to a placeholder
  })

  let renderer = null
  let scene = null
  let camera = null
  let envTexture = null
  let resizeObserver = null
  let raf = 0
  let disposed = false
  let clock = null
  const entries = [] // { cfg, pivot, mixer, base, startTime, velocity: {x,y}, bounceStart }
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  let drag = null

  function init() {
    if (renderer) return // never create a duplicate renderer
    const el = containerRef.value
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
    } catch (err) {
      console.warn('[three] WebGL unavailable', err)
      status.supported = false
      return
    }
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.domElement.className = 'block h-full w-full'
    renderer.domElement.addEventListener('webglcontextlost', onContextLost)
    el.appendChild(renderer.domElement)

    scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    scene.environment = envTexture
    scene.environmentIntensity = config.lighting?.environment ?? 0.6

    const camCfg = { ...DEFAULT_CAMERA, ...config.camera }
    camera = new THREE.PerspectiveCamera(camCfg.fov, 1, 0.1, 100)

    const lighting = config.lighting ?? DEFAULT_LIGHTING
    if (lighting.ambient) {
      scene.add(new THREE.AmbientLight(lighting.ambient.color, lighting.ambient.intensity))
    }
    for (const d of lighting.directional ?? []) {
      const light = new THREE.DirectionalLight(d.color, d.intensity)
      light.position.set(d.position.x, d.position.y, d.position.z)
      scene.add(light)
    }

    clock = new THREE.Clock()
    resize()
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(el)

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)

    for (const cfg of config.models ?? []) loadModel(cfg)
    raf = requestAnimationFrame(tick)
  }

  /** Keep a `frame`-sized square of world space visible in any aspect ratio. */
  function resize() {
    const el = containerRef.value
    if (!renderer || !el) return
    const w = Math.max(1, el.clientWidth)
    const h = Math.max(1, el.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    const { fov, frame } = { ...DEFAULT_CAMERA, ...config.camera }
    const halfTan = Math.tan(THREE.MathUtils.degToRad(fov / 2))
    const distForHeight = frame / 2 / halfTan
    const distForWidth = frame / 2 / (halfTan * camera.aspect)
    camera.position.set(0, 0, Math.max(5, distForHeight, distForWidth))
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    for (const e of entries) placeEntry(e)
  }

  /** Apply the configured transform, using the `landscape` override on wide viewports. */
  function placeEntry(e) {
    const el = containerRef.value
    const wide = el && el.clientWidth > el.clientHeight
    const cfg = wide && e.cfg.landscape ? { ...e.cfg, ...e.cfg.landscape } : e.cfg
    const p = cfg.position ?? {}
    e.pivot.position.set(p.x ?? 0, p.y ?? 0, p.z ?? 0)
    e.baseY = e.pivot.position.y
    e.fit = ((cfg.fitSize ?? 2) / e.maxDim) * (cfg.scale ?? 1)
  }

  async function loadModel(cfg) {
    status.loading++
    let gltf
    try {
      gltf = await new GLTFLoader().loadAsync(cfg.src)
    } catch (err) {
      console.warn(`[three] failed to load ${cfg.src}`, err)
      if (!disposed) status.failed.push(cfg.id)
      gltf = placeholderModel()
    } finally {
      status.loading--
    }
    if (disposed) {
      disposeObject(gltf.scene)
      return
    }
    addModel(cfg, gltf)
    status.loaded++
  }

  function addModel(cfg, gltf) {
    const model = gltf.scene
    // Center the model and normalize its size so any asset fits the overlay.
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    model.position.sub(center)
    const maxDim = Math.max(size.x, size.y, size.z) || 1

    const inner = new THREE.Group() // user/animation rotation
    inner.add(model)
    const pivot = new THREE.Group() // configured transform
    pivot.add(inner)
    const r = cfg.rotation ?? {}
    pivot.rotation.set(r.x ?? 0, r.y ?? 0, r.z ?? 0)
    pivot.scale.setScalar(0.0001)
    scene.add(pivot)

    let mixer = null
    if (cfg.animation?.clips !== false && gltf.animations?.length) {
      mixer = new THREE.AnimationMixer(model)
      for (const clip of gltf.animations) mixer.clipAction(clip).play()
    }

    const entry = {
      cfg,
      pivot,
      inner,
      mixer,
      maxDim,
      fit: 1,
      baseY: 0,
      startTime: clock.getElapsedTime(),
      velocity: { x: 0, y: 0 },
      bounceStart: -Infinity,
    }
    placeEntry(entry)
    entries.push(entry)
  }

  function tick() {
    raf = requestAnimationFrame(tick)
    const dt = Math.min(clock.getDelta(), 0.1)
    const t = clock.getElapsedTime()

    for (const e of entries) {
      const anim = e.cfg.animation ?? {}
      const age = t - e.startTime

      let s = e.fit
      if (anim.entrance !== 'none') s *= easeOutBack(Math.min(1, age / 0.9))
      const b = t - e.bounceStart
      if (b < 0.6) s *= 1 + Math.sin((b / 0.6) * Math.PI) * 0.18
      e.pivot.scale.setScalar(Math.max(0.0001, s))

      if (anim.float) e.pivot.position.y = e.baseY + Math.sin(age * 1.6) * anim.float

      const dragging = drag?.entry === e
      if (!dragging) {
        // Configured spin plus decaying momentum from the last drag.
        e.inner.rotation.y += ((anim.spin ?? 0) + e.velocity.y) * dt
        e.inner.rotation.x += e.velocity.x * dt
        const decay = Math.exp(-dt * 2.5)
        e.velocity.x *= decay
        e.velocity.y *= decay
        e.inner.rotation.x *= Math.exp(-dt * 1.5) // ease back upright
      }
      e.mixer?.update(dt)
    }
    renderer.render(scene, camera)
  }

  function hitEntry(ev) {
    const rect = renderer.domElement.getBoundingClientRect()
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    const interactive = entries.filter((e) => e.cfg.interactive)
    const hits = raycaster.intersectObjects(
      interactive.map((e) => e.pivot),
      true,
    )
    if (!hits.length) return null
    return interactive.find((e) => {
      let o = hits[0].object
      while (o && o !== e.pivot) o = o.parent
      return o === e.pivot
    })
  }

  function onPointerDown(ev) {
    if (drag || !renderer) return
    const entry = hitEntry(ev)
    if (!entry) return
    ev.preventDefault()
    containerRef.value.setPointerCapture?.(ev.pointerId)
    drag = { entry, id: ev.pointerId, x: ev.clientX, y: ev.clientY, startX: ev.clientX, startY: ev.clientY, time: performance.now(), lastTime: performance.now() }
    entry.velocity.x = 0
    entry.velocity.y = 0
  }

  function onPointerMove(ev) {
    if (!drag) {
      if (ev.pointerType === 'mouse' && renderer) containerRef.value.style.cursor = hitEntry(ev) ? 'grab' : ''
      return
    }
    if (ev.pointerId !== drag.id) return
    const now = performance.now()
    const dx = ev.clientX - drag.x
    const dy = ev.clientY - drag.y
    const dts = Math.max(0.001, (now - drag.lastTime) / 1000)
    const e = drag.entry
    e.inner.rotation.y += dx * 0.01
    e.inner.rotation.x = THREE.MathUtils.clamp(e.inner.rotation.x + dy * 0.01, -1, 1)
    e.velocity.y = (dx * 0.01) / dts
    e.velocity.x = (dy * 0.01) / dts
    drag.x = ev.clientX
    drag.y = ev.clientY
    drag.lastTime = now
  }

  function onPointerUp(ev) {
    if (!drag || ev.pointerId !== drag.id) return
    const moved = Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY)
    const e = drag.entry
    if (moved < 8 && performance.now() - drag.time < 350) e.bounceStart = clock.getElapsedTime()
    // Clamp fling speed.
    e.velocity.y = THREE.MathUtils.clamp(e.velocity.y, -12, 12)
    e.velocity.x = THREE.MathUtils.clamp(e.velocity.x, -6, 6)
    drag = null
  }

  function onContextLost(ev) {
    ev.preventDefault()
    cancelAnimationFrame(raf)
    raf = 0
    status.supported = false
  }

  function dispose() {
    disposed = true
    cancelAnimationFrame(raf)
    raf = 0
    resizeObserver?.disconnect()
    const el = containerRef.value
    el?.removeEventListener('pointerdown', onPointerDown)
    el?.removeEventListener('pointermove', onPointerMove)
    el?.removeEventListener('pointerup', onPointerUp)
    el?.removeEventListener('pointercancel', onPointerUp)
    for (const e of entries) {
      e.mixer?.stopAllAction()
      e.mixer?.uncacheRoot(e.mixer.getRoot())
    }
    entries.length = 0
    if (scene) disposeObject(scene)
    envTexture?.dispose()
    if (renderer) {
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
    renderer = scene = camera = envTexture = null
  }

  onMounted(init)
  onBeforeUnmount(dispose)

  return { status }
}
