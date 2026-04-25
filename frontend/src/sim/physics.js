// Circuit physics engine — runtime MNA solver + topology classifier.
// Loaded as a classic script; exposes window.Physics. No DOM dependencies.
//
// The matching Python module is backend/circuit_validator.py — the server-side
// tutor endpoint re-derives topology there from the raw circuit state so the
// AI's grounding context can't be spoofed by a tampered client.

(function () {
  // Ideal-meter defaults. Exposed as window.Physics.settings so a later
  // "what if meters aren't ideal?" extension task can override these from the UI.
  // Near-ideal rather than exactly 0 / ∞ keeps the MNA solver well-conditioned.
  const settings = {
    ammeterR: 1e-4,       // ideal ammeter ≈ 0 Ω
    voltmeterR: 1e8,      // ideal voltmeter ≈ ∞ Ω
    cellInternalR: 1e-4,  // ideal source ≈ 0 Ω internal
  };
  const MIN_LOAD_R = 0.5;        // minimum allowed bulb/resistor R (prevents runaway currents)
  const SHORT_CIRCUIT_I = 50;   // A — above this we flag a short and clamp display

  // ---- MNA solver ------------------------------------------------------
  function gaussSolve(A, b) {
    const n = A.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let i = 0; i < n; i++) {
      let pivot = i;
      for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[pivot][i])) pivot = k;
      if (Math.abs(M[pivot][i]) < 1e-12) return null;
      if (pivot !== i) { const t = M[i]; M[i] = M[pivot]; M[pivot] = t; }
      for (let k = i + 1; k < n; k++) {
        const f = M[k][i] / M[i][i];
        for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = M[i][n];
      for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  function simulate(state, COMP) {
    const comps = state.components;
    const wires = state.wires;
    const juncs = state.junctions || [];

    const keyOf = (cid, tn) => cid + '.' + tn;
    const epKey = (ep) => ep.junctionId ? 'J:' + ep.junctionId : keyOf(ep.compId, ep.term);
    const parent = {};
    const find = k => {
      if (parent[k] === undefined) parent[k] = k;
      if (parent[k] === k) return k;
      return parent[k] = find(parent[k]);
    };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

    for (const c of comps) for (const t of COMP[c.type].terms) find(keyOf(c.id, t.n));
    for (const j of juncs) find('J:' + j.id);
    for (const w of wires) union(epKey(w.a), epKey(w.b));
    for (const c of comps) if (c.type === 'switch' && c.props.closed) union(keyOf(c.id, 'a'), keyOf(c.id, 'b'));

    const nodeOf = {};
    const nodeKeys = [];
    for (const k of Object.keys(parent)) {
      const r = find(k);
      if (nodeOf[r] === undefined) { nodeOf[r] = nodeKeys.length; nodeKeys.push(r); }
    }
    const getNode = (cid, tn) => nodeOf[find(keyOf(cid, tn))];
    const getNodeByEp = (ep) => ep ? nodeOf[find(epKey(ep))] : undefined;

    const buildIndex = (els) => {
      const m = new Map();
      for (const e of els) if (e.comp && e.comp.id) m.set(e.comp.id, e);
      return m;
    };

    const N = nodeKeys.length;
    if (N === 0) return { ok: true, empty: true, nodes: [], elements: [], elementByCompId: new Map() };

    const elems = [];
    for (const c of comps) {
      if (c.type === 'cell' || c.type === 'battery') {
        elems.push({ kind: 'V', comp: c, na: getNode(c.id, '+'), nb: getNode(c.id, '-'), value: c.props.voltage });
      } else if (c.type === 'bulb' || c.type === 'resistor') {
        elems.push({ kind: 'R', comp: c, na: getNode(c.id, 'a'), nb: getNode(c.id, 'b'), value: Math.max(MIN_LOAD_R, c.props.resistance) });
      } else if (c.type === 'ammeter') {
        elems.push({ kind: 'R', comp: c, na: getNode(c.id, 'a'), nb: getNode(c.id, 'b'), value: Math.max(1e-12, settings.ammeterR) });
      } else if (c.type === 'voltmeter') {
        elems.push({ kind: 'R', comp: c, na: getNode(c.id, 'a'), nb: getNode(c.id, 'b'), value: Math.max(1, settings.voltmeterR) });
      }
    }

    const Vsrcs = elems.filter(e => e.kind === 'V');
    if (!Vsrcs.length) {
      const elements = elems.map(e => ({ ...e, current: 0, drop: 0 }));
      return {
        ok: true, empty: false, noSource: true,
        nodes: new Array(N).fill(0),
        elements,
        elementByCompId: buildIndex(elements),
        getNode, getNodeByEp,
      };
    }

    const gnd = Vsrcs[0].nb;
    const M = N + Vsrcs.length;
    const A = Array.from({ length: M }, () => new Array(M).fill(0));
    const z = new Array(M).fill(0);

    for (const e of elems) {
      if (e.kind === 'R') {
        const g = 1 / e.value;
        const a = e.na, b = e.nb;
        if (a !== gnd) A[a][a] += g;
        if (b !== gnd) A[b][b] += g;
        if (a !== gnd && b !== gnd) { A[a][b] -= g; A[b][a] -= g; }
      }
    }
    Vsrcs.forEach((e, k) => {
      const idx = N + k;
      const a = e.na, b = e.nb;
      if (a !== gnd) { A[a][idx] += 1; A[idx][a] += 1; }
      if (b !== gnd) { A[b][idx] -= 1; A[idx][b] -= 1; }
      // V_a - V_b - R_int * I_source = V_value (small internal resistance)
      A[idx][idx] -= settings.cellInternalR;
      z[idx] = e.value;
    });
    for (let j = 0; j < M; j++) { A[gnd][j] = 0; A[j][gnd] = 0; }
    A[gnd][gnd] = 1; z[gnd] = 0;

    const x = gaussSolve(A, z);
    if (!x) {
      const elements = elems.map(e => ({ ...e, current: 0, drop: 0 }));
      return {
        ok: false, error: 'Circuit is shorted or ill-defined',
        nodes: new Array(N).fill(0),
        elements,
        elementByCompId: buildIndex(elements),
        getNode, getNodeByEp,
      };
    }

    const V = x.slice(0, N);
    const results = elems.map(e => {
      const va = V[e.na], vb = V[e.nb];
      const drop = va - vb;
      let current;
      if (e.kind === 'R') current = drop / e.value;
      else current = x[N + Vsrcs.indexOf(e)];
      return { ...e, va, vb, drop, current };
    });

    const mainV = results.find(e => e.kind === 'V');
    const mainI = mainV ? Math.abs(mainV.current) : 0;
    const isOpen = mainI < 1e-6;

    const hasLoad = elems.some(e => e.kind === 'R'
      && (e.comp.type === 'bulb' || e.comp.type === 'resistor'));
    // Topological short: a load component (bulb/resistor) whose two terminals
    // collapse to the same MNA node has been bypassed by wires. Flag as short
    // regardless of current magnitude — catches the case where a student
    // directly wires across a component.
    const shortedLoad = comps.some(c =>
      (c.type === 'bulb' || c.type === 'resistor')
      && getNode(c.id, 'a') === getNode(c.id, 'b'));
    const isShort = shortedLoad || (!isOpen && (!hasLoad || mainI > SHORT_CIRCUIT_I));

    if (isShort) {
      // Clamp all readings — a real cell would see its fuse blow / terminal voltage collapse.
      const clamped = results.map(e => ({ ...e, current: 0, drop: 0 }));
      return {
        ok: true, empty: false, isShort: true, isOpen: false,
        nodes: V, elements: clamped, elementByCompId: buildIndex(clamped),
        getNode, getNodeByEp,
        supplyV: Vsrcs[0].value, totalI: 0,
      };
    }

    return {
      ok: true, empty: false,
      nodes: V, elements: results, elementByCompId: buildIndex(results),
      getNode, getNodeByEp,
      supplyV: Vsrcs[0].value, totalI: mainI, isOpen,
    };
  }

  // ---- Topology label for the UI chip ----------------------------------
  function topologyGuess(sim) {
    if (!sim || !sim.ok) return '';
    if (sim.empty) return '';
    if (sim.noSource) return 'no supply';
    if (sim.isShort) return 'short circuit';
    if (sim.isOpen) return 'open circuit';
    const resEls = sim.elements.filter(e => e.kind === 'R' && (e.comp.type === 'bulb' || e.comp.type === 'resistor'));
    if (resEls.length === 0) return 'short circuit';
    if (resEls.length === 1) return 'simple loop';
    const pairs = {};
    for (const e of resEls) {
      const k = [e.na, e.nb].sort().join('-');
      pairs[k] = (pairs[k] || 0) + 1;
    }
    if (Object.values(pairs).some(v => v > 1)) return 'parallel';
    return 'series';
  }

  window.Physics = { simulate, topologyGuess, settings };
})();
