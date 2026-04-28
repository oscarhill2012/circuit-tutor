// Left-hand component palette: icons, drag-to-canvas, click-to-center.

import { SVG_W, SVG_H } from '../state/store.js';
import { COMP_LABELS, COMP_DESCRIPTIONS } from '../circuit/schema.js';
import { svg } from '../circuit/renderer.js';
import { svgPoint } from '../circuit/editor.js';
import { addComponent } from '../state/actions.js';

export function paletteIcon(type) {
  const icons = {
    cell: `<svg viewBox="0 0 60 30"><line x1="5" y1="15" x2="24" y2="15" stroke="#b9c4dc" stroke-width="2"/><line x1="24" y1="5" x2="24" y2="25" stroke="#b9c4dc" stroke-width="2"/><line x1="32" y1="10" x2="32" y2="20" stroke="#b9c4dc" stroke-width="2"/><line x1="32" y1="15" x2="55" y2="15" stroke="#b9c4dc" stroke-width="2"/></svg>`,
    battery: `<svg viewBox="0 0 60 30"><line x1="2" y1="15" x2="18" y2="15" stroke="#b9c4dc" stroke-width="2"/><line x1="18" y1="5" x2="18" y2="25" stroke="#b9c4dc" stroke-width="2"/><line x1="24" y1="10" x2="24" y2="20" stroke="#b9c4dc" stroke-width="2"/><line x1="34" y1="5" x2="34" y2="25" stroke="#b9c4dc" stroke-width="2"/><line x1="40" y1="10" x2="40" y2="20" stroke="#b9c4dc" stroke-width="2"/><line x1="40" y1="15" x2="58" y2="15" stroke="#b9c4dc" stroke-width="2"/></svg>`,
    switch: `<svg viewBox="0 0 60 30"><line x1="2" y1="15" x2="20" y2="15" stroke="#b9c4dc" stroke-width="2"/><line x1="20" y1="15" x2="38" y2="6" stroke="#b9c4dc" stroke-width="2"/><circle cx="20" cy="15" r="2" fill="#0b1020" stroke="#b9c4dc"/><circle cx="40" cy="15" r="2" fill="#0b1020" stroke="#b9c4dc"/><line x1="40" y1="15" x2="58" y2="15" stroke="#b9c4dc" stroke-width="2"/></svg>`,
    bulb: `<svg viewBox="0 0 60 30"><line x1="2" y1="15" x2="18" y2="15" stroke="#b9c4dc" stroke-width="2"/><circle cx="30" cy="15" r="10" fill="#0b1020" stroke="#b9c4dc" stroke-width="2"/><line x1="23" y1="8" x2="37" y2="22" stroke="#b9c4dc" stroke-width="2"/><line x1="23" y1="22" x2="37" y2="8" stroke="#b9c4dc" stroke-width="2"/><line x1="42" y1="15" x2="58" y2="15" stroke="#b9c4dc" stroke-width="2"/></svg>`,
    resistor: `<svg viewBox="0 0 60 30"><line x1="2" y1="15" x2="15" y2="15" stroke="#b9c4dc" stroke-width="2"/><rect x="15" y="8" width="30" height="14" fill="#0b1020" stroke="#b9c4dc" stroke-width="2"/><line x1="45" y1="15" x2="58" y2="15" stroke="#b9c4dc" stroke-width="2"/></svg>`,
    ammeter: `<svg viewBox="0 0 60 30"><line x1="2" y1="15" x2="18" y2="15" stroke="#b9c4dc" stroke-width="2"/><circle cx="30" cy="15" r="10" fill="#0b1020" stroke="#b9c4dc" stroke-width="2"/><text x="30" y="19" text-anchor="middle" fill="#e6edf8" font-family="monospace" font-size="11" font-weight="600">A</text><line x1="42" y1="15" x2="58" y2="15" stroke="#b9c4dc" stroke-width="2"/></svg>`,
    voltmeter: `<svg viewBox="0 0 60 30"><line x1="2" y1="15" x2="18" y2="15" stroke="#b9c4dc" stroke-width="2"/><circle cx="30" cy="15" r="10" fill="#0b1020" stroke="#b9c4dc" stroke-width="2"/><text x="30" y="19" text-anchor="middle" fill="#e6edf8" font-family="monospace" font-size="11" font-weight="600">V</text><line x1="42" y1="15" x2="58" y2="15" stroke="#b9c4dc" stroke-width="2"/></svg>`,
  };
  return icons[type] || '';
}

// Module-level handles so the onboarding tour (and any other caller) can
// programmatically pop the palette tooltip on a tile to demonstrate the
// hover-glossary feature.
let paletteTip = null;
let paletteTipTimer = null;

function ensurePaletteTip() {
  if (paletteTip) return paletteTip;
  paletteTip = document.getElementById('part-tooltip');
  if (paletteTip) return paletteTip;
  paletteTip = document.createElement('div');
  paletteTip.id = 'part-tooltip';
  paletteTip.className = 'part-tooltip';
  paletteTip.setAttribute('role', 'tooltip');
  paletteTip.innerHTML = '<div class="part-tooltip-title"></div><div class="part-tooltip-body"></div>';
  document.body.appendChild(paletteTip);
  return paletteTip;
}

function paintPaletteTipFor(type, anchorRect, immediate = false) {
  const tip = ensurePaletteTip();
  clearTimeout(paletteTipTimer);
  const fire = () => {
    tip.querySelector('.part-tooltip-title').textContent = COMP_LABELS[type] || type;
    tip.querySelector('.part-tooltip-body').textContent = COMP_DESCRIPTIONS[type] || '';
    tip.style.left = `${anchorRect.right + 10}px`;
    tip.style.top = `${anchorRect.top + anchorRect.height / 2}px`;
    tip.classList.add('show');
  };
  if (immediate) fire();
  else paletteTipTimer = setTimeout(fire, 200);
}

export function showPaletteTooltipFor(type) {
  const tile = document.querySelector(`.parts [data-type="${type}"]`);
  if (!tile) return;
  paintPaletteTipFor(type, tile.getBoundingClientRect(), true);
}

export function hidePaletteTooltip() {
  clearTimeout(paletteTipTimer);
  paletteTip?.classList.remove('show');
}

// Fire a short mint-violet zap from the cursor when the student grabs a
// tile. The element removes itself when the CSS animation finishes.
function fireSpark(host) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const s = document.createElement('span');
  s.className = 'spark';
  host.appendChild(s);
  s.addEventListener('animationend', () => s.remove(), { once: true });
  // Safety net in case animationend never fires.
  setTimeout(() => s.remove(), 600);
}

export function initPalette() {
  const parts = document.getElementById('parts');
  parts.innerHTML = '';

  ensurePaletteTip();
  function hideTip() { hidePaletteTooltip(); }
  function showTipFor(el, type) {
    paintPaletteTipFor(type, el.getBoundingClientRect());
  }

  for (const type of ['cell','battery','switch','bulb','resistor','ammeter','voltmeter']) {
    const el = document.createElement('div');
    el.className = 'part';
    el.draggable = true;
    el.dataset.type = type;
    el.dataset.kind = type;
    el.innerHTML = `${paletteIcon(type)}<div class="name">${COMP_LABELS[type]}</div>`;
    el.addEventListener('mousedown', () => fireSpark(el));
    el.addEventListener('dragstart', (ev) => {
      hideTip();
      fireSpark(el);
      ev.dataTransfer.setData('text/plain', type);
    });
    el.addEventListener('click', () => {
      fireSpark(el);
      addComponent(type, SVG_W/2, SVG_H/2);
    });
    el.addEventListener('mouseenter', () => showTipFor(el, type));
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('focus', () => showTipFor(el, type));
    el.addEventListener('blur', hideTip);
    parts.appendChild(el);
  }
  svg.addEventListener('dragover', (ev) => ev.preventDefault());
  svg.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const type = ev.dataTransfer.getData('text/plain');
    if (!type) return;
    const p = svgPoint(ev);
    addComponent(type, p.x, p.y);
  });
}
