// The simulation, written twice — once as a compute graph, once as a
// closed-form vertex graph — because the two backends genuinely differ in what
// they can do, and pretending otherwise would be the dishonest part.
//
// WebGPU path:  state lives in storage buffers. A compute pass integrates
//               velocity against a curl-shaped flow field every frame, so the
//               particles have history: they accumulate momentum, they get
//               shoved by the cursor and drift back, they age and respawn.
//
// WebGL2 path:  there is no compute stage and no storage buffer, so there is
//               nowhere to keep state. Position becomes a pure function of
//               (index, time) evaluated in the vertex stage. It looks close,
//               it costs less, and it cannot react to anything — which is
//               exactly what the panel on the page says it is doing.
//
// Both paths build their node graph with the same TSL, and both feed the same
// SpriteNodeMaterial. That shared surface is the reason this is one demo with
// two backends rather than two demos.

import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  instancedArray,
  instanceIndex,
  uniform,
  hash,
  vec2,
  vec3,
  vec4,
  float,
  time,
  deltaTime,
  mx_fractal_noise_vec3,
  length,
  normalize,
  smoothstep,
  clamp,
  mix,
  min,
  max,
  sin,
  cos,
  pow,
  exp,
  uv,
  dot,
  cross,
} from 'three/tsl';

export const PALETTE = {
  cold: new THREE.Color('#1b3fb8'),
  mid: new THREE.Color('#39b6ff'),
  hot: new THREE.Color('#ffe6c4'),
};

/** Shared tunables, exposed as uniforms so the HUD can read them back. */
export function createControls() {
  return {
    // Low frequency on purpose: a fine field scatters particles into fog,
    // a coarse one lets them travel together long enough to draw a line.
    flowScale: uniform(0.20),
    flowSpeed: uniform(0.05),
    flowStrength: uniform(4.6),
    // High drag is what makes the motion coherent — velocity converges on the
    // field direction in a few frames instead of ringing around it.
    drag: uniform(1.9),
    pointer: uniform(new THREE.Vector3(0, 0, 0)),
    pointerStrength: uniform(0.0),
    span: uniform(9.0),
    lifespan: uniform(7.0),
  };
}

// The flow field. Vector-valued fractal noise, then bent into something
// divergence-free-ish by crossing it with a second sample — a cheap stand-in
// for a true curl that costs two noise evaluations instead of six.
const flowAt = /*#__PURE__*/ Fn(([p, c]) => {
  const q = p.mul(c.flowScale).add(vec3(0.0, time.mul(c.flowSpeed), 0.0));
  const a = mx_fractal_noise_vec3(q, 3, 2.0, 0.5, 1.0);
  const b = mx_fractal_noise_vec3(q.add(vec3(17.3, 9.1, 31.7)), 2, 2.0, 0.5, 1.0);
  return normalize(cross(a, b).add(a.mul(0.35))).mul(c.flowStrength);
});

/** Emitter: a hollow-ish shell, so the cloud has an inside to see through. */
const spawnAt = /*#__PURE__*/ Fn(([seed, c]) => {
  const u = hash(seed).mul(2.0).sub(1.0);
  const phi = hash(seed.add(1013)).mul(6.28318);
  // A thin shell rather than a filled ball: particles born together stay
  // neighbours for a while, and neighbours are what make a visible stream.
  const r = c.span.mul(float(0.62).add(hash(seed.add(3571)).mul(0.30)));
  const s = float(1.0).sub(u.mul(u)).max(0.0).sqrt();
  return vec3(cos(phi).mul(s), u.mul(0.80), sin(phi).mul(s)).mul(r);
});

/**
 * WebGPU: storage buffers plus a compute pass.
 * Returns the node graph pieces and the buffers so the caller can report their
 * real byte size in the tech panel.
 */
export function buildComputeSim(count, controls) {
  const positions = instancedArray(count, 'vec3');
  const velocities = instancedArray(count, 'vec3');
  // x: age, y: lifespan
  const ages = instancedArray(count, 'vec2');

  const init = Fn(() => {
    const seed = instanceIndex.toFloat();
    positions.element(instanceIndex).assign(spawnAt(seed, controls));
    velocities.element(instanceIndex).assign(vec3(0.0));
    // Stagger the ages so the whole cloud does not respawn on the same frame.
    const span = controls.lifespan;
    ages
      .element(instanceIndex)
      .assign(vec2(hash(seed.add(77)).mul(span), span.mul(float(0.65).add(hash(seed.add(99)).mul(0.7)))));
  })().compute(count);

  const update = Fn(() => {
    const pos = positions.element(instanceIndex);
    const vel = velocities.element(instanceIndex);
    const age = ages.element(instanceIndex);

    // Clamped: a backgrounded tab comes back with a delta measured in seconds
    // and the integrator would throw every particle to infinity.
    const dt = min(deltaTime, float(1.0 / 30.0));

    const flow = flowAt(pos, controls);

    // Cursor force, falling off with distance. This is the part the WebGL2
    // path cannot do at all — it needs somewhere to remember the push.
    const toPointer = controls.pointer.sub(pos);
    const d = length(toPointer);
    const pull = normalize(toPointer)
      .mul(controls.pointerStrength)
      .mul(exp(d.mul(-0.22)))
      .mul(float(28.0));

    // Containment. Without a firm hand the curl field walks the cloud out of
    // frame within a minute, and a demo that empties itself is not a demo.
    const pullBack = pos.mul(-0.12).mul(smoothstep(controls.span.mul(0.55), controls.span, length(pos)).mul(16.0).add(1.0));

    const accel = flow.add(pull).add(pullBack);
    vel.addAssign(accel.sub(vel.mul(controls.drag)).mul(dt));
    pos.addAssign(vel.mul(dt));

    age.x.addAssign(dt);
    If(age.x.greaterThan(age.y), () => {
      const seed = instanceIndex.toFloat().add(time.mul(37.0));
      pos.assign(spawnAt(seed, controls));
      vel.assign(vec3(0.0));
      age.x.assign(0.0);
    });
  })().compute(count);

  // vec3 is padded to 16 bytes in std430; vec2 to 8. Reported as-is on the
  // page rather than rounded down to the pretty number.
  const bytes = count * (16 + 16 + 8);

  return { positions, velocities, ages, init, update, bytes };
}

/**
 * WebGL2: no compute, no state. Position is a closed-form function of index
 * and time, evaluated per vertex.
 */
export function buildStatelessSim(controls) {
  const positionNode = Fn(() => {
    const seed = instanceIndex.toFloat();
    const t = time.mul(0.22).add(hash(seed.add(5)).mul(6.28318));

    const base = spawnAt(seed, controls);

    // A drift that loops instead of integrating: three offset noise samples of
    // the base position, walked around a small circle in time.
    const wobble = mx_fractal_noise_vec3(
      base.mul(controls.flowScale.mul(0.8)).add(vec3(cos(t).mul(0.6), time.mul(0.05), sin(t).mul(0.6))),
      3,
      2.0,
      0.5,
      1.0,
    );

    const swirlAngle = t.mul(0.5).add(length(base).mul(0.18));
    const swirl = vec3(
      base.x.mul(cos(swirlAngle)).sub(base.z.mul(sin(swirlAngle))),
      base.y,
      base.x.mul(sin(swirlAngle)).add(base.z.mul(cos(swirlAngle))),
    );

    return mix(base, swirl, 0.85).add(wobble.mul(1.9));
  })();
  // Note the trailing (): Fn() builds a function node, calling it produces the
  // node the material can actually consume. three renders anyway if you forget,
  // which is how this shipped a console warning the first time round.

  return { positionNode, bytes: 0 };
}

/**
 * The material both paths share. `speedNode` is what drives the colour ramp;
 * the compute path hands it a real velocity, the stateless path an estimate.
 */
export function buildMaterial({ positionNode, speedNode, fadeNode, controls }) {
  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });

  material.positionNode = positionNode;

  // Terminal speed is flowStrength/drag, so the ramp is normalised against
  // that rather than a magic number — retuning the field no longer flattens
  // the colour to a single blue.
  const terminal = controls.flowStrength.div(controls.drag);
  const speed = clamp(speedNode.div(terminal), 0.0, 1.0);
  // In a curl field almost everything travels at terminal speed, so a linear
  // ramp puts the whole cloud at the hot end. The warm colour is reserved for
  // the top slice — vortex cores — and everything else stays blue.
  const warm = mix(
    vec3(PALETTE.cold.r, PALETTE.cold.g, PALETTE.cold.b),
    vec3(PALETTE.mid.r, PALETTE.mid.g, PALETTE.mid.b),
    smoothstep(0.25, 0.78, speed),
  );
  const tint = mix(warm, vec3(PALETTE.hot.r, PALETTE.hot.g, PALETTE.hot.b), smoothstep(0.88, 1.0, speed));

  // Round sprite with a soft core. Cheaper than a texture and there is nothing
  // to download.
  const d = length(uv().sub(0.5));
  const alpha = exp(d.mul(d).mul(-26.0)).mul(smoothstep(0.5, 0.42, d));

  // Fade in and out over the particle's life, so respawn is not a pop and the
  // cloud gets density variation for free. The stateless path has no life to
  // read, so it passes 1.
  const life = fadeNode ?? float(1.0);

  // A quarter of a million additive sprites overlap hard. Per-particle output
  // has to stay small or dense regions clip to white and all the structure the
  // flow field just produced is lost inside it.
  material.colorNode = vec4(tint.mul(float(0.14).add(pow(speed, 3.0).mul(0.85))), alpha.mul(life).mul(0.62));
  material.scaleNode = float(0.020).add(pow(speed, 2.0).mul(0.026));

  return material;
}
