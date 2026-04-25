"""Circuit-state validator.

Runs inside the Vercel Python serverless function at /api/tutor. tutor.py
calls analyse() server-side on every request so the grounding context sent
to the LLM is authoritative (not whatever the client sent).

Models the circuit as a terminal/net graph:
  - Each component type exposes named terminals (cell.+, cell.-, bulb.a, bulb.b, ...).
  - Wires fuse terminals into electrical *nets* via union-find.
  - Each non-wire component is an *element* = an edge between its two nets.

This is the correct abstraction for series/parallel: two elements are in parallel
iff they share both end-nets; series-adjacent iff they share exactly one net and
that net has degree 2 in the active graph. The earlier component-as-node model
collapsed a cell's + and - into one node, which made loop and topology
detection unreliable.

Topology classification uses a single biconnected-components (BCC) pass over
the active graph so that `dead_branches`, `parallel_groups`, and ammeter
in-parallel detection are linear in graph size rather than quadratic in the
number of resistive elements.

Input shape (frontend -> backend):

{
  "components": [
    {"id": "C1", "type": "cell", "voltage": 6},
    {"id": "B1", "type": "bulb", "resistance": 4},
    {"id": "S1", "type": "switch", "closed": true},
    ...
  ],
  "wires": [
    {"id": "W1", "from": "C1.+", "to": "S1.a"},
    ...
  ],
  "meters": [
    {"id": "A1", "mode": "series", "measuring": "B1"},
    {"id": "V1", "mode": "parallel", "across": "B1"}
  ]
}
"""

from collections import defaultdict


TERMINALS = {
    "cell": ("+", "-"),
    "battery": ("+", "-"),
    "switch": ("a", "b"),
    "bulb": ("a", "b"),
    "resistor": ("a", "b"),
    "ammeter": ("a", "b"),
    "voltmeter": ("a", "b"),
}

RESISTIVE_TYPES = {"bulb", "resistor"}
ZERO_R_TYPES = {"ammeter"}  # ideal ammeter = wire
CELL_TYPES = {"cell", "battery"}


class _UF:
    def __init__(self):
        self.p = {}

    def add(self, x):
        self.p.setdefault(x, x)

    def find(self, x):
        self.add(x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[ra] = rb


def _terminals_of(c):
    names = TERMINALS.get(c["type"])
    if not names:
        return ()
    return tuple(f"{c['id']}.{n}" for n in names)


def _parse_endpoint(ep, component_ids):
    if "." in ep:
        cid = ep.split(".", 1)[0]
        return ep if cid in component_ids else None
    return ep if ep in component_ids else None


def _expand_bare(ep, components_by_id):
    """A bare 'C1' endpoint fans out to all terminals of C1 (defensive)."""
    if "." in ep:
        return [ep]
    c = components_by_id.get(ep)
    return list(_terminals_of(c)) if c else []


def _build_nets(components, wires):
    uf = _UF()
    by_id = {c["id"]: c for c in components}
    component_ids = set(by_id)

    for c in components:
        for t in _terminals_of(c):
            uf.add(t)

    for w in wires:
        a = _parse_endpoint(w.get("from", ""), component_ids)
        b = _parse_endpoint(w.get("to", ""), component_ids)
        if a is None or b is None:
            continue
        for ta in _expand_bare(a, by_id):
            for tb in _expand_bare(b, by_id):
                uf.add(ta)
                uf.add(tb)
                uf.union(ta, tb)

    net_of = {t: uf.find(t) for t in uf.p}
    return net_of


def _contract(net_of, components, include_switches=True, contract_zero_r=True):
    """Contract zero-resistance elements (ammeters + optionally closed switches)."""
    uf = _UF()
    for n in set(net_of.values()):
        uf.add(n)
    for c in components:
        ts = _terminals_of(c)
        if len(ts) != 2:
            continue
        if c["type"] in ZERO_R_TYPES:
            if contract_zero_r:
                uf.union(net_of[ts[0]], net_of[ts[1]])
        elif include_switches and c["type"] == "switch" and c.get("closed", True):
            uf.union(net_of[ts[0]], net_of[ts[1]])
    return {n: uf.find(n) for n in set(net_of.values())}


def _path_exists(adj, start, goal, blocked_edge_id=None):
    if start == goal and blocked_edge_id is None:
        return True
    seen = {start}
    stack = [start]
    while stack:
        n = stack.pop()
        if n == goal:
            return True
        for m, eid in adj.get(n, ()):
            if eid == blocked_edge_id:
                continue
            if m not in seen:
                seen.add(m)
                stack.append(m)
    return goal in seen


def _build_adj(edges):
    adj = defaultdict(list)
    for eid, a, b in edges:
        adj[a].append((b, eid))
        adj[b].append((a, eid))
    return adj


def _bcc(adj):
    """Iterative Tarjan biconnected-components / bridge finding.

    Returns (bridges, block_id) where:
      bridges: set of edge ids that are bridges in the undirected graph.
      block_id: dict edge_id -> int, the BCC index. Each bridge is in its own
                singleton block; non-bridge edges in the same BCC share a block.
    Edges with a==b (self-loops) get their own singleton non-bridge block.
    """
    disc = {}
    low = {}
    bridges = set()
    block_id = {}
    edge_stack = []
    timer = 0
    next_block = 0

    nodes = list(adj.keys())
    for root in nodes:
        if root in disc:
            continue
        disc[root] = low[root] = timer
        timer += 1
        # Each frame: (node, parent_edge_id, iterator over neighbours)
        stack = [(root, None, iter(adj.get(root, [])))]
        while stack:
            u, pe, it = stack[-1]
            advanced = False
            for v, eid in it:
                if eid == pe:
                    continue
                if v == u:
                    # Self-loop: own singleton block, never a bridge.
                    block_id[eid] = next_block
                    next_block += 1
                    continue
                if v not in disc:
                    edge_stack.append((u, v, eid))
                    disc[v] = low[v] = timer
                    timer += 1
                    stack.append((v, eid, iter(adj.get(v, []))))
                    advanced = True
                    break
                else:
                    # Back-edge.
                    if disc[v] < disc[u]:
                        edge_stack.append((u, v, eid))
                        if disc[v] < low[u]:
                            low[u] = disc[v]
            if advanced:
                continue
            u, pe_u, _ = stack.pop()
            if stack:
                parent = stack[-1][0]
                if low[u] < low[parent]:
                    low[parent] = low[u]
                if low[u] >= disc[parent]:
                    bid = next_block
                    next_block += 1
                    is_bridge = low[u] > disc[parent]
                    while edge_stack:
                        _, _, eid_e = edge_stack.pop()
                        block_id[eid_e] = bid
                        if eid_e == pe_u:
                            if is_bridge:
                                bridges.add(eid_e)
                            break
    return bridges, block_id


def _block_path_blocks(block_id, adj, na, nb):
    """Block-cut tree path from na to nb. Returns the set of block_ids on the
    unique path between na and nb in the block-cut tree, or None if na and nb
    are in different connected components."""
    if na == nb:
        return set()
    block_nodes = defaultdict(set)
    for u, neigh in adj.items():
        for v, eid in neigh:
            b = block_id.get(eid)
            if b is None:
                continue
            block_nodes[b].add(u)
            block_nodes[b].add(v)
    node_blocks = defaultdict(set)
    for b, ns in block_nodes.items():
        for n in ns:
            node_blocks[n].add(b)

    if na not in node_blocks or nb not in node_blocks:
        return None

    # Block-cut tree: tagged nodes ('n', node_id) and ('b', block_id).
    tree = defaultdict(list)
    for n, bs in node_blocks.items():
        for b in bs:
            tree[('n', n)].append(('b', b))
            tree[('b', b)].append(('n', n))

    src, dst = ('n', na), ('n', nb)
    parent = {src: None}
    queue = [src]
    head = 0
    while head < len(queue):
        u = queue[head]
        head += 1
        if u == dst:
            break
        for v in tree[u]:
            if v not in parent:
                parent[v] = u
                queue.append(v)
    if dst not in parent:
        return None
    blocks = set()
    cur = dst
    while cur is not None:
        if cur[0] == 'b':
            blocks.add(cur[1])
        cur = parent[cur]
    return blocks


def analyse(state):
    components = state.get("components", [])
    wires = state.get("wires", [])
    meters = state.get("meters", [])
    by_id = {c["id"]: c for c in components}

    cells = [c for c in components if c["type"] in CELL_TYPES]
    switches = [c for c in components if c["type"] == "switch"]
    bulbs = [c for c in components if c["type"] == "bulb"]
    resistors = [c for c in components if c["type"] == "resistor"]
    ammeters = [c for c in components if c["type"] == "ammeter"]
    voltmeters = [c for c in components if c["type"] == "voltmeter"]
    open_switches = [s["id"] for s in switches if not s.get("closed", True)]

    net_of = _build_nets(components, wires)
    contract = _contract(net_of, components, include_switches=True)

    def cnet(terminal):
        return contract[net_of[terminal]]

    # Active edges on the contracted graph: exclude voltmeters (ideal open),
    # zero-R elements (already contracted), open switches (break).
    active_edges = []  # (eid, net_a, net_b, component)
    for c in components:
        ts = _terminals_of(c)
        if len(ts) != 2:
            continue
        if c["type"] == "voltmeter":
            continue
        if c["type"] in ZERO_R_TYPES:
            continue
        if c["type"] == "switch" and not c.get("closed", True):
            continue
        a, b = cnet(ts[0]), cnet(ts[1])
        active_edges.append((c["id"], a, b, c))

    adj = _build_adj([(eid, a, b) for eid, a, b, _ in active_edges])

    # --- complete loop & short-circuit -------------------------------------
    complete_loop = False
    short_circuit = False
    if cells:
        cell = cells[0]
        ts = _terminals_of(cell)
        if ts:
            na, nb = cnet(ts[0]), cnet(ts[1])
            if na == nb:
                # + and - already fused by wires/ammeters/closed switches.
                complete_loop = True
                short_circuit = True
            else:
                complete_loop = _path_exists(adj, na, nb, blocked_edge_id=cell["id"])
                if complete_loop:
                    # Short-circuit iff there's a cell-to-cell path that uses
                    # zero resistive elements.
                    nonres_adj = defaultdict(list)
                    for eid, a, b, c2 in active_edges:
                        if c2["id"] == cell["id"] or c2["type"] in RESISTIVE_TYPES:
                            continue
                        nonres_adj[a].append((b, eid))
                        nonres_adj[b].append((a, eid))
                    short_circuit = _path_exists(nonres_adj, na, nb)

    # --- resistive-element classification ----------------------------------
    resistive_edges = [(eid, a, b, c) for eid, a, b, c in active_edges
                       if c["type"] in RESISTIVE_TYPES]

    # Parallel groups in O(R) via endpoint-set buckets.
    buckets = defaultdict(list)
    bucket_order = []
    for eid, a, b, _ in resistive_edges:
        if a == b:
            continue
        key = frozenset((a, b))
        if key not in buckets:
            bucket_order.append(key)
        buckets[key].append(eid)
    parallel_groups = [buckets[k] for k in bucket_order if len(buckets[k]) > 1]

    # --- dead branches via block-cut tree ----------------------------------
    dead_branches = []
    if cells and complete_loop and not short_circuit:
        cell = cells[0]
        cts = _terminals_of(cell)
        na, nb = cnet(cts[0]), cnet(cts[1])
        _, block_id_full = _bcc(adj)
        live_blocks = _block_path_blocks(block_id_full, adj, na, nb)
        if live_blocks is None:
            dead_branches = [eid for eid, _, _, _ in resistive_edges]
        else:
            dead_branches = [
                eid for eid, a, b, _ in resistive_edges
                if a == b or block_id_full.get(eid) not in live_blocks
            ]
    elif not complete_loop:
        # With no complete loop, every resistive element is "dead" for tutor purposes.
        dead_branches = [eid for eid, _, _, _ in resistive_edges]

    in_parallel = {eid for g in parallel_groups for eid in g}
    live_resistive = [eid for eid, _, _, _ in resistive_edges if eid not in dead_branches]
    live_series_only = [eid for eid in live_resistive if eid not in in_parallel]

    # --- topology label ----------------------------------------------------
    if not complete_loop:
        topology = "incomplete"
    elif short_circuit:
        # A zero-resistance path across the cell dominates the circuit — no
        # meaningful current flows through any resistive element in parallel.
        topology = "short_circuit"
    elif not live_resistive:
        topology = "short_circuit"
    elif parallel_groups and live_series_only:
        topology = "series_parallel"
    elif parallel_groups:
        topology = "parallel"
    else:
        topology = "series"

    # --- meter checks ------------------------------------------------------
    meter_issues = []

    # Bridge-probe graph: ammeters as 0-R edges, closed switches contracted,
    # voltmeters and open switches excluded, the primary cell excluded so its
    # edge cannot trivially close every loop. One BCC pass classifies every
    # ammeter as bridge (series) or non-bridge (in-parallel).
    g2_bridges = set()
    g2_eids = set()
    if ammeters:
        contract_noamm = _contract(net_of, components,
                                   include_switches=True,
                                   contract_zero_r=False)
        cell0_id = cells[0]["id"] if cells else None
        g2_edges = []
        for c in components:
            ts = _terminals_of(c)
            if len(ts) != 2:
                continue
            if c["type"] == "voltmeter":
                continue
            if c["type"] == "switch" and not c.get("closed", True):
                continue
            if c["id"] == cell0_id:
                continue
            a = contract_noamm[net_of[ts[0]]]
            b = contract_noamm[net_of[ts[1]]]
            g2_edges.append((c["id"], a, b))
            g2_eids.add(c["id"])
        g2_adj = _build_adj(g2_edges)
        g2_bridges, _ = _bcc(g2_adj)

    for m in meters:
        mid = m.get("id")
        meta = by_id.get(mid, {})
        mtype = meta.get("type")
        ts = _terminals_of(meta)
        if not ts:
            continue

        if mtype == "ammeter":
            raw_a, raw_b = net_of[ts[0]], net_of[ts[1]]
            if raw_a == raw_b:
                meter_issues.append({
                    "meter": mid,
                    "issue": "ammeter_shorted_by_wire",
                    "misconception_id": "kb.misconception.ammeter_in_parallel",
                })
                continue
            # In-parallel iff this ammeter's edge is not a bridge in the
            # active graph with the primary cell removed.
            if mid in g2_eids and mid not in g2_bridges:
                meter_issues.append({
                    "meter": mid,
                    "issue": "ammeter_in_parallel",
                    "misconception_id": "kb.misconception.ammeter_in_parallel",
                })

        elif mtype == "voltmeter":
            raw_a, raw_b = net_of[ts[0]], net_of[ts[1]]
            if raw_a == raw_b:
                meter_issues.append({
                    "meter": mid,
                    "issue": "voltmeter_shorted",
                    "misconception_id": "kb.misconception.voltmeter_in_series",
                })
                continue
            # A well-placed voltmeter spans two distinct nets that both lie on
            # an active path through the cell (i.e. across a real element).
            if cells:
                ca, cb = contract[raw_a], contract[raw_b]
                if ca == cb:
                    # Contraction merged them -> voltmeter across a zero-R path
                    # (wire/ammeter/closed switch). Reads ~0 V, not useful.
                    meter_issues.append({
                        "meter": mid,
                        "issue": "voltmeter_across_wire",
                        "misconception_id": "kb.misconception.voltmeter_in_series",
                    })

    return {
        "component_counts": {
            "cells": len(cells),
            "switches": len(switches),
            "bulbs": len(bulbs),
            "resistors": len(resistors),
            "ammeters": len(ammeters),
            "voltmeters": len(voltmeters),
        },
        "open_switches": open_switches,
        "complete_loop": complete_loop,
        "short_circuit": short_circuit,
        "topology": topology,
        "parallel_groups": parallel_groups,
        "dead_branches": dead_branches,
        "meter_issues": meter_issues,
        "highlightable_ids": [c["id"] for c in components],
    }


# --- self-test when run directly -----------------------------------------
if __name__ == "__main__":
    import json

    demo = {
        "components": [
            {"id": "C1", "type": "cell", "voltage": 6},
            {"id": "S1", "type": "switch", "closed": True},
            {"id": "B1", "type": "bulb", "resistance": 4},
            {"id": "A1", "type": "ammeter"},
            {"id": "V1", "type": "voltmeter"},
        ],
        "wires": [
            {"id": "W1", "from": "C1.+", "to": "S1.a"},
            {"id": "W2", "from": "S1.b", "to": "A1.a"},
            {"id": "W3", "from": "A1.b", "to": "B1.a"},
            {"id": "W4", "from": "B1.b", "to": "C1.-"},
            {"id": "W5", "from": "V1.a", "to": "B1.a"},
            {"id": "W6", "from": "V1.b", "to": "B1.b"},
        ],
        "meters": [
            {"id": "A1", "mode": "series", "measuring": "B1"},
            {"id": "V1", "mode": "parallel", "across": "B1"},
        ],
    }
    print(json.dumps(analyse(demo), indent=2))
