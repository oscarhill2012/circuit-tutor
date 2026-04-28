// Ambient lab atmospherics: every 25–55 s a faint mint→violet jagged arc
// flickers diagonally across the canvas backdrop, fades, and is gone. No
// sound, no interaction, no impact on layout. The only piece of UI motion
// that exists purely to keep the lab from feeling dead during long inactive
// stretches.
//
// Suppression: skipped while the task widget, onboarding overlay, or the
// tutor's "thinking/speaking" ring is active — we never want to compete
// with Professor Volt for the student's eye.

const ARC_SVG = `
  <svg class="ambient-arc" viewBox="0 0 1600 1000" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="arc-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0"   stop-color="#2de2b3" stop-opacity="0"/>
        <stop offset="0.5" stop-color="#b28cff" stop-opacity="0.6"/>
        <stop offset="1"   stop-color="#2de2b3" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="" stroke="url(#arc-g)" stroke-width="1.3" fill="none" stroke-linecap="round"/>
  </svg>`;

function jagged(x1, y1, x2, y2, segs = 8, jitter = 36) {
  const pts = [[x1, y1]];
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const x = x1 + (x2 - x1) * t + (Math.random() - 0.5) * jitter * 2;
    const y = y1 + (y2 - y1) * t + (Math.random() - 0.5) * jitter * 2;
    pts.push([x, y]);
  }
  pts.push([x2, y2]);
  return 'M' + pts.map(p => p.join(',')).join('L');
}

function isSuppressed() {
  // Don't compete with the tutor if Volt is actively engaged.
  const persona = document.querySelector('.persona-avatar');
  if (persona) {
    const s = persona.dataset.state;
    if (s === 'thinking' || s === 'speaking') return true;
  }
  // Don't draw across the onboarding overlay.
  if (document.body.classList.contains('onboarding-active')) return true;
  // Don't draw over an open task-widget.
  const tw = document.getElementById('task-widget');
  if (tw && !tw.classList.contains('hidden')) return true;
  // Tab not visible — wait for the student to come back.
  if (document.hidden) return true;
  return false;
}

function fireArc() {
  const STAGE = document.querySelector('.canvas-wrap');
  if (!STAGE) return scheduleNext();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return scheduleNext();
  if (isSuppressed()) return scheduleNext();

  const wrap = document.createElement('div');
  wrap.innerHTML = ARC_SVG.trim();
  const svg = wrap.firstElementChild;
  const path = svg.querySelector('path');

  // Diagonal-ish stroke from one corner-ish to the other.
  const fromLeft = Math.random() < 0.5;
  const x1 = fromLeft ? -40 : 1640;
  const x2 = fromLeft ? 1640 : -40;
  const y1 = 100 + Math.random() * 800;
  const y2 = 100 + Math.random() * 800;
  path.setAttribute('d', jagged(x1, y1, x2, y2));

  STAGE.appendChild(svg);
  // Two-frame delay so the .on transition catches the opacity change.
  requestAnimationFrame(() => requestAnimationFrame(() => svg.classList.add('on')));
  setTimeout(() => { svg.classList.remove('on'); svg.classList.add('off'); }, 220);
  setTimeout(() => svg.remove(), 1600);

  scheduleNext();
}

function scheduleNext() {
  const ms = 25000 + Math.random() * 30000;
  setTimeout(fireArc, ms);
}

export function startAmbient() {
  // Initial delay so the page has settled before the first flicker.
  setTimeout(fireArc, 8000 + Math.random() * 8000);
}
