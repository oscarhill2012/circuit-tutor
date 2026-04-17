// Left-hand component palette: icons, drag-to-canvas, click-to-center.

import { SVG_W, SVG_H } from '../state/store.js';
import { COMP_LABELS } from '../circuit/schema.js';
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

export function initPalette() {
  const parts = document.getElementById('parts');
  parts.innerHTML = '';
  for (const type of ['cell','battery','switch','bulb','resistor','ammeter','voltmeter']) {
    const el = document.createElement('div');
    el.className = 'part';
    el.draggable = true;
    el.dataset.type = type;
    el.innerHTML = `${paletteIcon(type)}<div class="name">${COMP_LABELS[type]}</div>`;
    el.addEventListener('dragstart', (ev) => ev.dataTransfer.setData('text/plain', type));
    el.addEventListener('click', () => addComponent(type, SVG_W/2, SVG_H/2));
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
