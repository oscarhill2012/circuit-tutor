// Dev-mode context-window inspector.
//
// Off by default. Enabled by either `?dev=1` in the URL or
// `localStorage.devMode = '1'` in the browser console. When enabled, captures
// the JSON body sent to /api/tutor and the JSON returned, and renders them in
// a floating collapsible panel so we can verify what the model actually sees
// (pinned KB entries, retrieved snippets, recent_history, circuit_state, ...).
//
// In dev mode the client also sets `debug: true` on the outbound payload —
// the server echoes back the post-budget user_payload it forwarded to OpenAI
// plus the static system_prompt. The prod UI never sets that flag, so this
// has zero effect on normal traffic.

const DEV_FLAG_KEY = 'devMode';

export function isDevMode() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('dev') === '1') {
      try { localStorage.setItem(DEV_FLAG_KEY, '1'); } catch (_) {}
      return true;
    }
    if (params.get('dev') === '0') {
      try { localStorage.removeItem(DEV_FLAG_KEY); } catch (_) {}
      return false;
    }
    return localStorage.getItem(DEV_FLAG_KEY) === '1';
  } catch (_) {
    return false;
  }
}

const captures = [];   // ring buffer of recent round-trips
const MAX_CAPTURES = 10;
let panel = null;
let bodyEl = null;
let countEl = null;
let collapsed = false;

export function captureRequest(payload) {
  if (!isDevMode()) return;
  captures.unshift({
    t: new Date(),
    request: payload,
    response: null,
    error: null,
  });
  if (captures.length > MAX_CAPTURES) captures.length = MAX_CAPTURES;
  render();
}

export function captureResponse(data) {
  if (!isDevMode()) return;
  if (captures[0]) captures[0].response = data;
  render();
}

export function captureError(err) {
  if (!isDevMode()) return;
  if (captures[0]) captures[0].error = String(err && err.message || err);
  render();
}

export function initDevInspector() {
  if (!isDevMode()) return;
  if (panel) return;
  injectStyles();
  buildPanel();
  render();
}

function injectStyles() {
  if (document.getElementById('dev-inspector-styles')) return;
  const css = `
    #dev-inspector{position:fixed;left:50%;bottom:0;transform:translateX(-50%);
      width:720px;max-width:90vw;height:33vh;max-height:33vh;
      background:#0f1115;color:#d6d8de;border:1px solid #2a2f3a;
      border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,.6);z-index:9999;
      font:12px/1.45 'JetBrains Mono',ui-monospace,Consolas,monospace;display:flex;
      flex-direction:column;overflow:hidden}
    #dev-inspector.collapsed{height:auto;max-height:none}
    #dev-inspector .di-hd{display:flex;align-items:center;gap:8px;padding:8px 10px;
      background:#161a22;border-bottom:1px solid #2a2f3a;cursor:pointer;
      user-select:none}
    #dev-inspector .di-hd b{color:#9ad}
    #dev-inspector .di-hd .di-count{margin-left:auto;color:#6c7280}
    #dev-inspector .di-hd .di-x{margin-left:8px;color:#6c7280;cursor:pointer}
    #dev-inspector .di-bd{overflow:auto;padding:8px 10px;flex:1 1 auto;min-height:0}
    #dev-inspector.collapsed .di-bd{display:none}
    #dev-inspector details{margin:6px 0;border:1px solid #1f2430;border-radius:6px}
    #dev-inspector details>summary{cursor:pointer;padding:6px 8px;background:#141823;
      color:#cbd2dc;list-style:none}
    #dev-inspector details>summary::-webkit-details-marker{display:none}
    #dev-inspector details>summary::before{content:'▸ ';color:#6c7280}
    #dev-inspector details[open]>summary::before{content:'▾ '}
    #dev-inspector pre{margin:0;padding:8px;background:#0a0d12;color:#cfd6e1;
      white-space:pre-wrap;word-break:break-word;max-height:25vh;overflow:auto;
      border-top:1px solid #1f2430}
    #dev-inspector .di-meta{color:#6c7280;font-size:11px;padding:0 8px 6px}
    #dev-inspector .di-empty{padding:14px;color:#6c7280;text-align:center}
    #dev-inspector .di-tag{display:inline-block;background:#1e2533;color:#9ad;
      padding:1px 6px;border-radius:4px;margin-right:6px;font-size:11px}
    #dev-inspector .di-err{color:#f08080}
  `;
  const s = document.createElement('style');
  s.id = 'dev-inspector-styles';
  s.textContent = css;
  document.head.appendChild(s);
}

function buildPanel() {
  panel = document.createElement('div');
  panel.id = 'dev-inspector';
  panel.innerHTML = `
    <div class="di-hd">
      <b>Tutor context inspector</b>
      <span class="di-count"></span>
      <span class="di-x" title="Disable dev mode (clears localStorage flag)">✕</span>
    </div>
    <div class="di-bd"></div>
  `;
  document.body.appendChild(panel);
  bodyEl = panel.querySelector('.di-bd');
  countEl = panel.querySelector('.di-count');
  panel.querySelector('.di-hd').addEventListener('click', (e) => {
    if (e.target.classList.contains('di-x')) return;
    collapsed = !collapsed;
    panel.classList.toggle('collapsed', collapsed);
  });
  panel.querySelector('.di-x').addEventListener('click', (e) => {
    e.stopPropagation();
    try { localStorage.removeItem(DEV_FLAG_KEY); } catch (_) {}
    panel.remove();
    panel = null;
  });
}

function render() {
  if (!panel) return;
  countEl.textContent = captures.length ? `${captures.length} turn${captures.length === 1 ? '' : 's'}` : '';
  if (!captures.length) {
    bodyEl.innerHTML = `<div class="di-empty">Send a message to the tutor — its full context will appear here.</div>`;
    return;
  }
  bodyEl.innerHTML = captures.map(renderCapture).join('');
}

function renderCapture(cap, i) {
  const ts = cap.t.toLocaleTimeString();
  const studentMsg = cap.request && cap.request.student_message || '(no message)';
  const debug = cap.response && cap.response.debug || null;
  const sysPromptBlock = debug && debug.system_prompt
    ? section('system_prompt (server)', debug.system_prompt)
    : '';
  const serverPayloadBlock = debug && debug.user_payload
    ? section('user_payload sent to OpenAI (post-budget)', tryFormat(debug.user_payload))
    : '';
  const errorBlock = cap.error
    ? `<details open><summary>error</summary><pre class="di-err">${escapeHtml(cap.error)}</pre></details>`
    : '';

  return `
    <div class="di-turn" data-i="${i}">
      <div class="di-meta">
        <span class="di-tag">${i === 0 ? 'latest' : 'turn -' + i}</span>
        ${ts} · "${escapeHtml(studentMsg.slice(0, 80))}${studentMsg.length > 80 ? '…' : ''}"
      </div>
      ${section('client → server (request body)', formatJson(cap.request), i === 0)}
      ${cap.response ? section('server → client (response)', formatJson(cap.response)) : '<div class="di-meta">awaiting response…</div>'}
      ${serverPayloadBlock}
      ${sysPromptBlock}
      ${errorBlock}
    </div>
    <hr style="border:0;border-top:1px solid #1f2430;margin:10px 0">
  `;
}

function section(title, content, open) {
  return `<details${open ? ' open' : ''}><summary>${escapeHtml(title)}</summary><pre>${escapeHtml(content)}</pre></details>`;
}

function formatJson(obj) {
  try { return JSON.stringify(obj, null, 2); }
  catch (_) { return String(obj); }
}

function tryFormat(maybeJsonString) {
  if (typeof maybeJsonString !== 'string') return formatJson(maybeJsonString);
  try { return JSON.stringify(JSON.parse(maybeJsonString), null, 2); }
  catch (_) { return maybeJsonString; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}
