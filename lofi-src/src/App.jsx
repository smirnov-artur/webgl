import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

import LofiScene from './LofiScene.jsx';
import { AudioEngine } from './audio.js';
import { TIERS, PerfGovernor, pickInitialTier, isMobile } from './quality.js';

const STATUS = {
  idle: 'Drifting on its own — press play for the loop.',
  music: 'Generated in the browser. No audio file anywhere in this demo.',
  requesting: 'Waiting for microphone permission…',
  live: 'Live microphone — play something into it.',
  denied: 'Microphone blocked — the scene keeps drifting on its own.',
  unsupported: 'No microphone available — the scene keeps drifting on its own.',
  error: 'Audio failed to start — the scene keeps drifting on its own.',
  silent: 'Silent.',
};

const MOODS = [
  ['cycle', 'Cycle'],
  ['day', 'Afternoon'],
  ['golden', 'Golden'],
  ['night', 'Night'],
];

const PHASE = (d) => (d < 0.28 ? 'afternoon' : d < 0.62 ? 'golden' : 'night');

export default function App() {
  const audio = useMemo(() => new AudioEngine(), []);

  const { initialTier, locked } = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    const want = q.get('tier');
    return { initialTier: TIERS[want] ? want : pickInitialTier(), locked: q.has('lock') };
  }, []);

  const [tier, setTier] = useState(initialTier);
  const [mood, setMood] = useState('cycle');
  const [source, setSource] = useState('idle');
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState(STATUS.idle);

  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );

  const quality = TIERS[tier];
  const governor = useMemo(() => new PerfGovernor(initialTier), [initialTier]);

  // Written straight to the DOM from the render loop. Sixty setState calls a
  // second would re-render this tree on every frame, which is the one thing
  // guaranteed to cost more than the shaders do.
  const fpsEl = useRef(null);
  const phaseEl = useRef(null);
  const barBass = useRef(null);
  const barMid = useRef(null);
  const barTreble = useRef(null);
  const acc = useRef({ t: 0, frames: 0 });

  useEffect(() => {
    audio.onStatus = (s, msg) => {
      setStatus(s);
      setStatusMsg(msg || STATUS[s] || '');
      if (s === 'music') setSource('music');
      else if (s === 'live') setSource('mic');
      else if (s === 'denied' || s === 'unsupported' || s === 'error') setSource('idle');
    };
    return () => audio.dispose();
  }, [audio]);

  const onFrame = useCallback(
    (dt, bands, day) => {
      const next = governor.sample(dt);
      if (next && !locked) setTier(next);

      const a = acc.current;
      a.t += dt;
      a.frames++;
      if (a.t >= 0.25) {
        if (fpsEl.current) fpsEl.current.textContent = String(Math.round(a.frames / a.t));
        if (phaseEl.current) phaseEl.current.textContent = PHASE(day);
        a.t = 0;
        a.frames = 0;
      }

      if (barBass.current) barBass.current.style.transform = `scaleX(${bands.bass.toFixed(3)})`;
      if (barMid.current) barMid.current.style.transform = `scaleX(${bands.mid.toFixed(3)})`;
      if (barTreble.current) barTreble.current.style.transform = `scaleX(${bands.treble.toFixed(3)})`;
    },
    [governor, locked],
  );

  const pickSource = (next) => {
    setSource(next);
    audio.setMode(next);
    if (next === 'idle' || next === 'off') {
      setStatus(next === 'off' ? 'silent' : 'idle');
      setStatusMsg(next === 'off' ? STATUS.silent : STATUS.idle);
    }
  };

  const dpr = useMemo(
    () => [1, Math.min(window.devicePixelRatio || 1, quality.dprCap)],
    [quality.dprCap],
  );

  return (
    <div className="app">
      <Canvas
        className="canvas"
        dpr={dpr}
        gl={{
          antialias: false, // every edge in this scene is analytic; MSAA would
          // only smooth the fullscreen quad, which has no edges
          powerPreference: 'high-performance',
          alpha: false,
          stencil: false,
          depth: false,
        }}
        camera={{ fov: 34, position: [0, 0, 0], near: 0.1, far: 200 }}
        onCreated={({ gl }) => {
          // Tone mapping happens by hand in the composite, so three must not
          // apply a second curve on top of it.
          gl.toneMapping = THREE.NoToneMapping;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.autoClear = true;
        }}
      >
        <LofiScene
          audio={audio}
          quality={quality}
          dayMode={mood}
          onFrame={onFrame}
          reducedMotion={reducedMotion}
        />
      </Canvas>

      <header className="title">
        <h1>Late Shift</h1>
        <p>
          Five camera-mapped planes, projected from one fixed viewpoint. The
          parallax is the projection, not a per-layer offset. Hand-written GLSL,
          every texture procedural.
        </p>
      </header>

      <div className="hud" aria-hidden="true">
        <div className="hud-row hud-fps">
          <span ref={fpsEl}>60</span>
          <small>fps</small>
        </div>
        <div className="hud-row">
          <small>tier</small>
          <span className="hud-val">{tier}</span>
        </div>
        <div className="hud-row">
          <small>dpr</small>
          <span className="hud-val">{dpr[1].toFixed(2)}</span>
        </div>
        <div className="hud-row">
          <small>layers</small>
          <span className="hud-val">6</span>
        </div>
        <div className="hud-row">
          <small>light</small>
          <span className="hud-val" ref={phaseEl}>
            golden
          </span>
        </div>
      </div>

      <div className="meters" aria-hidden="true">
        <div className="meter">
          <label>low</label>
          <div className="track">
            <i ref={barBass} className="fill fill-low" />
          </div>
        </div>
        <div className="meter">
          <label>mid</label>
          <div className="track">
            <i ref={barMid} className="fill fill-mid" />
          </div>
        </div>
        <div className="meter">
          <label>high</label>
          <div className="track">
            <i ref={barTreble} className="fill fill-high" />
          </div>
        </div>
      </div>

      <div className="controls">
        <div className="segmented" role="group" aria-label="Time of day">
          {MOODS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={mood === key ? 'on' : ''}
              aria-pressed={mood === key}
              onClick={() => setMood(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="segmented" role="group" aria-label="Audio source">
          <button
            type="button"
            className={source === 'music' ? 'on' : ''}
            aria-pressed={source === 'music'}
            onClick={() => pickSource(source === 'music' ? 'idle' : 'music')}
          >
            {source === 'music' ? 'Pause' : 'Play the loop'}
          </button>
          <button
            type="button"
            className={source === 'mic' ? 'on' : ''}
            aria-pressed={source === 'mic'}
            onClick={() => pickSource('mic')}
          >
            {status === 'requesting' ? 'Asking…' : 'Microphone'}
          </button>
        </div>

        <p className={`status ${status === 'denied' || status === 'error' ? 'warn' : ''}`}>
          {statusMsg}
        </p>
      </div>

      <footer className="foot">
        <a href="https://github.com/smirnov-artur/webgl/tree/main/lofi-src" rel="noopener">
          source
        </a>
        <span className="dot" />
        <a href="https://smirnov-artur.github.io/webgl/" rel="noopener">
          artur smirnov
        </a>
        <span className="hint">{isMobile() ? 'drag to move' : 'move the cursor · scroll'}</span>
      </footer>
    </div>
  );
}
