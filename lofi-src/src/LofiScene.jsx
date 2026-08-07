// <LofiScene /> — the whole thing.
//
// Six camera-mapped planes, a dust field, and a composite pass. The planes are
// laid out in real depth and the content on each one is looked up by projecting
// through a fixed projector matrix, so the parallax is genuine projection
// rather than a per-layer scroll multiplier.
//
// Render order per frame:
//   layers + dust -> HDR offscreen target -> composite (rain, grade, grain)

import { useMemo, useRef, useLayoutEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import {
  layerVert,
  skyFrag,
  cityFrag,
  roofFrag,
  frameFrag,
  beamFrag,
  dustVert,
  dustFrag,
  compositeVert,
  compositeFrag,
} from './shaders';

const FOV = 34;

// Upper bound on how far the camera ever travels from the projector. Only used
// to size the planes so their edges never come into frame; the travel actually
// used each frame is derived from the viewport (see shiftFor).
const SHIFT = { x: 0.30, y: 0.20, z: 0.75 };

// The nearest layer slides on screen by roughly (camera shift / its distance),
// measured in tangent units — and the screen is only tan(fov/2)*aspect wide in
// those units. So a fixed shift that reads as a gentle parallax on a desktop
// throws the window half off the frame on a phone in portrait. Deriving the
// travel from the viewport keeps the *proportion* constant instead.
const NEAREST_Z = 2.6;
const TRAVEL = 0.17; // fraction of the half-frame the nearest layer may cross

function shiftFor(aspect) {
  const tan = Math.tan((FOV * Math.PI) / 360);
  return {
    x: TRAVEL * tan * aspect * NEAREST_Z,
    y: TRAVEL * tan * NEAREST_Z * 0.85,
    z: SHIFT.z,
  };
}

const DAY_TARGET = { day: 0.05, golden: 0.45, night: 0.93 };

// z, shader, blending and per-instance uniforms. Order is paint order.
const LAYERS = [
  {
    name: 'sky',
    z: -46,
    frag: skyFrag,
    opaque: true,
    uniforms: {},
  },
  {
    name: 'far city',
    z: -27,
    frag: cityFrag,
    uniforms: {
      uFreq: { value: 17.0 },
      uSeed: { value: 3.0 },
      uBase: { value: 0.012 },
      uSpread: { value: 0.085 },
      uHaze: { value: 0.62 },
      uAlbedo: { value: new THREE.Color(0.16, 0.17, 0.23) },
      uWindowRows: { value: 190 },
      uWindowCols: { value: 5 },
      uLitChance: { value: 0.30 },
    },
  },
  {
    name: 'city',
    z: -15,
    frag: cityFrag,
    uniforms: {
      uFreq: { value: 8.2 },
      uSeed: { value: 19.0 },
      uBase: { value: -0.010 },
      uSpread: { value: 0.235 },
      uHaze: { value: 0.24 },
      uAlbedo: { value: new THREE.Color(0.115, 0.115, 0.155) },
      uWindowRows: { value: 88 },
      uWindowCols: { value: 7 },
      uLitChance: { value: 0.36 },
    },
  },
  { name: 'roof', z: -7.4, frag: roofFrag, uniforms: {} },
  { name: 'beam', z: -4.2, frag: beamFrag, additive: true, uniforms: {} },
  { name: 'room', z: -2.6, frag: frameFrag, uniforms: {} },
];

export default function LofiScene({
  audio,
  quality,
  dayMode = 'cycle',
  onFrame,
  reducedMotion = false,
}) {
  const { gl, size, camera, scene } = useThree();

  const group = useRef();
  const enter = useRef(0);
  const clock = useRef(0);
  const day = useRef(0.42);
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const scroll = useRef({ v: 0, t: 0 });
  const shift = useRef(shiftFor(1.6));

  // ---------------------------------------------------------------------
  // Shared uniforms. One object, referenced by every layer material, so the
  // whole scene is guaranteed to agree about the time of day — a per-material
  // copy would show up as one layer lagging a frame behind the others when the
  // light moves.
  // ---------------------------------------------------------------------
  const shared = useMemo(
    () => ({
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uDay: { value: 0.42 },
      uEnter: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uLevel: { value: 0 },
      uProjector: { value: new THREE.Matrix4() },
    }),
    [],
  );

  const defines = useMemo(
    () => ({ FBM_OCTAVES: quality.fbmOctaves }),
    [quality.fbmOctaves],
  );

  // ---------------------------------------------------------------------
  // The projector: the camera as it stood when the scene was painted. Fixed at
  // the origin, updated only when the aspect changes.
  // ---------------------------------------------------------------------
  const projector = useMemo(() => new THREE.PerspectiveCamera(FOV, 1, 0.1, 200), []);

  useLayoutEffect(() => {
    const aspect = size.width / Math.max(size.height, 1);
    projector.aspect = aspect;
    projector.position.set(0, 0, 0);
    projector.rotation.set(0, 0, 0);
    projector.updateMatrixWorld(true);
    projector.updateProjectionMatrix();
    shared.uProjector.value.multiplyMatrices(
      projector.projectionMatrix,
      projector.matrixWorldInverse,
    );
    shared.uAspect.value = aspect;
    shift.current = shiftFor(aspect);

    camera.fov = FOV;
    camera.aspect = aspect;
    camera.near = 0.1;
    camera.far = 200;
    camera.updateProjectionMatrix();
  }, [projector, camera, size.width, size.height, shared]);

  // ---------------------------------------------------------------------
  // Layer meshes
  // ---------------------------------------------------------------------
  const layers = useMemo(() => {
    const tan = Math.tan((FOV * Math.PI) / 360);
    return LAYERS.map((def, i) => {
      // Size the plane for the worst case: camera pulled all the way back and
      // pushed all the way to one side.
      const reach = Math.abs(def.z) + SHIFT.z;
      const h = 2 * reach * tan + SHIFT.y * 2;
      const w = h * 3 + SHIFT.x * 2; // width set from a generous aspect, cropped by the frustum
      const geometry = new THREE.PlaneGeometry(w, h);

      const material = new THREE.ShaderMaterial({
        vertexShader: layerVert,
        fragmentShader: def.frag,
        uniforms: { ...shared, ...def.uniforms },
        defines,
        transparent: !def.opaque,
        blending: def.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false, // the offscreen target is linear HDR; grading is one pass, later
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.z = def.z;
      mesh.renderOrder = i;
      mesh.frustumCulled = false;
      return { def, mesh, geometry, material };
    });
  }, [shared, defines]);

  useLayoutEffect(
    () => () =>
      layers.forEach((l) => {
        l.geometry.dispose();
        l.material.dispose();
      }),
    [layers],
  );

  // ---------------------------------------------------------------------
  // Dust — the only real 3D in the scene, which is exactly why it sells the
  // depth of everything that is not.
  // ---------------------------------------------------------------------
  const dustUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uDay: { value: 0.42 },
      uBass: { value: 0 },
      uTreble: { value: 0 },
      uEnter: { value: 0 },
      uColor: { value: new THREE.Color('#ffd9ad') },
    }),
    [],
  );

  const dust = useMemo(() => {
    const count = quality.dust;
    if (!count) return null;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 1.5;
      pos[i * 3 + 1] = (Math.random() * 2 - 1) * 1.1;
      pos[i * 3 + 2] = -0.9 - Math.random() * 2.6;
      seed[i * 3] = Math.random();
      seed[i * 3 + 1] = Math.random();
      seed[i * 3 + 2] = 0.5 + Math.random() * 1.6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));

    const m = new THREE.ShaderMaterial({
      vertexShader: dustVert,
      fragmentShader: dustFrag,
      uniforms: dustUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const points = new THREE.Points(g, m);
    points.renderOrder = LAYERS.length - 1.5; // in the air, behind the room
    points.frustumCulled = false;
    return { points, geometry: g, material: m };
  }, [quality.dust, dustUniforms]);

  useLayoutEffect(() => {
    if (!dust) return undefined;
    return () => {
      dust.geometry.dispose();
      dust.material.dispose();
    };
  }, [dust]);

  useLayoutEffect(() => {
    dustUniforms.uPixelRatio.value = gl.getPixelRatio();
  }, [gl, dustUniforms, size.width, size.height]);

  // ---------------------------------------------------------------------
  // Offscreen target + composite
  // ---------------------------------------------------------------------
  const rt = useMemo(() => {
    const ctx = gl.getContext();
    const half =
      ctx.getExtension('EXT_color_buffer_half_float') || ctx.getExtension('EXT_color_buffer_float');
    const target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      // Half float where it exists: the layers write linear values above 1 and
      // the composite is what tone maps them. Clamping to 8 bits first would
      // throw away every highlight before the grade ever sees it.
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: false, // nothing depth-tests; paint order is explicit
      stencilBuffer: false,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    return target;
  }, [gl]);

  useLayoutEffect(() => () => rt.dispose(), [rt]);

  const compositeUniforms = useMemo(
    () => ({
      uScene: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uDay: { value: 0.42 },
      uEnter: { value: 0 },
      uRain: { value: 0.85 },
      uExposure: { value: 1.0 },
      uInvViewProj: { value: new THREE.Matrix4() },
      uProjector: { value: shared.uProjector.value },
      uGlassZ: { value: -2.6 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uLevel: { value: 0 },
    }),
    [shared],
  );

  const composite = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      vertexShader: compositeVert,
      fragmentShader: compositeFrag,
      uniforms: compositeUniforms,
      defines: {
        FBM_OCTAVES: quality.fbmOctaves,
        ...(quality.rain ? { RAIN: '' } : {}),
        ...(quality.chroma ? { CHROMA: '' } : {}),
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    const quadScene = new THREE.Scene();
    quadScene.add(mesh);
    return { material, geometry, quadScene, quadCamera: new THREE.Camera() };
  }, [compositeUniforms, quality.fbmOctaves, quality.rain, quality.chroma]);

  useLayoutEffect(
    () => () => {
      composite.material.dispose();
      composite.geometry.dispose();
    },
    [composite],
  );

  useLayoutEffect(() => {
    const dpr = gl.getPixelRatio();
    const w = Math.max(2, Math.floor(size.width * dpr * quality.rtScale));
    const h = Math.max(2, Math.floor(size.height * dpr * quality.rtScale));
    rt.setSize(w, h);
    compositeUniforms.uScene.value = rt.texture;
    compositeUniforms.uResolution.value.set(size.width * dpr, size.height * dpr);
  }, [gl, size.width, size.height, quality.rtScale, rt, compositeUniforms]);

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------
  useLayoutEffect(() => {
    const el = gl.domElement;

    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      pointer.current.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.current.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    const onLeave = () => {
      pointer.current.tx = 0;
      pointer.current.ty = 0;
    };
    const onWheel = (e) => {
      scroll.current.t = Math.min(1, Math.max(0, scroll.current.t + e.deltaY * 0.0011));
      e.preventDefault();
    };

    // Touch: a drag is the scroll, and it also steers the parallax.
    let last = null;
    const onTouchStart = (e) => {
      last = e.touches[0];
      onTouchMoveParallax(e);
    };
    const onTouchMoveParallax = (e) => {
      const t = e.touches[0];
      if (!t) return;
      const r = el.getBoundingClientRect();
      pointer.current.tx = ((t.clientX - r.left) / r.width) * 2 - 1;
      pointer.current.ty = ((t.clientY - r.top) / r.height) * 2 - 1;
    };
    const onTouchMove = (e) => {
      const t = e.touches[0];
      if (t && last) {
        scroll.current.t = Math.min(1, Math.max(0, scroll.current.t + (last.clientY - t.clientY) * 0.0022));
      }
      last = t;
      onTouchMoveParallax(e);
      e.preventDefault();
    };
    const onTouchEnd = () => {
      last = null;
      pointer.current.tx = 0;
      pointer.current.ty = 0;
    };

    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [gl]);

  // ---------------------------------------------------------------------
  // Attach everything to the scene graph
  // ---------------------------------------------------------------------
  useLayoutEffect(() => {
    const root = new THREE.Group();
    layers.forEach((l) => root.add(l.mesh));
    if (dust) root.add(dust.points);
    scene.add(root);
    group.current = root;
    return () => {
      scene.remove(root);
      group.current = null;
    };
  }, [scene, layers, dust]);

  const dayTarget = useCallback(() => DAY_TARGET[dayMode], [dayMode]);

  // ---------------------------------------------------------------------
  // Frame — priority 1, so R3F leaves the rendering to us
  // ---------------------------------------------------------------------
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    clock.current += dt;
    const t = clock.current;

    audio?.update(dt);
    const b = audio?.bands ?? { bass: 0, mid: 0, treble: 0, voice: 0, level: 0, beat: 0 };

    if (enter.current < 1) enter.current = Math.min(1, enter.current + dt / 1.8);
    const e = 1 - Math.pow(1 - enter.current, 3);

    // --- time of day -----------------------------------------------------
    if (dayMode === 'cycle') {
      // A full afternoon-to-night-and-back pass, slow enough to feel like
      // weather rather than a slider being dragged.
      const period = 74;
      const phase = (t % period) / period;
      day.current = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    } else {
      const target = dayTarget();
      day.current += (target - day.current) * Math.min(1, dt * 1.1);
    }

    // --- camera ----------------------------------------------------------
    const p = pointer.current;
    if (!reducedMotion) {
      // No cursor on a phone, so fall back to a slow drift — a scene that only
      // moves when a mouse moves is a scene that never moves on mobile.
      const tx = p.tx || Math.sin(t * 0.17) * 0.55;
      const ty = p.ty || Math.cos(t * 0.13) * 0.40;
      p.x += (tx - p.x) * Math.min(1, dt * 2.2);
      p.y += (ty - p.y) * Math.min(1, dt * 2.2);
    }
    scroll.current.v += (scroll.current.t - scroll.current.v) * Math.min(1, dt * 3.0);
    const s = scroll.current.v;

    const beatPush = b.beat * b.beat * 0.014;

    const sh = shift.current;
    camera.position.set(
      p.x * sh.x + Math.sin(t * 0.09) * sh.x * 0.09,
      -p.y * sh.y + s * sh.y * 0.55 + Math.sin(t * 0.11 + 2.0) * sh.y * 0.08,
      -s * sh.z + beatPush,
    );
    // A whisper of rotation on top of the translation. Translation alone is
    // correct but reads a little mechanical; this is the handheld in it.
    camera.rotation.set(p.y * 0.012, -p.x * 0.018, 0);
    camera.updateMatrixWorld(true);
    // gl.render() refreshes this itself, but the composite needs it *before*
    // the draw, so it is inverted here rather than a frame late.
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    // --- uniforms --------------------------------------------------------
    shared.uTime.value = t;
    shared.uDay.value = day.current;
    shared.uEnter.value = e;
    shared.uBass.value = b.bass;
    shared.uMid.value = b.mid;
    shared.uTreble.value = b.treble;
    shared.uLevel.value = b.level;

    if (dust) {
      dustUniforms.uTime.value = t;
      dustUniforms.uDay.value = day.current;
      dustUniforms.uBass.value = b.bass;
      dustUniforms.uTreble.value = b.treble;
      dustUniforms.uEnter.value = e;
    }

    const cu = compositeUniforms;
    cu.uTime.value = t;
    cu.uAspect.value = shared.uAspect.value;
    cu.uDay.value = day.current;
    cu.uEnter.value = e;
    cu.uBass.value = b.bass;
    cu.uMid.value = b.mid;
    cu.uTreble.value = b.treble;
    cu.uLevel.value = b.level;
    // The composite needs to walk a view ray back out to the window plane, so
    // it gets the inverse of whatever the camera is doing this frame.
    cu.uInvViewProj.value
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .invert();

    // --- render ----------------------------------------------------------
    gl.setRenderTarget(rt);
    gl.render(scene, camera);      // autoClear handles the wipe

    gl.setRenderTarget(null);
    gl.render(composite.quadScene, composite.quadCamera);

    onFrame?.(dt, b, day.current);
  }, 1);

  return null;
}
