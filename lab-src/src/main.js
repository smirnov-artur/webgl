import * as THREE from 'three/webgpu';
import { float, length, smoothstep, uniform, vec3, instanceIndex, time, hash } from 'three/tsl';

import { detectBackend, pickCount } from './capability.js';
import { buildComputeSim, buildStatelessSim, buildMaterial, createControls } from './particles.js';
import { mountHud } from './hud.js';
import './styles.css';

const canvas = document.getElementById('scene');
const controls = createControls();

async function boot() {
  const report = await detectBackend();
  const count = pickCount(report);
  const usingCompute = report.backend === 'webgpu';

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false, // additive sprites have no edges to alias
    alpha: false,
    forceWebGL: !usingCompute,
    powerPreference: 'high-performance',
    // Hand three the device we already validated instead of letting it request
    // a second one.
    device: report.device,
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, usingCompute ? 2 : 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x05060a, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  await renderer.init();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 1.6, 23);
  camera.lookAt(0, 0, 0);

  // --- the two graphs ----------------------------------------------------
  let sim;
  let positionNode;
  let speedNode;
  let fadeNode;

  if (usingCompute) {
    sim = buildComputeSim(count, controls);
    positionNode = sim.positions.toAttribute();
    speedNode = length(sim.velocities.toAttribute());
    // age.x / age.y, shaped into an ease in and out across the lifetime.
    const age = sim.ages.toAttribute();
    fadeNode = smoothstep(0.0, 0.12, age.x.div(age.y)).mul(
      smoothstep(1.0, 0.72, age.x.div(age.y)),
    );
    await renderer.computeAsync(sim.init);
  } else {
    sim = buildStatelessSim(controls);
    positionNode = sim.positionNode;
    // No velocity to read, so the colour ramp gets a stand-in that at least
    // varies per particle instead of a flat value pretending to be speed.
    speedNode = hash(instanceIndex.toFloat().add(3.0))
      .mul(controls.flowStrength.div(controls.drag))
      .mul(0.9);
  }

  const material = buildMaterial({ positionNode, speedNode, fadeNode, controls });
  const particles = new THREE.Sprite(material);
  particles.count = count;
  particles.frustumCulled = false;
  scene.add(particles);

  // --- input -------------------------------------------------------------
  const pointer = { x: 0, y: 0, active: false };
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ray = new THREE.Raycaster();
  const hit = new THREE.Vector3();
  const ndc = new THREE.Vector2();

  function onMove(e) {
    const p = e.touches?.[0] ?? e;
    ndc.set((p.clientX / window.innerWidth) * 2 - 1, -(p.clientY / window.innerHeight) * 2 + 1);
    pointer.active = true;
  }
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onMove, { passive: true });
  window.addEventListener('pointerleave', () => (pointer.active = false), { passive: true });
  window.addEventListener('touchmove', onMove, { passive: true });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- hud ---------------------------------------------------------------
  const hud = mountHud({ report, count, bytes: sim.bytes, usingCompute, renderer });

  // --- loop --------------------------------------------------------------
  const clock = new THREE.Clock();
  let acc = 0;
  let frames = 0;
  let smoothedMs = 16.7;

  renderer.setAnimationLoop(async () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const started = performance.now();

    // Cursor projected onto the plane through the origin facing the camera.
    if (pointer.active) {
      ray.setFromCamera(ndc, camera);
      plane.normal.copy(camera.getWorldDirection(new THREE.Vector3())).negate();
      plane.constant = 0;
      if (ray.ray.intersectPlane(plane, hit)) controls.pointer.value.copy(hit);
    }
    controls.pointerStrength.value +=
      ((pointer.active ? 1 : 0) - controls.pointerStrength.value) * Math.min(1, dt * 2.4);

    // Slow orbit, so the volume reads as a volume.
    const r = 23;
    camera.position.set(Math.sin(t * 0.055) * r, 1.6 + Math.sin(t * 0.037) * 1.4, Math.cos(t * 0.055) * r);
    camera.lookAt(0, 0, 0);

    if (usingCompute) renderer.compute(sim.update);
    await renderer.renderAsync(scene, camera);

    const ms = performance.now() - started;
    smoothedMs += (ms - smoothedMs) * 0.06;

    acc += dt;
    frames++;
    if (acc >= 0.25) {
      hud.tick(frames / acc, smoothedMs);
      acc = 0;
      frames = 0;
    }
  });

  document.body.classList.add('ready');
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('fatal').textContent =
    `Could not start: ${err?.message ?? err}. This page needs WebGL2 at minimum.`;
  document.body.classList.add('fatal');
});
