// The technical signature. The point of this panel is that every line is read
// back from the thing that is actually running — the adapter three ended up
// with, the buffer sizes that were actually allocated, the dispatch that is
// actually issued. A demo that claims WebGPU in a caption is worth nothing;
// this one shows what it got and, when it falls back, says so first.
//
// Built with createElement and textContent rather than innerHTML: the adapter
// strings come from the graphics driver, and driver-supplied text is not
// something to interpolate into markup on principle, however unlikely a hostile
// GPU vendor is.

const WORKGROUP = 64; // three's default compute workgroup size

function bytes(n) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function num(n) {
  return n.toLocaleString('en-US').replace(/,/g, ' ');
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountHud({ report, count, bytes: stateBytes, usingCompute }) {
  const root = document.getElementById('hud');
  root.replaceChildren();

  const adapter = report.adapter
    ? [report.adapter.vendor, report.adapter.architecture, report.adapter.description]
        .filter(Boolean)
        .join(' · ')
    : '—';

  const heading = usingCompute
    ? 'WebGPU'
    : report.forced
      ? 'WebGL2 fallback — forced'
      : 'WebGL2 fallback';
  root.append(el('div', 'hud-title', heading));

  const dl = el('dl');
  const values = {};

  const rows = [
    ['backend', usingCompute ? 'WebGPU' : 'WebGL2', null],
    ['adapter', usingCompute ? adapter : 'no WebGPU device', null],
    ['particles', num(count), null],
    ['simulation', usingCompute ? 'compute pass, storage buffers' : 'closed-form, vertex stage', null],
    ['state', usingCompute ? `${bytes(stateBytes)} resident` : 'none — stateless', null],
    ['dispatch', usingCompute ? `${num(Math.ceil(count / WORKGROUP))} × ${WORKGROUP} lanes` : '—', null],
    ['draw calls', '1', null],
    ['fps', '—', 'fps'],
    ['gpu frame', '—', 'ms'],
  ];

  for (const [key, value, id] of rows) {
    const row = el('div', 'row');
    row.append(el('dt', null, key));
    const dd = el('dd', null, value);
    if (id) values[id] = dd;
    row.append(dd);
    dl.append(row);
  }
  root.append(dl);

  if (!usingCompute) {
    root.append(
      el(
        'p',
        'note',
        `${report.reason}. Without a compute stage there is nowhere to keep per-particle ` +
          `state, so motion here is a function of index and time — it loops, and it cannot ` +
          `answer the cursor. Same node graph, same material, less capability.`,
      ),
    );
  }

  return {
    tick(fps, ms) {
      values.fps.textContent = Math.round(fps);
      values.ms.textContent = ms.toFixed(2);
    },
  };
}
