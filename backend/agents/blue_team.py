"""
BlueTeamAgent — Memory-Augmented Autonomous Remediator
=======================================================

Upgraded from a simple choke-point calculator to a memory-augmented agent:

  1. Receives the attack result (from RedTeamAgent)
  2. Queries FalkorDB for PAST Incident nodes on the same entrypoint (episodic memory)
  3. Detects if this is a REPEAT offender — escalates severity
  4. Finds the optimal edge cut with Cypher path queries executed inside FalkorDB
  5. Generates Terraform HCL remediation patch
  6. Updates the Incident node status to "remediated" (memory write-back)
  7. Records its decisions as provenance nodes and streams a reasoning trace for the UI

All graph analysis (candidate edges, disconnect test, collateral, projected blast radius) is
Cypher run by FalkorDB — there is no Python-side copy of the graph.
"""

import time
import uuid
import logging
from typing import Any, Dict, List, Optional, Tuple
from backend.db.falkor import falkor_client, ATTACK_RELS

logger = logging.getLogger(__name__)

MAX_HOPS = 8
_CJ = "(cj:Resource {is_crown_jewel: true})"

# ── Cypher used by the planner (also returned under the "cypher" key) ─────────────
# 1. Candidate cut edges: every attack edge on a bounded path entrypoint → any Crown Jewel,
#    with the number of such paths through it and its earliest hop index. $removed lets the
#    greedy fallback re-query the residual graph.
Q_CANDIDATES = (
    f"MATCH p=(s)-[:{ATTACK_RELS}*1..{MAX_HOPS}]->{_CJ} WHERE s.name = $src "
    f"AND NONE(x IN relationships(p) WHERE id(x) IN $removed) "
    f"UNWIND range(0, length(p) - 1) AS i "
    f"WITH relationships(p)[i] AS r, i "
    f"RETURN id(r), startNode(r).name, labels(startNode(r))[0], endNode(r).name, labels(endNode(r))[0], "
    f"type(r), coalesce(endNode(r).is_crown_jewel, false), count(*) AS paths, min(i) AS hop, properties(r) "
    f"ORDER BY paths DESC, hop DESC")
# 2. Disconnect test: for each candidate cut (list of edge ids), how many attack paths from the
#    entrypoint to a Crown Jewel survive when those edges are excluded? 0 => the cut works.
Q_SURVIVES = (
    f"UNWIND $cuts AS cut "
    f"OPTIONAL MATCH p=(s)-[:{ATTACK_RELS}*1..{MAX_HOPS}]->{_CJ} WHERE s.name = $src "
    f"AND NONE(x IN relationships(p) WHERE id(x) IN cut) "
    f"RETURN cut, count(p) AS surviving_paths")
# 3. Org-wide exposure with a cut applied: identities that still reach a Crown Jewel.
Q_EXPOSED = (
    f"UNWIND $cuts AS cut "
    f"OPTIONAL MATCH p=(u:User)-[:{ATTACK_RELS}*1..{MAX_HOPS}]->{_CJ} "
    f"WHERE NONE(x IN relationships(p) WHERE id(x) IN cut) "
    f"RETURN cut, collect(DISTINCT u.name)")
# 4. Collateral of cutting edge $eid: (identity, non-crown-jewel node) reachability pairs routed
#    through the edge that have NO alternative path avoiding it.
Q_COLLATERAL = (
    f"MATCH (a)-[e]->(b) WHERE id(e) = $eid WITH a, e, b "
    f"MATCH up=(u:User)-[:{ATTACK_RELS}*0..{MAX_HOPS - 1}]->(a) WITH u, min(length(up)) AS du, e, b "
    f"MATCH dn=(b)-[:{ATTACK_RELS}*0..{MAX_HOPS - 1}]->(n) "
    f"WHERE NOT coalesce(n.is_crown_jewel, false) AND du + 1 + length(dn) <= {MAX_HOPS} "
    f"WITH DISTINCT u, n, e "
    f"OPTIONAL MATCH alt=(u)-[:{ATTACK_RELS}*1..{MAX_HOPS}]->(n) "
    f"WHERE NONE(x IN relationships(alt) WHERE id(x) = id(e)) "
    f"WITH u, n, count(alt) AS alternatives WHERE alternatives = 0 "
    f"RETURN count(*)")
# 5. Projected blast radius of the entrypoint with the cut edges excluded.
Q_BLAST = (
    f"MATCH p=(s)-[:{ATTACK_RELS}*1..{MAX_HOPS}]->(m) WHERE s.name = $src AND m <> s "
    f"AND NONE(x IN relationships(p) WHERE id(x) IN $removed) "
    f"WITH DISTINCT m RETURN count(m), sum(CASE WHEN m.is_crown_jewel = true THEN 1 ELSE 0 END)")
Q_DELETE = f"MATCH (a)-[r:{ATTACK_RELS}]->(b) WHERE a.name = $s AND b.name = $d DELETE r"
Q_VERIFY = (f"MATCH (s), (t:Resource) WHERE s.name = $x AND t.is_crown_jewel = true "
            f"WITH s, t, shortestPath((s)-[:{ATTACK_RELS}*1..{MAX_HOPS}]->(t)) AS p WHERE p IS NOT NULL "
            f"RETURN p ORDER BY length(p) LIMIT 1")


class BlueTeamAgent:
    """
    Remediation agent. Candidate cut edges are the edges on bounded attack paths entrypoint →
    Crown Jewel (Cypher); each candidate is tested by re-running the path query with that edge
    excluded (Cypher); collateral is the number of identity→resource pairs that only exist through
    the edge (Cypher). If no single edge disconnects, a greedy loop repeatedly cuts the edge that
    carries the most surviving paths, as counted by FalkorDB. The fix is verified with a fresh
    shortestPath query after applying it. Remediations and decisions are stored as graph nodes.
    """
    AGENT_ID = "blue_team"
    GREEDY_MAX_EDGES = 25

    def __init__(self, client=None):
        self.client = client or falkor_client

    # ── Cypher helpers ────────────────────────────────────────────────────────
    def _q(self, cypher: str, params: Dict[str, Any], timer: Dict[str, Any]) -> List[List[Any]]:
        g = self.client.engine
        rows = g.q(cypher, params)
        timer["ms"] += float(getattr(g, "last_query_ms", 0.0) or 0.0)
        timer["n"] += 1
        return rows

    @staticmethod
    def _edge(row) -> Dict[str, Any]:
        return {"id": row[0], "src": row[1], "src_label": row[2], "dst": row[3], "dst_label": row[4],
                "type": row[5], "dst_is_crown_jewel": bool(row[6]), "paths": row[7], "hop": row[8],
                "properties": dict(row[9] or {})}

    def _candidates(self, src: str, removed: List[int], timer) -> List[Dict[str, Any]]:
        return [self._edge(r) for r in self._q(Q_CANDIDATES, {"src": src, "removed": removed}, timer)]

    def _exposed(self, cuts: List[List[int]], timer) -> Dict[Tuple[int, ...], List[str]]:
        rows = self._q(Q_EXPOSED, {"cuts": cuts}, timer)
        return {tuple(r[0]): sorted(x for x in r[1] if x is not None) for r in rows}

    # ── analysis ──────────────────────────────────────────────────────────────
    def plan_cut(self, entrypoint: str) -> Dict[str, Any]:
        timer = {"ms": 0.0, "n": 0}
        cypher = [Q_CANDIDATES, Q_SURVIVES, Q_EXPOSED, Q_COLLATERAL]
        exposed_before = self._exposed([[]], timer).get((), [])
        if entrypoint not in exposed_before:
            return {"status": "no_path", "cypher": cypher,
                    "falkordb_time_ms": round(timer["ms"], 3), "falkordb_queries": timer["n"]}

        cands = self._candidates(entrypoint, [], timer)
        # Which single edges disconnect the entrypoint from every Crown Jewel?
        surv = self._q(Q_SURVIVES, {"src": entrypoint, "cuts": [[c["id"]] for c in cands]}, timer)
        cutting = {r[0][0] for r in surv if r[1] == 0}
        singles = [c for c in cands if c["id"] in cutting]
        exposed_by_cut = self._exposed([[c["id"]] for c in singles], timer) if singles else {}

        scored = []
        for c in singles:
            collateral = self._q(Q_COLLATERAL, {"eid": c["id"]}, timer)[0][0]
            after = set(exposed_by_cut.get((c["id"],), []))
            protected = [u for u in exposed_before if u not in after]
            scored.append({"edges": [c], "collateral": collateral, "protected": protected})

        if scored:
            # least collateral, then most identities protected, then closest to the Crown Jewel
            scored.sort(key=lambda s: (s["collateral"], -len(s["protected"]), -s["edges"][0]["hop"],
                                       s["edges"][0]["src"], s["edges"][0]["dst"]))
            best = scored[0]
            method = (f"Single-edge minimum cut via Cypher (evaluated {len(scored)} candidate cut(s) "
                      f"of {len(cands)} attack-path edge(s), chose least collateral)")
        else:
            # Greedy multi-edge cut: cut the edge carrying the most surviving attack paths, re-query.
            removed: List[Dict[str, Any]] = []
            remaining = cands
            while remaining and len(removed) < self.GREEDY_MAX_EDGES:
                removed.append(remaining[0])  # Cypher orders by path count DESC
                remaining = self._candidates(entrypoint, [e["id"] for e in removed], timer)
            ids = [e["id"] for e in removed]
            after = set(self._exposed([ids], timer).get(tuple(ids), []))
            best = {"edges": removed, "collateral": None,
                    "protected": [u for u in exposed_before if u not in after]}
            method = f"Greedy multi-edge cut via Cypher path counts ({len(removed)} edges)"

        ids = [e["id"] for e in best["edges"]]
        exposed_after = self._exposed([ids], timer).get(tuple(ids), [])
        meta_keys = ("src", "src_label", "dst", "dst_label", "type", "dst_is_crown_jewel", "properties")
        return {
            "status": "ok", "method": method,
            "cut": [(e["src"], e["dst"]) for e in best["edges"]],
            "cut_meta": [{k: e[k] for k in meta_keys} for e in best["edges"]],
            "cut_edge_ids": ids,
            "collateral": best["collateral"],
            "protected_identities": sorted(best["protected"]),
            "also_protected": sorted(u for u in best["protected"] if u != entrypoint),
            "exposed_before": sorted(exposed_before), "exposed_after": sorted(exposed_after),
            "candidates": [{"source": s["edges"][0]["src"], "target": s["edges"][0]["dst"],
                            "collateral": s["collateral"], "protected": len(s["protected"])} for s in scored],
            "path_edges_considered": len(cands),
            "cypher": cypher,
            "falkordb_time_ms": round(timer["ms"], 3), "falkordb_queries": timer["n"],
        }

    # ── provenance (guarded: the LiveGraph API may not have these yet) ─────────
    def _record_decision(self, **kw) -> Optional[str]:
        g = self.client.engine
        if not hasattr(g, "record_decision"):
            return None
        try:
            return g.record_decision(**kw)
        except Exception as e:  # provenance must never break remediation
            logger.warning(f"record_decision failed: {e}")
            return None

    def _link_run(self, run_id: str, incident_id: Optional[str]):
        g = self.client.engine
        if incident_id and hasattr(g, "link_run_to_incident"):
            try:
                g.link_run_to_incident(run_id, incident_id)
            except Exception as e:
                logger.warning(f"link_run_to_incident failed: {e}")

    def analyze_and_remediate(self, attack_result: Dict[str, Any]) -> Dict[str, Any]:
        t0 = time.perf_counter()
        g = self.client.engine
        run_id = f"blue_{uuid.uuid4().hex[:12]}"
        path_nodes = attack_result.get("path_nodes", [])
        entrypoint = attack_result.get("entrypoint", "Unknown")
        if len(path_nodes) < 2:
            return {"status": "error", "message": "No path to Crown Jewels. Zero remediation required.",
                    "execution_time_ms": 0.0, "run_id": run_id}

        prior = g.recall_incidents(entrypoint=entrypoint, limit=10)
        is_repeat = len(prior) > 1
        regressions = [r for r in g.recall_remediations() if
                       any(r.get("src") == n["name"] for n in path_nodes) and
                       any(r.get("dst") == n["name"] for n in path_nodes)]

        plan = self.plan_cut(entrypoint)
        if plan["status"] != "ok":
            return {"status": "error", "message": "Path no longer exists — nothing to cut.",
                    "execution_time_ms": 0.0, "run_id": run_id, "cypher": plan.get("cypher", [])}
        src_name, tgt_name = plan["cut"][0]
        m0 = plan["cut_meta"][0]

        blast_before = g.compute_blast_radius(entrypoint)
        # Projected before/after blast radius, computed by FalkorDB with the cut edges excluded
        timer = {"ms": plan["falkordb_time_ms"], "n": plan["falkordb_queries"]}
        before_cnt, _ = self._q(Q_BLAST, {"src": entrypoint, "removed": []}, timer)[0]
        after_cnt, after_cj = self._q(Q_BLAST, {"src": entrypoint, "removed": plan["cut_edge_ids"]}, timer)[0]
        after_cj = after_cj or 0
        blast_after = {"reachable_nodes_count": after_cnt, "crown_jewels_count": after_cj,
                       "risk_level": "LOW" if not after_cj else "CRITICAL"}
        reduction = round((1 - after_cnt / max(1, before_cnt)) * 100, 1)

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
                            f"legitimate reachability pairs lost org-wide. "
                            f"FalkorDB time: {plan['falkordb_time_ms']:.2f} ms over {plan['falkordb_queries']} queries."},
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
        decision_id = self._record_decision(
            agent_id=self.AGENT_ID, run_id=run_id, step=1, action="evaluate_cuts",
            reason=(f"evaluated {len(plan['candidates']) or plan['path_edges_considered']} candidate cuts; "
                    f"{plan['method']}; chose {src_name} -[{m0['type']}]-> {tgt_name} "
                    f"(collateral {plan['collateral']}, exposed {n_before} -> {n_after})"),
            chosen=src_name,
            considered=[{"name": c["source"], "score": float(c["collateral"])} for c in plan["candidates"]],
            informed_by=[incident_id] if incident_id else [],
            score=float(plan["collateral"]) if plan["collateral"] is not None else None)
        self._link_run(run_id, incident_id)  # after the decision exists, so it gets linked

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
            "run_id": run_id, "decision_id": decision_id,
            "cypher": plan["cypher"] + [Q_BLAST],
            "falkordb_time_ms": round(timer["ms"], 3), "falkordb_queries": timer["n"],
        }

    # ── Terraform synthesis ───────────────────────────────────────────────────
    def _edge_context(self, src: str, dst: str) -> Dict[str, Any]:
        """Node properties of both ends, plus the role(s) bound to the source when it is a Compute."""
        try:
            rows = self.client.engine.q(
                "MATCH (a {name: $s}), (b {name: $d}) "
                "OPTIONAL MATCH (r:Role)-[:ATTACHED_TO]->(a) "
                "RETURN properties(a), properties(b), collect(r.name)", {"s": src, "d": dst})
        except Exception as e:
            logger.warning(f"terraform context lookup failed: {e}")
            rows = []
        if not rows:
            return {"src": {}, "dst": {}, "src_roles": []}
        return {"src": dict(rows[0][0] or {}), "dst": dict(rows[0][1] or {}),
                "src_roles": sorted(x for x in rows[0][2] if x)}

    @staticmethod
    def _tf_id(name: str) -> str:
        return "".join(ch if ch.isalnum() else "_" for ch in str(name).lower()).strip("_") or "x"

    def _principal_ref(self, name: str, label: str, src_roles: List[str]) -> Tuple[str, str]:
        """(Terraform ARN reference, description) of the IAM principal behind a node."""
        if label == "User":
            return f"aws_iam_user.{self._tf_id(name)}.arn", f"IAM user {name}"
        if label == "Compute":
            if src_roles:
                return (f"aws_iam_role.{self._tf_id(src_roles[0])}.arn",
                        f"role {src_roles[0]} (instance-profile / execution role of {name})")
            return f"aws_iam_role.{self._tf_id(name)}_role.arn", f"workload role of {name}"
        return f"aws_iam_role.{self._tf_id(name)}.arn", f"IAM role {name}"

    def _resource_arn(self, name: str, props: Dict[str, Any]) -> str:
        rid = self._tf_id(name)
        return {"S3Bucket": f"aws_s3_bucket.{rid}.arn", "KMSKey": f"aws_kms_key.{rid}.arn",
                "DynamoDB": f"aws_dynamodb_table.{rid}.arn", "RDS": f"aws_db_instance.{rid}.arn",
                }.get(props.get("type"), f'"arn:aws:*:::{name}"')

    def _generate_terraform_patch(self, edge: Dict[str, Any], entrypoint: str, is_repeat: bool) -> str:
        s, d, t = edge["src"], edge["dst"], edge["type"]
        src_label, dst_label = edge.get("src_label", ""), edge.get("dst_label", "")
        props = edge.get("properties") or {}
        sid, did = self._tf_id(s), self._tf_id(d)
        ctx = self._edge_context(s, d)
        tag = "P0_EMERGENCY" if is_repeat else "P1_STANDARD"
        head = (f"# ARGUS REMEDIATION — {tag}\n# Identity: {entrypoint}\n"
                f"# Revoke edge: {s} ({src_label}) -[{t}]-> {d} ({dst_label})\n")

        if t == "CAN_ASSUME":  # User | Role | Compute -> Role
            technique = props.get("technique", "sts:AssumeRole")
            granted_by = props.get("granted_by")
            principal, who = self._principal_ref(s, src_label, ctx["src_roles"])
            if granted_by:
                gid = self._tf_id(granted_by)
                body = (f'# {who} obtains role {d} via {technique}, granted by policy {granted_by}.\n'
                        f'# Remove that action on {d} from the granting policy.\n'
                        f'resource "aws_iam_policy" "{gid}" {{\n  name = "{granted_by}"\n'
                        f'  policy = jsonencode({{\n    Statement = [\n'
                        f'-     {{ Effect = "Allow", Action = "{technique}", Resource = aws_iam_role.{did}.arn }},\n'
                        f'    ]\n  }})\n}}\n')
            elif technique == "sts:AssumeRole":
                body = (f'# Remove {who} from the trust policy of role {d}\n'
                        f'resource "aws_iam_role" "{did}" {{\n  name = "{d}"\n'
                        f'  assume_role_policy = jsonencode({{\n    Statement = [\n'
                        f'-     {{ Effect = "Allow", Principal = {{ AWS = {principal} }}, Action = "sts:AssumeRole" }},\n'
                        f'    ]\n  }})\n}}\n')
            else:
                body = (f'# Explicitly deny {technique} on role {d} for {who}\n'
                        f'resource "aws_iam_policy" "deny_{sid}_{did}" {{\n'
                        f'  policy = jsonencode({{ Statement = [{{ Effect = "Deny", Action = "{technique}", '
                        f'Resource = aws_iam_role.{did}.arn }}] }})\n}}\n')
        elif t == "HAS_POLICY":  # User | Role -> Policy
            owner = "user" if src_label == "User" else "role"
            if props.get("attachment") == "inline":
                body = (f'# Delete inline policy {d} from {owner} {s}\n'
                        f'- resource "aws_iam_{owner}_policy" "{sid}_{did}" {{\n-   name = "{d}"\n'
                        f'-   {owner} = "{s}"\n- }}\n')
            else:
                body = (f'# Detach managed policy {d} from {owner} {s}\n'
                        f'resource "aws_iam_policy_attachment" "{did}" {{\n'
                        f'  policy_arn = aws_iam_policy.{did}.arn\n'
                        f'- {owner}s = ["{s}"]\n+ {owner}s = []\n}}\n')
        elif t == "ATTACHED_TO":  # Role -> Compute
            cprops = ctx["dst"]
            if props.get("binding") == "execution-role" or cprops.get("type") == "Lambda":
                body = (f'# Replace execution role {s} on {cprops.get("type", "function")} {d}\n'
                        f'resource "aws_lambda_function" "{did}" {{\n  function_name = "{d}"\n'
                        f'- role = aws_iam_role.{sid}.arn\n+ role = aws_iam_role.{did}_least_privilege.arn\n}}\n')
            else:
                profile = cprops.get("instance_profile") or f"{d}Profile"
                body = (f'# Detach role {s} from instance profile {profile} of {d}\n'
                        f'resource "aws_iam_instance_profile" "{self._tf_id(profile)}" {{\n'
                        f'  name = "{profile}"\n- role = aws_iam_role.{sid}.name\n'
                        f'+ role = aws_iam_role.{did}_least_privilege.name\n}}\n')
        elif t == "MEMBER_OF":  # User -> Role
            body = (f'# Remove user {s} from role {d} (trust / permission-set assignment)\n'
                    f'resource "aws_iam_role" "{did}" {{\n  name = "{d}"\n'
                    f'  assume_role_policy = jsonencode({{\n    Statement = [\n'
                    f'-     {{ Effect = "Allow", Principal = {{ AWS = aws_iam_user.{sid}.arn }}, Action = "sts:AssumeRole" }},\n'
                    f'    ]\n  }})\n}}\n')
        else:  # CAN_ACCESS: Role | Policy | Compute -> Resource
            perm = props.get("permission", "*")
            arn = self._resource_arn(d, ctx["dst"])
            if src_label == "Policy":
                body = (f'# Remove {perm} on {d} from policy {s}\n'
                        f'resource "aws_iam_policy" "{sid}" {{\n  name = "{s}"\n'
                        f'  policy = jsonencode({{\n    Statement = [\n'
                        f'-     {{ Effect = "Allow", Action = "{perm}", Resource = {arn} }},\n'
                        f'    ]\n  }})\n}}\n')
            else:
                note, role = "", s
                if src_label == "Compute":
                    role = ctx["src_roles"][0] if ctx["src_roles"] else f"{s}_role"
                    note = f"# {s} accesses {d} with the credentials of role {role}\n"
                rid = self._tf_id(role)
                body = (note + f'# Deny {perm} on {d} for role {role}\n'
                        f'resource "aws_iam_role_policy" "{rid}_deny_{did}" {{\n  role = aws_iam_role.{rid}.id\n'
                        f'  policy = jsonencode({{ Statement = [{{ Effect = "Deny", Action = "{perm}", '
                        f'Resource = {arn} }}] }})\n}}\n')
        return head + body

    # ── apply / verify / undo ─────────────────────────────────────────────────
    def apply_remediation_cypher(self, source_name: str, target_name: str,
                                 entrypoint: Optional[str] = None, incident_id: Optional[str] = None) -> Dict[str, Any]:
        t0 = time.perf_counter()
        g = self.client.engine
        run_id = f"blue_{uuid.uuid4().hex[:12]}"
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
        t_q = time.perf_counter()
        remaining = g.find_shortest_path(check) if check else None
        verify_ms = float(getattr(g, "last_query_ms", 0.0) or (time.perf_counter() - t_q) * 1000.0)
        decision_id = self._record_decision(
            agent_id=self.AGENT_ID, run_id=run_id, step=1, action="apply_remediation",
            reason=(f"deleted {len(removed)} edge(s) {source_name} -> {target_name}; "
                    f"exposed {len(exposed_before)} -> {len(exposed_after)}; "
                    f"verified={remaining is None}"),
            chosen=source_name, considered=[{"name": source_name, "score": float(len(removed))}],
            informed_by=[incident_id] if incident_id else [], score=float(len(exposed_after)))
        self._link_run(run_id, incident_id)
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
            "run_id": run_id, "decision_id": decision_id,
            "cypher": [Q_DELETE, Q_VERIFY],
            "falkordb_time_ms": round(verify_ms, 3),
        }

    def undo_remediation(self, source_name: str, target_name: str) -> Dict[str, Any]:
        g = self.client.engine
        rems = g.recall_remediations(source_name, target_name)
        if not rems:
            return {"status": "not_found"}
        r = rems[0]
        g.restore_edge(r["src"], r["dst"], r["type"], r.get("edge_properties") or {})
        if hasattr(g, "mark_remediation_reverted"):
            try:
                g.mark_remediation_reverted(r["src"], r["dst"])
            except Exception as e:
                logger.warning(f"mark_remediation_reverted failed: {e}")
        return {"status": "restored", "edge": f"{r['src']} → {r['dst']}", "type": r["type"],
                "exposed_now": g.exposed_identities()}


blue_team_agent = BlueTeamAgent()
