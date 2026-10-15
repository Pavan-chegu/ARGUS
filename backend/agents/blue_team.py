"""
BlueTeamAgent — Memory-Augmented Autonomous Remediator
=======================================================

Upgraded from a simple choke-point calculator to a memory-augmented agent:

  1. Receives the attack result (from RedTeamAgent)
  2. Queries FalkorDB for PAST Incident nodes on the same entrypoint (episodic memory)
  3. Detects if this is a REPEAT offender — escalates severity
  4. Uses graph bottleneck analysis to find the optimal single-edge cut
  5. Generates Terraform HCL remediation patch
  6. Updates the Incident node status to "remediated" (memory write-back)
  7. Streams step-by-step reasoning trace for the UI
"""

import time
import logging
from typing import Any, Dict, List, Optional, Set, Tuple
from backend.db.falkor import falkor_client

logger = logging.getLogger(__name__)


def _reach(adj: Dict[str, List[str]], start: str, removed: Set[Tuple[str, str]] = frozenset()) -> Set[str]:
    seen, stack = {start}, [start]
    while stack:
        cur = stack.pop()
        for nxt in adj.get(cur, []):
            if (cur, nxt) not in removed and nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return seen


def _min_edge_cut(adj: Dict[str, List[str]], source: str, sinks: Set[str]) -> List[Tuple[str, str]]:
    """Unit-capacity max-flow (Edmonds-Karp) → minimum edge cut between source and all sinks."""
    SINK = "__SINK__"
    cap: Dict[Tuple[str, str], int] = {}
    graph: Dict[str, Set[str]] = {}
    def add(u, v, c):
        cap[(u, v)] = cap.get((u, v), 0) + c
        cap.setdefault((v, u), 0)
        graph.setdefault(u, set()).add(v)
        graph.setdefault(v, set()).add(u)
    for u, vs in adj.items():
        for v in vs:
            add(u, v, 1)
    for s in sinks:
        add(s, SINK, 10 ** 6)
    while True:
        prev, q = {source: None}, [source]
        while q and SINK not in prev:
            u = q.pop(0)
            for v in graph.get(u, ()):
                if v not in prev and cap[(u, v)] > 0:
                    prev[v] = u
                    q.append(v)
        if SINK not in prev:
            break
        v = SINK
        while prev[v] is not None:
            u = prev[v]
            cap[(u, v)] -= 1
            cap[(v, u)] += 1
            v = u
    reachable = set(prev)
    return [(u, v) for u, vs in adj.items() for v in vs if u in reachable and v not in reachable]


class BlueTeamAgent:
    """
    Remediation agent. Pulls the permission edges from the active engine, computes a real
    minimum edge cut between the identity and every Crown Jewel, prefers the cut with the
    least collateral, measures who else it protects, and verifies the fix with a fresh
    shortestPath query after applying it. Remediations are stored as graph nodes.
    """
    AGENT_ID = "blue_team_v2"

    def __init__(self, client=None):
        self.client = client or falkor_client

    # ── analysis ──────────────────────────────────────────────────────────────
    def _snapshot(self):
        g = self.client.engine
        edges = g.attack_edges()
        adj: Dict[str, List[str]] = {}
        meta: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for e in edges:
            adj.setdefault(e["src"], []).append(e["dst"])
            meta[(e["src"], e["dst"])] = e
        cjs = {e["dst"] for e in edges if e["dst_is_crown_jewel"]}
        users = [u["properties"]["name"] for u in g.list_nodes("User")]
        return adj, meta, cjs, users

    def plan_cut(self, entrypoint: str) -> Dict[str, Any]:
        adj, meta, cjs, users = self._snapshot()
        exposed_before = {u for u in users if _reach(adj, u) & cjs}
        if entrypoint not in exposed_before:
            return {"status": "no_path"}

        path_edges = {(u, v) for u, vs in adj.items() for v in vs
                      if u in _reach(adj, entrypoint) and (_reach(adj, v) & cjs or v in cjs)}
        # Every single edge that alone disconnects the entrypoint, scored by collateral
        candidates = []
        for edge in path_edges:
            if _reach(adj, entrypoint, {edge}) & cjs:
                continue
            collateral = 0
            protected = []
            for u in users:
                before = _reach(adj, u)
                after = _reach(adj, u, {edge})
                lost = {n for n in before - after if n not in cjs}
                collateral += len(lost)
                if u in exposed_before and not (after & cjs):
                    protected.append(u)
            candidates.append({"edges": [edge], "collateral": collateral, "protected": protected})

        if candidates:
            candidates.sort(key=lambda c: (c["collateral"], -len(c["protected"])))
            best = candidates[0]
            method = f"Single-edge minimum cut (evaluated {len(candidates)} candidate cut(s), chose least collateral)"
        else:
            cut = _min_edge_cut(adj, entrypoint, cjs)
            removed = set(cut)
            protected = [u for u in exposed_before if not (_reach(adj, u, removed) & cjs)]
            best = {"edges": cut, "collateral": None, "protected": protected}
            method = f"Max-flow minimum edge cut ({len(cut)} edges)"

        removed = set(best["edges"])
        exposed_after = {u for u in users if _reach(adj, u, removed) & cjs}
        return {
            "status": "ok", "method": method, "cut": best["edges"],
            "cut_meta": [meta[e] for e in best["edges"]],
            "collateral": best["collateral"],
            "protected_identities": sorted(best["protected"]),
            "also_protected": sorted(u for u in best["protected"] if u != entrypoint),
            "exposed_before": sorted(exposed_before), "exposed_after": sorted(exposed_after),
        }

    def analyze_and_remediate(self, attack_result: Dict[str, Any]) -> Dict[str, Any]:
        t0 = time.perf_counter()
        g = self.client.engine
        path_nodes = attack_result.get("path_nodes", [])
        entrypoint = attack_result.get("entrypoint", "Unknown")
        if len(path_nodes) < 2:
            return {"status": "error", "message": "No path to Crown Jewels. Zero remediation required.",
                    "execution_time_ms": 0.0}

        prior = g.recall_incidents(entrypoint=entrypoint, limit=10)
        is_repeat = len(prior) > 1
        regressions = [r for r in g.recall_remediations() if
                       any(r.get("src") == n["name"] for n in path_nodes) and
                       any(r.get("dst") == n["name"] for n in path_nodes)]

        plan = self.plan_cut(entrypoint)
        if plan["status"] != "ok":
            return {"status": "error", "message": "Path no longer exists — nothing to cut.", "execution_time_ms": 0.0}
        src_name, tgt_name = plan["cut"][0]
        m0 = plan["cut_meta"][0]

        blast_before = g.compute_blast_radius(entrypoint)
        # Projected "after": same BFS on the snapshot minus the cut
        adj, meta, cjs, users = self._snapshot()
        after_nodes = _reach(adj, entrypoint, set(plan["cut"])) - {entrypoint}
        blast_after = {"reachable_nodes_count": len(after_nodes),
                       "crown_jewels_count": len(after_nodes & cjs),
                       "risk_level": "LOW" if not (after_nodes & cjs) else "CRITICAL"}
        before_cnt = len(_reach(adj, entrypoint) - {entrypoint})
        reduction = round((1 - len(after_nodes) / max(1, before_cnt)) * 100, 1)

        memory_obs = f"Found {len(prior)} :Incident node(s) for '{entrypoint}' in graph memory. "
        if regressions:
            r = regressions[0]
            memory_obs += (f"REGRESSION: edge {r['src']} → {r['dst']} was remediated before "
                           f"({time.strftime('%H:%M:%S', time.localtime(r['timestamp']))}) and has reappeared. P0.")
        elif is_repeat:
            memory_obs += "Repeat finding for this identity — priority raised to P0."
        else:
            memory_obs += "First recorded incident for this identity — P1."
        priority = "P0 EMERGENCY" if (is_repeat or regressions) else "P1 Standard"

        n_before, n_after = len(plan["exposed_before"]), len(plan["exposed_after"])
        thoughts = [
            {"step": 1, "phase": "Episodic Memory Recall", "observation": memory_obs,
             "memory_nodes_queried": len(prior), "is_repeat_offender": is_repeat},
            {"step": 2, "phase": "Path Analysis",
             "observation": f"Ingested {attack_result.get('total_hops', 0)}-hop path: "
                            f"{' → '.join(n['name'] for n in path_nodes)}."},
            {"step": 3, "phase": "Minimum Cut",
             "observation": f"{plan['method']}. Cut: {src_name} ─[{m0['type']}]→ {tgt_name}. "
                            f"Collateral: {plan['collateral'] if plan['collateral'] is not None else 'n/a'} "
                            f"legitimate reachability pairs lost org-wide."},
            {"step": 4, "phase": "Organisation-wide Impact",
             "observation": f"Identities exposed to Crown Jewels: {n_before} → {n_after}. "
                            + (f"This cut also protects {', '.join(plan['also_protected'])}."
                               if plan["also_protected"] else "No other identity depended on this edge."),
             "blast_before": blast_before, "blast_after": blast_after},
            {"step": 5, "phase": "Terraform Remediation Synthesis",
             "observation": f"Generated {m0['type']} revocation patch for {src_name} → {tgt_name}."},
        ]
        incident_id = attack_result.get("incident_id")
        if incident_id:
            g.store_agent_memory(self.AGENT_ID, f"plan_{incident_id}", {"cut": [src_name, tgt_name]})

        return {
            "status": "success",
            "choke_point": {"source_id": src_name, "source_name": src_name, "source_type": m0["src_label"],
                            "target_id": tgt_name, "target_name": tgt_name, "target_type": m0["dst_label"],
                            "relation": m0["type"],
                            "recommended_action": f"Revoke {m0['type']}: {src_name} → {tgt_name}"},
            "cut_edges": [{"source": a, "target": b} for a, b in plan["cut"]],
            "cut_method": plan["method"],
            "collateral_pairs_lost": plan["collateral"],
            "also_protected": plan["also_protected"],
            "exposed_identities_before": plan["exposed_before"],
            "exposed_identities_after": plan["exposed_after"],
            "blast_radius_before": blast_before, "blast_radius_after": blast_after,
            "blast_radius_reduced_percent": reduction,
            "business_impact_score": (f"{plan['collateral']} legitimate access pairs lost"
                                      if plan["collateral"] is not None else "multi-edge cut"),
            "is_repeat_offender": is_repeat, "repeat_incident_count": len(prior),
            "regression_detected": bool(regressions),
            "priority": priority,
            "terraform_patch": self._generate_terraform_patch(m0, entrypoint, is_repeat),
            "thoughts": thoughts,
            "engine": g.ENGINE_NAME,
            "execution_time_ms": round((time.perf_counter() - t0) * 1000.0, 3),
            "agent_mode": "min_cut_remediator",
        }

    def _generate_terraform_patch(self, edge: Dict[str, Any], entrypoint: str, is_repeat: bool) -> str:
        s, d, t = edge["src"], edge["dst"], edge["type"]
        sl, dl = s.lower(), d.lower()
        tag = "P0_EMERGENCY" if is_repeat else "P1_STANDARD"
        head = (f"# ARGUS REMEDIATION — {tag}\n# Identity: {entrypoint}\n"
                f"# Revoke edge: {s} -[{t}]-> {d}\n")
        if t == "CAN_ASSUME":
            body = (f'# Remove {s} from the trust policy of role {d}\n'
                    f'resource "aws_iam_role" "{dl}" {{\n  name = "{d}"\n'
                    f'  assume_role_policy = jsonencode({{\n    Statement = [\n'
                    f'-     {{ Effect = "Allow", Principal = {{ AWS = aws_iam_user.{sl}.arn }}, Action = "sts:AssumeRole" }},\n'
                    f'    ]\n  }})\n}}\n')
        elif t == "HAS_POLICY":
            body = (f'- resource "aws_iam_policy_attachment" "{sl}_{dl}" {{\n'
                    f'-   policy_arn = aws_iam_policy.{dl}.arn\n-   users = ["{s}"]\n- }}\n')
        elif t == "ATTACHED_TO":
            body = (f'# Detach role {s} from instance profile of {d}\n'
                    f'resource "aws_iam_instance_profile" "{dl}" {{\n- role = aws_iam_role.{sl}.name\n'
                    f'+ role = aws_iam_role.{dl}_least_privilege.name\n}}\n')
        elif t == "MEMBER_OF":
            body = (f'- resource "aws_iam_group_membership" "{sl}_{dl}" {{\n-   users = ["{s}"]\n'
                    f'-   group = "{d}"\n- }}\n')
        else:
            body = (f'resource "aws_iam_role_policy" "{sl}_scope" {{\n  role = aws_iam_role.{sl}.id\n'
                    f'  policy = jsonencode({{ Statement = [{{ Effect = "Deny", Action = "*", '
                    f'Resource = "arn:aws:*:::{d}" }}] }})\n}}\n')
        return head + body

    # ── apply / verify / undo ─────────────────────────────────────────────────
    def apply_remediation_cypher(self, source_name: str, target_name: str,
                                 entrypoint: Optional[str] = None, incident_id: Optional[str] = None) -> Dict[str, Any]:
        t0 = time.perf_counter()
        g = self.client.engine
        exposed_before = g.exposed_identities()
        removed = g.remove_edge(source_name, target_name)
        for e in removed:
            g.store_remediation({"src": e["src"], "dst": e["dst"], "type": e["type"],
                                 "edge_properties": e["properties"], "entrypoint": entrypoint or "",
                                 "incident_id": incident_id or "", "status": "applied"})
        if incident_id:
            g.update_incident(incident_id, {"status": "remediated"})
        # Verification: fresh shortestPath queries against the engine
        exposed_after = g.exposed_identities()
        check = entrypoint or (exposed_before[0] if exposed_before else None)
        remaining = g.find_shortest_path(check) if check else None
        return {
            "status": "applied" if removed else "no_edge",
            "severed_edge": f"{source_name} → {target_name}",
            "edges_removed": len(removed),
            "cypher_executed": "MATCH (a)-[r]->(b) WHERE a.name = $s AND b.name = $d DELETE r",
            "verification": {
                "method": "shortestPath re-query for every identity",
                "entrypoint_checked": check,
                "paths_remaining_for_entrypoint": 0 if remaining is None else 1,
                "exposed_before": exposed_before, "exposed_after": exposed_after,
                "verified": remaining is None,
            },
            "engine": g.ENGINE_NAME,
            "execution_time_ms": round((time.perf_counter() - t0) * 1000.0, 3),
        }

    def undo_remediation(self, source_name: str, target_name: str) -> Dict[str, Any]:
        g = self.client.engine
        rems = g.recall_remediations(source_name, target_name)
        if not rems:
            return {"status": "not_found"}
        r = rems[0]
        g.restore_edge(r["src"], r["dst"], r["type"], r.get("edge_properties") or {})
        return {"status": "restored", "edge": f"{r['src']} → {r['dst']}", "type": r["type"],
                "exposed_now": g.exposed_identities()}


blue_team_agent = BlueTeamAgent()
