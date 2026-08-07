import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

import ObsidianOrb from './ObsidianOrb.jsx';
import { AudioEngine } from './audio.js';
import { TIERS, PerfGovernor, pickInitialTier, isMobile } from './quality.js';

const TRIS = { 4: '5 120', 5: '20 480', 6: '81 920' };

const STATUS_TEXT = {
  idle: 'Synthetic envelope — no microphone needed.',
  requesting: 'Waiting for microphone permission…',
  live: 'Live microphone. Speak, sing, or play something.',
  denied: 'Microphone blocked — running the synthetic envelope instead.',
  unsupported: 'No microphone available — running the synthetic envelope instead.',
  error: 'Audio failed to start — running the synthetic envelope instead.',
};

/**
 * Governor + HUD live here rather than inside the orb so the component stays a
 * component: quality is a prop, and the host app decides how to pick it.
 */
export default function App() {
  const audio = useMemo(() => new AudioEngine(), []);

  // ?tier=low|medium|high pins the starting tier and ?lock stops the governor
  // from moving off it. Handy for checking the mobile path from a desktop
  // without a phone, and for reproducing a report.
  const { initialTier, locked } = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    const want = q.get('tier');
    return {
      initialTier: TIERS[want] ? want : pickInitialTier(),
      locked: q.has('lock'),
    };
  }, []);

  const [tier, setTier] = useState(initialTier);
  const [mode, setMode] = useState('demo');
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState(STATUS_TEXT.idle);

  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );

  const quality = TIERS[tier];
  const governor = useMemo(() => new PerfGovernor(initialTier), [initialTier]);

  // Everything below is written straight to the DOM from the render loop.
  // Putting FPS or band levels in state would re-render this tree 60 times a
  // second, which is exactly the mistake that makes an orb like this drop
  // frames on a phone.
  const fpsEl = useRef(null);
  const barBass = useRef(null);
  const barVoice = useRef(null);
  const barTreble = useRef(null);
  const hudAcc = useRef({ t: 0, frames: 0 });

  useEffect(() => {
    audio.onStatus = (s, msg) => {
      setStatus(s);
      setStatusMsg(msg || STATUS_TEXT[s] || '');
      if (s === 'live') setMode('mic');
      else if (s === 'denied' || s === 'unsupported' || s === 'error') setMode('demo');
    };
    return () => audio.dispose();
  }, [audio]);

  const onFrame = useCallback(
    (dt, bands) => {
      const next = governor.sample(dt);
      if (next && !locked) setTier(next);

      const acc = hudAcc.current;
      acc.t += dt;
      acc.frames++;
      if (acc.t >= 0.25) {
        const fps = Math.round(acc.frames / acc.t);
        if (fpsEl.current) fpsEl.current.textContent = String(fps).padStart(2, '0');
        acc.t = 0;
        acc.frames = 0;
      }

      if (barBass.current) barBass.current.style.transform = `scaleX(${bands.bass.toFixed(3)})`;
      if (barVoice.current) barVoice.current.style.transform = `scaleX(${bands.voice.toFixed(3)})`;
      if (barTreble.current) barTreble.current.style.transform = `scaleX(${bands.treble.toFixed(3)})`;
    },
    [governor, locked],
  );

  const pick = (next) => {
    setMode(next);
    audio.setMode(next);
    if (next !== 'mic') {
      setStatus('idle');
      setStatusMsg(next === 'off' ? 'Silent — the orb idles.' : STATUS_TEXT.idle);
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
          antialias: TIERS[initialTier].antialias,
          powerPreference: 'high-performance',
          alpha: false,
          stencil: false,
          depth: true,
        }}
        camera={{ fov: 32, position: [0, 0, 4.6], near: 0.1, far: 24 }}
        onCreated={({ gl, scene }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.15;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          scene.background = new THREE.Color(0x000000);
        }}
      >
        <ObsidianOrb
          audio={audio}
          quality={quality}
          onFrame={onFrame}
          reducedMotion={reducedMotion}
        />
      </Canvas>

      <header className="title">
        <h1>Obsidian Orb</h1>
        <p>
          Audio-reactive React Three Fiber component. Hand-written GLSL — no
          MeshTransmissionMaterial, no post-processing pass.
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
          <small>tris</small>
          <span className="hud-val">{TRIS[quality.detail]}</span>
        </div>
        <div className="hud-row">
          <small>passes</small>
          <span className="hud-val">2</span>
        </div>
      </div>

      <div className="meters" aria-hidden="true">
        <div className="meter">
          <label>bass</label>
          <div className="track">
            <i ref={barBass} className="fill fill-bass" />
          </div>
        </div>
        <div className="meter">
          <label>voice</label>
          <div className="track">
            <i ref={barVoice} className="fill fill-voice" />
          </div>
        </div>
        <div className="meter">
          <label>treble</label>
          <div className="track">
            <i ref={barTreble} className="fill fill-treble" />
          </div>
        </div>
      </div>

      <div className="controls">
        <div className="segmented" role="group" aria-label="Audio source">
          <button
            type="button"
            className={mode === 'mic' ? 'on' : ''}
            aria-pressed={mode === 'mic'}
            onClick={() => pick('mic')}
          >
            {status === 'requesting' ? 'Asking…' : 'Microphone'}
          </button>
          <button
            type="button"
            className={mode === 'demo' ? 'on' : ''}
            aria-pressed={mode === 'demo'}
            onClick={() => pick('demo')}
          >
            Synthetic
          </button>
          <button
            type="button"
            className={mode === 'off' ? 'on' : ''}
            aria-pressed={mode === 'off'}
            onClick={() => pick('off')}
          >
            Silent
          </button>
        </div>
        <p className={`status ${status === 'denied' || status === 'error' ? 'warn' : ''}`}>
          {statusMsg}
        </p>
      </div>

      <footer className="foot">
        <a href="https://github.com/smirnov-artur/webgl/tree/main/orb-src" rel="noopener">
          source
        </a>
        <span className="dot" />
        <a href="https://smirnov-artur.github.io/webgl/" rel="noopener">
          artur smirnov
        </a>
        {isMobile() ? null : <span className="hint">move the cursor</span>}
      </footer>
    </div>
  );
}
