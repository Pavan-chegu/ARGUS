"""
RedTeamAgent — Autonomous Iterative Graph Explorer
====================================================

Instead of issuing one `shortestPath()` Cypher call and summarizing it,
this agent explores the IAM graph HOP BY HOP, making deliberate decisions
at each step. This is the "Graph as Cognitive Brain" demo:

  1. Start at the entrypoint node
  2. Query FalkorDB for immediate neighbors (1-hop lookahead)
  3. Score each neighbor by threat potential (is it a role? a critical resource?)
  4. Commit to the best next hop — and write that decision into AgentMemory
  5. Repeat until Crown Jewel is reached or max_hops is exceeded
  6. On completion, persist an Incident node — FalkorDB gains "memory"

Subsequent runs can RECALL prior incidents, proving the graph holds state
across sessions — something Vector RAG fundamentally cannot do.
"""

import time
import uuid
import logging
from typing import Dict, List, Any, Optional, Generator
from backend.db.falkor import falkor_client, ACTIVE_REMEDIATIONS_CYPHER

logger = logging.getLogger(__name__)

# Threat scoring weights for next-hop selection
_LABEL_SCORES = {
    "Resource": 30,   # Base score — but Crown Jewels get +200 bonus below
    "Role": 80,       # Role assumption — strong escalation signal
    "Policy": 65,     # Policy attachment — may unlock roles
    "Compute": 50,    # Compute nodes can carry instance profiles
    "User": 20,       # Lateral movement to another user
    "Incident": 0,    # Skip memory nodes
    "AgentMemory": 0,
}

_RELATION_SCORES = {
    "CAN_ACCESS": 10,
    "CAN_ASSUME": 30,
    "HAS_POLICY": 20,
    "ATTACHED_TO": 15,
    "MEMBER_OF": 5,
    "TRIGGERED": 0,
}


REGRESSION_BONUS = 300  # a remediated edge that came back is the first thing an attacker would try


def _score_node(node: Dict[str, Any]) -> int:
    """Heuristic threat score for next-hop selection."""
    label = node.get("label", "Node")
    props = node.get("properties", {})
    score = _LABEL_SCORES.get(label, 10)
    if props.get("is_crown_jewel") or props.get("sensitivity") == "CrownJewel":
        score += 200   # Massive jackpot bonus for Crown Jewels
    elif label == "Resource" and not props.get("is_crown_jewel"):
        score -= 25    # Penalize dead-end internal resources
    if props.get("is_compromised"):
        score -= 20    # Already compromised — less interesting
    return score


class RedTeamAgent:
    """
    Best-first explorer of the IAM permission graph (synthetic demo data).

    Each expansion is one neighbours query against the active engine (Cypher in live mode).
    A priority frontier keeps the alternatives, so a dead end leads to a visible
    backtrack instead of a missed finding. The result is checked against the
    engine's shortestPath ground truth.
    """
    AGENT_ID = "red_team_v2"
    MAX_EXPANSIONS = 60

    def __init__(self, client=None):
        self.client = client or falkor_client

    def _load_remediated_edges(self) -> Dict[tuple, Dict[str, Any]]:
        """{(src_name, dst_name): {id, type}} for every edge the Blue Team severed and nobody reverted.
        Read fresh on every run through (s)<-[:SEVERED_FROM]-(:Remediation)-[:SEVERED]->(d)."""
        try:
            return {(e["src"], e["dst"]): e for e in self.client.engine.active_remediated_edges()}
        except Exception as e:  # memory is advisory; never block an attack run on it
            logger.warning(f"Could not load remediation memory: {e}")
            return {}

    def _decide(self, run_id: str, step: int, action: str, reason: str, **kw) -> Optional[str]:
        try:
            return self.client.engine.record_decision(self.AGENT_ID, run_id, step, action, reason, **kw)
        except Exception as e:
            logger.warning(f"record_decision failed: {e}")
            return None

    def recall_prior_incidents(self, entrypoint: str) -> List[Dict[str, Any]]:
        return self.client.engine.recall_incidents(entrypoint=entrypoint, limit=3)

    def execute_attack_simulation(self, entrypoint_name: str, max_hops: int = 8,
                                  record_incident: bool = True) -> Dict[str, Any]:
        import heapq, itertools
        t0 = time.perf_counter()
        g = self.client.engine
        db_ms = 0.0

        run_id = f"run_{uuid.uuid4().hex[:12]}"
        prior = self.recall_prior_incidents(entrypoint_name)
        remediated = self._load_remediated_edges()
        start = g.get_node(entrypoint_name)
        if not start:
            return {"status": "failed", "entrypoint": entrypoint_name,
                    "message": f"Identity '{entrypoint_name}' not found in IAM graph.",
                    "steps": [], "path_nodes": [], "prior_incidents": [], "run_id": run_id,
                    "execution_time_ms": 0.0, "engine": g.ENGINE_NAME}

        name = lambda n: n.get("properties", {}).get("name", n.get("id"))
        is_cj = lambda n: bool(n.get("properties", {}).get("is_crown_jewel")) or \
            n.get("properties", {}).get("sensitivity") == "CrownJewel"

        note = ""
        if prior:
            p = prior[0]["properties"]
            note = (f" Prior incident on record: reached '{p.get('target')}' in {p.get('hops')} hops "
                    f"via {' → '.join(p.get('path_chain') or [])}.")
        # Verify every remembered cut: a severed edge that exists again is drift (a regression).
        try:
            present = g.edges_present(list(remediated.keys()))
        except Exception as e:
            logger.warning(f"edge existence check failed: {e}")
            present = {}
        fmt = lambda s, d, e: f"{s} ─[{e.get('type')}]─▶ {d} ({e.get('id')})"
        reappeared = {k: e for k, e in remediated.items() if present.get(k)}
        if not remediated:
            note += " No active remediations in graph memory."
        elif not reappeared:
            note += (f" {len(remediated)} severed edge(s) remembered, verified still absent: "
                     + ", ".join(fmt(s, d, e) for (s, d), e in remediated.items()) + ".")
        else:
            note += (f" WARNING: {len(reappeared)} of {len(remediated)} remembered severed edge(s) exist again "
                     f"(drift): " + ", ".join(fmt(s, d, e) for (s, d), e in reappeared.items())
                     + ". Prioritising them as known-dangerous.")
        prior_ids = [i["id"] for i in prior if i.get("id")]
        rem_ids = [e["id"] for e in remediated.values() if e.get("id")]
        steps: List[Dict[str, Any]] = [{
            "step_index": 0, "phase": "Memory Recall",
            "action": f"Recalling :Incident and :Remediation memory linked to '{entrypoint_name}' from the graph.",
            "thought": f"Found {len(prior)} prior incident(s).{note} Starting best-first exploration.",
            "node_id": start["id"], "memory_nodes_found": len(prior) + len(remediated),
            "remediations_verified": [{"src": s, "dst": d, "type": e.get("type"), "remediation_id": e.get("id"),
                                       "still_absent": not present.get((s, d), False)}
                                      for (s, d), e in remediated.items()],
            "memory_cypher": ACTIVE_REMEDIATIONS_CYPHER,
        }]
        self._decide(run_id, 0, "recall_memory", steps[0]["thought"], chosen=name(start),
                     informed_by=prior_ids + rem_ids)
        prior_paths = {i["id"]: set(i["properties"].get("path_chain") or []) for i in prior}
        regressions: List[Dict[str, Any]] = []

        counter = itertools.count()
        frontier: list = []          # (-score, tiebreak, node, parent_id, relation, depth)
        parent: Dict[str, Any] = {start["id"]: None}
        nodes_by_id = {start["id"]: start}
        rel_into: Dict[str, str] = {}
        depth_of = {start["id"]: 0}
        goal = None
        expansions = 0
        current = start

        def expand(node):
            nonlocal db_ms
            t = time.perf_counter()
            nbrs = g.neighbors(node["id"])
            db_ms += (time.perf_counter() - t) * 1000.0
            added = 0
            for nb in nbrs:
                n = nb["node"]
                if n["id"] in parent:
                    continue
                score = _score_node(n) + _RELATION_SCORES.get(nb["relation"], 0)
                if not is_cj(n) and g.has_crown_jewel_neighbor(n["id"]):
                    score += 150
                # A remembered-severed edge that is live again is a known-dangerous regression
                if (name(node), name(n)) in remediated:
                    score += REGRESSION_BONUS
                heapq.heappush(frontier, (-score, next(counter), n, node["id"], nb["relation"],
                                          depth_of[node["id"]] + 1))
                added += 1
            return added

        expand(start)
        while frontier and expansions < self.MAX_EXPANSIONS:
            neg, _, node, pid, rel, depth = heapq.heappop(frontier)
            if node["id"] in parent or depth > max_hops:
                continue
            parent[node["id"]] = pid
            nodes_by_id[node["id"]] = node
            rel_into[node["id"]] = rel
            depth_of[node["id"]] = depth
            expansions += 1

            backtracked = pid != current["id"]
            if backtracked:
                steps.append({
                    "step_index": len(steps), "phase": "Backtrack",
                    "action": f"Dead end at '{name(current)}' — returning to '{name(nodes_by_id[pid])}'.",
                    "thought": "Branch exhausted; resuming from the best remaining alternative on the frontier.",
                    "node_id": pid, "node_name": name(nodes_by_id[pid]),
                })
                self._decide(run_id, steps[-1]["step_index"], "backtrack",
                             f"{steps[-1]['action']} {steps[-1]['thought']}", chosen=name(nodes_by_id[pid]))
            label = node.get("label", "Node")
            found = is_cj(node)
            phase = ("Objective Reached" if found else
                     "Privilege Escalation" if label in ("Role", "Policy") else
                     "Lateral Movement" if label == "Compute" else "Reconnaissance")
            # Top-2 live alternatives (heap may hold stale duplicates of visited nodes)
            alts, seen_alt = [], set()
            for f in sorted(frontier):
                fid = f[2]["id"]
                if fid in parent or fid in seen_alt or f[5] > max_hops:
                    continue
                seen_alt.add(fid)
                alts.append({"name": name(f[2]), "label": f[2].get("label"), "relation": f[4], "score": -f[0]})
                if len(alts) == 2:
                    break
            thought = (f"'{name(node)}' is a Crown Jewel ({label}); exposure path confirmed."
                       if found else
                       f"Chose '{name(node)}' ({label}) via {rel} [score {-neg}]. "
                       + (f"Alternatives kept on frontier: {[a['name'] for a in alts]}." if alts else ""))
            src_n = name(nodes_by_id[pid])
            rem = remediated.get((src_n, name(node)))
            if rem:
                phase = "Regression Detected"
                thought = (f"Edge {src_n}→{name(node)} was severed by remediation {rem.get('id')} but exists again."
                           + (f" '{name(node)}' is a Crown Jewel; exposure re-opened." if found else ""))
                regressions.append({"src": src_n, "dst": name(node), "remediation_id": rem.get("id")})
            steps.append({
                "step_index": len(steps), "phase": phase,
                "action": f"Hop {depth}: {src_n} ──[{rel}]──▶ {name(node)}",
                "thought": thought,
                "node_id": node["id"], "node_name": name(node), "node_label": label, "relation": rel,
                "threat_score": -neg, "alternatives_considered": alts, "crown_jewel_reached": found,
                "regression": bool(rem), "db_ms": round(g.last_query_ms, 3),
            })
            # Provenance: the remediation a regression hop contradicts, plus prior incidents
            # whose path already went through the chosen node.
            informed = ([rem["id"]] if rem and rem.get("id") else []) + \
                [iid for iid, chain in prior_paths.items() if name(node) in chain]
            action = "regression" if rem else ("objective_reached" if found else "hop")
            self._decide(run_id, steps[-1]["step_index"], action,
                         f"{steps[-1]['action']}. {steps[-1]['thought']}", chosen=name(node),
                         considered=[{"name": a["name"], "score": a["score"]} for a in alts],
                         informed_by=informed, score=-neg)
            current = node
            if found:
                goal = node
                break
            expand(node)

        path: List[Dict[str, Any]] = []
        if goal:
            nid = goal["id"]
            while nid is not None:
                path.append(nodes_by_id[nid])
                nid = parent[nid]
            path.reverse()
        else:
            steps.append({"step_index": len(steps), "phase": "Dead End",
                          "action": f"Frontier exhausted after {expansions} expansions.",
                          "thought": "No reachable Crown Jewel from this identity."
                                     + (" Remembered remediations (verified absent) closed the previous route."
                                        if remediated else ""),
                          "node_id": current["id"]})
            self._decide(run_id, steps[-1]["step_index"], "dead_end",
                         f"{steps[-1]['action']} {steps[-1]['thought']}", chosen=name(current),
                         informed_by=rem_ids)

        # Ground truth check against the engine's shortestPath
        truth = g.find_shortest_path(entrypoint_name)
        truth_hops = len(truth) - 1 if truth else 0
        verified = (truth is None) == (goal is None)

        hops = len(path) - 1 if path else 0
        incident_id = None
        if goal and record_incident:
            incident_id = g.store_incident({
                "entrypoint": entrypoint_name, "target": name(goal), "hops": hops,
                "path_chain": [name(n) for n in path],
                "choke_source": name(path[1]) if len(path) > 2 else name(path[0]),
                "choke_target": name(path[2]) if len(path) > 2 else name(path[1]),
                "status": "active", "severity": "CRITICAL" if hops <= 4 else "HIGH",
                "regression": bool(regressions),
            })
            try:
                g.link_run_to_incident(run_id, incident_id)
            except Exception as e:
                logger.warning(f"link_run_to_incident failed: {e}")

        return {
            "status": "success" if goal else "failed",
            "entrypoint": entrypoint_name,
            "target_compromised": name(goal) if goal else None,
            "total_hops": hops,
            "execution_time_ms": round((time.perf_counter() - t0) * 1000.0, 3),
            "db_time_ms": round(db_ms, 3),
            "expansions": expansions,
            "engine": g.ENGINE_NAME,
            "cypher_executed": "Best-first exploration: one neighbours query per expansion",
            "path_nodes": [{"id": n["id"], "name": name(n), "label": n.get("label", "Node"),
                            "properties": n.get("properties", {})} for n in path],
            "steps": steps,
            "incident_id": incident_id,
            "run_id": run_id,
            "regressions": regressions,
            "remediations_remembered": [{"src": s, "dst": d, "type": e.get("type"), "id": e.get("id")}
                                        for (s, d), e in remediated.items()],
            "prior_incidents": [{"id": i["id"], "entrypoint": i["properties"].get("entrypoint"),
                                 "target": i["properties"].get("target"), "hops": i["properties"].get("hops"),
                                 "timestamp": i["properties"].get("timestamp")} for i in prior],
            "memory_written": incident_id is not None,
            "ground_truth": {"method": "shortestPath", "hops": truth_hops,
                             "path": [name(n) for n in truth] if truth else [], "agrees": verified},
            "agent_mode": "best_first_with_backtracking",
        }


red_team_agent = RedTeamAgent()
