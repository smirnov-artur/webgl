// Capability detection, done properly.
//
// `if (navigator.gpu)` is not a WebGPU check. The property exists on browsers
// where no adapter can actually be acquired — a machine with a blocklisted
// driver, a headless browser, a VM, a locked-down enterprise profile. The only
// honest test is to ask for an adapter and then a device, and to keep what it
// tells you.
//
// This runs before anything is built, so the page can pick a backend rather
// than construct a WebGPU renderer and hope.

export async function detectBackend() {
  const report = {
    backend: 'webgl2',
    reason: '',
    forced: false,
    adapter: null,
    limits: null,
    features: [],
  };

  // ?webgl forces the fallback so the two backends can be compared on the same
  // machine. The panel reports this as forced rather than detected — a demo
  // that lets you fake its own capability check and does not admit it is worse
  // than one with no check at all.
  if (new URLSearchParams(location.search).has('webgl')) {
    report.reason = 'WebGL2 path forced with ?webgl';
    report.forced = true;
    return report;
  }

  if (typeof navigator === 'undefined' || !navigator.gpu) {
    report.reason = 'navigator.gpu is not exposed by this browser';
    return report;
  }

  let adapter;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch (err) {
    report.reason = `requestAdapter threw: ${err?.message ?? err}`;
    return report;
  }

  if (!adapter) {
    report.reason = 'navigator.gpu exists but requestAdapter returned null';
    return report;
  }

  // Asking for the device too: an adapter can be handed out and then refuse to
  // produce a device, and finding that out at draw time is too late.
  let device;
  try {
    device = await adapter.requestDevice();
  } catch (err) {
    report.reason = `requestDevice threw: ${err?.message ?? err}`;
    return report;
  }
  if (!device) {
    report.reason = 'adapter granted but requestDevice returned null';
    return report;
  }

  const info = adapter.info ?? {};
  report.backend = 'webgpu';
  report.device = device;
  report.adapter = {
    vendor: info.vendor || 'unknown',
    architecture: info.architecture || '',
    description: info.description || '',
  };
  report.limits = {
    maxStorageBufferBindingSize: adapter.limits?.maxStorageBufferBindingSize ?? 0,
    maxComputeInvocationsPerWorkgroup: adapter.limits?.maxComputeInvocationsPerWorkgroup ?? 0,
    maxComputeWorkgroupSizeX: adapter.limits?.maxComputeWorkgroupSizeX ?? 0,
  };
  report.features = [...(adapter.features ?? [])];

  return report;
}

/**
 * Particle budget. The compute path is bound by the dispatch, the stateless
 * path by vertex work and overdraw, so they scale differently — and a phone
 * gets a fraction of either.
 */
export function pickCount(report) {
  const override = Number(new URLSearchParams(location.search).get('count'));
  if (Number.isFinite(override) && override >= 1000 && override <= 2_000_000) {
    return Math.floor(override);
  }

  const mobile =
    navigator.userAgentData?.mobile ||
    (window.matchMedia?.('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);

  if (report.backend === 'webgpu') {
    if (mobile) return 90_000;
    // Keep the whole state comfortably inside the smallest binding size we are
    // likely to meet, rather than assuming the 2 GB a desktop discrete card
    // reports.
    const cap = report.limits?.maxStorageBufferBindingSize ?? 134_217_728;
    const perParticle = 40;
    return Math.min(260_000, Math.floor((cap * 0.25) / perParticle));
  }

  return mobile ? 40_000 : 120_000;
}
