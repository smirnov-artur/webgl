// <ObsidianOrb /> — the whole component, drop-in.
//
//   <Canvas>
//     <ObsidianOrb audio={engine} quality={TIERS.high} />
//   </Canvas>
//
// `audio` is anything exposing `.bands = { bass, mid, treble, voice, level, pulse }`
// and an `.update(dt)`; swap in your own analyser and nothing else changes.
//
// The component renders in two passes:
//   1. the back of the orb into a half-resolution target (normals + distance)
//   2. the front, refracting through both surfaces
// and it never calls setState. Every audio-driven value is written straight
// into a uniform inside useFrame.

import { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import {
  orbVert,
  orbFrag,
  backfaceFrag,
  haloVert,
  haloFrag,
  dustVert,
  dustFrag,
} from './shaders';

export const ORB_LOOK = {
  ior: 1.46,
  dispersion: 0.030,
  // Per-channel absorption. Red goes first, so a thick path through the middle
  // reads black and a thin path at the rim keeps a cold blue — that difference
  // is the whole obsidian look, and it comes out of the thickness, not a tint.
  absorb: new THREE.Color(3.4, 2.9, 2.1),
  reflectivity: 1.0,
  coreColor: new THREE.Color('#4ba8ff'),
  coreIntensity: 1.0,
  veinColor: new THREE.Color('#2f7dff'),
  rimColor: new THREE.Color('#6fb4ff'),
  glowColor: new THREE.Color('#2e7fff'),
  accentColor: new THREE.Color('#9ad6ff'),
  keyColor: new THREE.Color(0.95, 0.97, 1.0),
  fillColor: new THREE.Color(0.10, 0.21, 0.46),
  backColor: new THREE.Color(0.34, 0.18, 0.58),
};

function makeOrbUniforms(quality) {
  return {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uTreble: { value: 0 },
    uVoice: { value: 0 },
    uLevel: { value: 0 },
    uEnter: { value: 0 },
    uAmp: { value: 1 },
    uFreq: { value: 2.35 },

    uCamPos: { value: new THREE.Vector3() },
    uCenter: { value: new THREE.Vector3() },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCenterDist: { value: 5 },
    uDepthScale: { value: 4 },
    uBackface: { value: null },
    uHasBackface: { value: 1 },

    uIOR: { value: ORB_LOOK.ior },
    uDispersion: { value: quality.dispersion ? ORB_LOOK.dispersion : 0 },
    uAbsorb: { value: ORB_LOOK.absorb.clone() },
    uReflectivity: { value: ORB_LOOK.reflectivity },
    uCoreColor: { value: ORB_LOOK.coreColor.clone() },
    uCoreIntensity: { value: ORB_LOOK.coreIntensity },
    uVeinColor: { value: ORB_LOOK.veinColor.clone() },
    uRimColor: { value: ORB_LOOK.rimColor.clone() },

    uKeyDir: { value: new THREE.Vector3(0.42, 0.68, 0.60).normalize() },
    uKeyColor: { value: ORB_LOOK.keyColor.clone() },
    uFillDir: { value: new THREE.Vector3(-0.75, -0.10, 0.65).normalize() },
    uFillColor: { value: ORB_LOOK.fillColor.clone() },
    uBackDir: { value: new THREE.Vector3(-0.15, 0.35, -0.92).normalize() },
    uBackColor: { value: ORB_LOOK.backColor.clone() },
  };
}

export default function ObsidianOrb({
  audio,
  quality,
  radius = 1,
  onFrame,
  reducedMotion = false,
}) {
  const { gl, size, viewport, camera } = useThree();

  const group = useRef();
  const orbMesh = useRef();
  const haloMesh = useRef();
  const dustPoints = useRef();

  const enter = useRef(0);
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const clock = useRef({ t: 0 });
  const prevClear = useRef(new THREE.Color());

  // --- geometry ------------------------------------------------------------
  // Rebuilt only when the tier changes. Icosahedron rather than a UV sphere:
  // even triangle area, so the noise displacement has no pole pinch.
  const geometry = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(radius, quality.detail);
    g.deleteAttribute('uv'); // unused; keeps the buffer smaller
    return g;
  }, [radius, quality.detail]);

  useLayoutEffect(() => () => geometry.dispose(), [geometry]);

  // --- materials -----------------------------------------------------------
  const uniforms = useMemo(() => makeOrbUniforms(quality), [quality.name]);

  const defines = useMemo(
    () => ({
      FBM_OCTAVES: quality.fbmOctaves,
      ...(quality.dispersion ? { DISPERSION: '' } : {}),
      ...(quality.hqVeins ? { HQ_VEINS: '' } : {}),
    }),
    [quality.name],
  );

  const frontMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: orbVert,
        fragmentShader: orbFrag,
        uniforms,
        defines,
        side: THREE.FrontSide,
        transparent: false,
      }),
    [uniforms, defines],
  );

  const backMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: orbVert,
        fragmentShader: backfaceFrag,
        // Shares the uniform objects with the front pass, so the two surfaces
        // are guaranteed to be displaced identically — a duplicated uniform
        // set here would show up as a one-frame shear in the refraction.
        uniforms,
        defines: { FBM_OCTAVES: quality.fbmOctaves },
        side: THREE.BackSide,
        toneMapped: false,
      }),
    [uniforms, quality.fbmOctaves],
  );

  useLayoutEffect(
    () => () => {
      frontMaterial.dispose();
      backMaterial.dispose();
    },
    [frontMaterial, backMaterial],
  );

  // --- backface target -----------------------------------------------------
  // Half float where it is available: the alpha channel carries a distance,
  // and 8 bits of it shows up as rings in the Beer-Lambert falloff. Falls back
  // to bytes rather than failing on a device without the extension.
  const rt = useMemo(() => {
    const ctx = gl.getContext();
    const halfFloat =
      ctx.getExtension('EXT_color_buffer_half_float') || ctx.getExtension('EXT_color_buffer_float');
    const target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.colorSpace = THREE.NoColorSpace; // it holds normals, not colour
    target.texture.generateMipmaps = false;
    return target;
  }, [gl]);

  useLayoutEffect(() => () => rt.dispose(), [rt]);

  // A private scene holding a second mesh over the *same* geometry buffer.
  // Rendering the backface pass this way means the main scene is never
  // traversed twice and nothing else leaks into the target.
  const backScene = useMemo(() => new THREE.Scene(), []);
  const backMesh = useMemo(() => new THREE.Mesh(geometry, backMaterial), [geometry, backMaterial]);

  useLayoutEffect(() => {
    backMesh.matrixAutoUpdate = false;
    backMesh.frustumCulled = false;
    backScene.add(backMesh);
    return () => backScene.remove(backMesh);
  }, [backScene, backMesh]);

  useLayoutEffect(() => {
    const dpr = gl.getPixelRatio();
    const w = Math.max(2, Math.floor(size.width * dpr * quality.rtScale));
    const h = Math.max(2, Math.floor(size.height * dpr * quality.rtScale));
    rt.setSize(w, h);
    uniforms.uBackface.value = rt.texture;
    uniforms.uResolution.value.set(size.width * dpr, size.height * dpr);
  }, [gl, size.width, size.height, quality.rtScale, rt, uniforms, viewport.dpr]);

  // --- framing -------------------------------------------------------------
  // Dolly the camera so the orb keeps the same share of the *narrow* axis. A
  // fixed camera distance is what makes a centred sphere spill off the sides
  // of a phone in portrait, and no amount of CSS fixes that afterwards.
  useLayoutEffect(() => {
    const aspect = size.width / Math.max(size.height, 1);
    const share = size.width < 720 ? 0.78 : 0.66;
    const span = radius * 2.3; // orb plus room for the loudest displacement
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const d = aspect < 1
      ? span / (2 * tan * aspect * share)
      : span / (2 * tan * share);

    camera.position.set(0, 0, d);
    camera.near = Math.max(0.05, d - radius * 3);
    camera.far = d + radius * 6;
    camera.updateProjectionMatrix();

    uniforms.uDepthScale.value = radius * 4;
  }, [camera, size.width, size.height, radius, uniforms]);

  // --- halo ----------------------------------------------------------------
  const haloHalf = radius * 2.6;
  const haloUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uVoice: { value: 0 },
      uLevel: { value: 0 },
      uEnter: { value: 0 },
      uPulse: { value: 1 },
      uOrbRadius: { value: radius },
      uPlaneHalf: { value: haloHalf },
      uGlowColor: { value: ORB_LOOK.glowColor.clone() },
      uAccentColor: { value: ORB_LOOK.accentColor.clone() },
    }),
    [radius, haloHalf],
  );

  const haloMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: haloVert,
        fragmentShader: haloFrag,
        uniforms: haloUniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false, // drawn after the orb, so the rim spills over it
      }),
    [haloUniforms],
  );

  // --- dust ----------------------------------------------------------------
  const dust = useMemo(() => {
    const count = quality.dust;
    if (!count) return null;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Even distribution on a shell, biased outward so nothing sits inside
      // the glass where it would look like dirt.
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      // Hugging the orb rather than filling the frame — the shell should read
      // as motes caught in the rim light, not as a background.
      const r = radius * (1.22 + Math.pow(Math.random(), 1.8) * 0.85);
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(phi) * s * r;
      pos[i * 3 + 1] = u * r * 0.75;
      pos[i * 3 + 2] = Math.sin(phi) * s * r;
      seed[i * 3] = Math.random();
      seed[i * 3 + 1] = Math.random() * Math.PI * 2;
      seed[i * 3 + 2] = 0.45 + Math.random() * 1.05;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    return g;
  }, [quality.dust, radius]);

  const dustUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uTreble: { value: 0 },
      uVoice: { value: 0 },
      uEnter: { value: 0 },
      uPixelRatio: { value: 1 },
      uColor: { value: new THREE.Color('#8ec5ff') },
    }),
    [],
  );

  const dustMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: dustVert,
        fragmentShader: dustFrag,
        uniforms: dustUniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [dustUniforms],
  );

  useLayoutEffect(() => {
    dustUniforms.uPixelRatio.value = gl.getPixelRatio();
  }, [gl, dustUniforms, viewport.dpr, size.width]);

  useLayoutEffect(
    () => () => {
      haloMaterial.dispose();
      dustMaterial.dispose();
      dust?.dispose();
    },
    [haloMaterial, dustMaterial, dust],
  );

  // --- pointer -------------------------------------------------------------
  useLayoutEffect(() => {
    const el = gl.domElement;
    const onMove = (e) => {
      const rect = el.getBoundingClientRect();
      const p = e.touches?.[0] ?? e;
      pointer.current.tx = ((p.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.current.ty = ((p.clientY - rect.top) / rect.height) * 2 - 1;
    };
    const onLeave = () => {
      pointer.current.tx = 0;
      pointer.current.ty = 0;
    };
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [gl]);

  // --- frame ---------------------------------------------------------------
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    clock.current.t += dt;
    const t = clock.current.t;

    audio?.update(dt);
    const b = audio?.bands ?? { bass: 0, mid: 0, treble: 0, voice: 0, level: 0, pulse: 1 };

    // Entrance: 1.5 s ease-out, driven off the same clock as everything else.
    if (enter.current < 1) enter.current = Math.min(1, enter.current + dt / 1.5);
    const e = 1 - Math.pow(1 - enter.current, 3);

    const u = uniforms;
    u.uTime.value = t;
    u.uBass.value = b.bass;
    u.uMid.value = b.mid;
    u.uTreble.value = b.treble;
    u.uVoice.value = b.voice;
    u.uLevel.value = b.level;
    u.uEnter.value = e;
    u.uCamPos.value.copy(camera.position);

    if (group.current) {
      group.current.getWorldPosition(u.uCenter.value);
      u.uCenterDist.value = camera.position.distanceTo(u.uCenter.value);

      // Pointer parallax, critically damped. Where there is no cursor the
      // target falls back to a slow drift, so a phone never shows a dead orb.
      const p = pointer.current;
      if (!reducedMotion) {
        const tx = p.tx || Math.sin(t * 0.21) * 0.55;
        const ty = p.ty || Math.cos(t * 0.17) * 0.35;
        p.x += (tx - p.x) * Math.min(1, dt * 2.6);
        p.y += (ty - p.y) * Math.min(1, dt * 2.6);
        group.current.rotation.y = p.x * 0.32 + t * 0.045;
        group.current.rotation.x = p.y * 0.22;
        group.current.position.y = Math.sin(t * 0.55) * 0.028 * e;
      }
      group.current.scale.setScalar(0.86 + 0.14 * e);
    }

    // Pass 1: back of the orb into the reduced-resolution target.
    if (orbMesh.current) {
      orbMesh.current.updateWorldMatrix(true, false);
      backMesh.matrix.copy(orbMesh.current.matrixWorld);
      backMesh.matrixWorldNeedsUpdate = true;

      const prevTarget = gl.getRenderTarget();
      gl.getClearColor(prevClear.current);
      const prevAlpha = gl.getClearAlpha();

      gl.setRenderTarget(rt);
      gl.setClearColor(0x000000, 0);
      gl.clear(true, true, false);
      gl.render(backScene, camera);

      gl.setRenderTarget(prevTarget);
      gl.setClearColor(prevClear.current, prevAlpha);
      u.uHasBackface.value = 1;
    }

    const h = haloUniforms;
    h.uTime.value = t;
    h.uBass.value = b.bass;
    h.uMid.value = b.mid;
    h.uTreble.value = b.treble;
    h.uVoice.value = b.voice;
    h.uLevel.value = b.level;
    h.uPulse.value = b.pulse;
    h.uEnter.value = e;
    h.uOrbRadius.value = radius * (0.86 + 0.14 * e) * (1 + b.bass * 0.055 + b.level * 0.018);

    if (dust) {
      const d = dustUniforms;
      d.uTime.value = t;
      d.uBass.value = b.bass;
      d.uTreble.value = b.treble;
      d.uVoice.value = b.voice;
      d.uEnter.value = e;
    }

    onFrame?.(dt, b);
  }, 0);

  return (
    <>
      <group ref={group}>
        <mesh ref={orbMesh} geometry={geometry} material={frontMaterial} frustumCulled={false} />
        {dust && (
          <points ref={dustPoints} geometry={dust} material={dustMaterial} frustumCulled={false} />
        )}
      </group>
      {/* Outside the parallax group on purpose: the halo has to stay square to
          the camera, otherwise the rim glow shears off the silhouette. */}
      <mesh ref={haloMesh} material={haloMaterial} renderOrder={20} frustumCulled={false}>
        <planeGeometry args={[haloHalf * 2, haloHalf * 2]} />
      </mesh>
    </>
  );
}
