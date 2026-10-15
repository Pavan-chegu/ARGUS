"""
FalkorDB access layer.

Two engines expose the SAME API:
  * LiveGraph      — every call is a Cypher query against FalkorDB (the real engine)
  (InMemoryGraph fallback has been removed — HTTP 503 is returned when FalkorDB is down)

`falkor_client.engine` returns whichever is active. Agents and routers only talk to
`falkor_client.engine`, so in live mode FalkorDB does the traversal, the reachability,
and stores the agents' episodic + procedural memory as graph nodes.
"""
import json
import time
import logging
from collections import deque
from typing import Any, Dict, List, Optional, Tuple
from backend.config import settings

logger = logging.getLogger(__name__)


class FalkorUnavailable(Exception):
    """Raised by FalkorClient.engine when FalkorDB is not reachable."""

# Relationship types an attacker can traverse. Memory edges (TRIGGERED, TARGETED…) are excluded.
ATTACK_REL_TYPES = ["MEMBER_OF", "HAS_POLICY", "CAN_ASSUME", "ATTACHED_TO", "CAN_ACCESS"]
ATTACK_RELS = "|".join(ATTACK_REL_TYPES)
INFRA_LABELS = ["User", "Role", "Policy", "Compute", "Resource"]
NODE_PROJ = "{{id: coalesce({v}.id, {v}.name), label: labels({v})[0], properties: properties({v})}}"


class QueryResult:
    def __init__(self, result_set: List[List[Any]], header: List[str], runtime_ms: float):
        self.result_set = result_set
        self.header = header
        self.runtime = runtime_ms  # runtime in milliseconds


def _is_crown_jewel(node: Optional[Dict[str, Any]]) -> bool:
    if not node:
        return False
    p = node.get("properties", {})
    return bool(p.get("is_crown_jewel")) or p.get("sensitivity") == "CrownJewel"


def score_blast(reachable: List[Dict[str, Any]]) -> Tuple[int, str]:
    """Risk score formula shared by both engines."""
    cj = sum(1 for n in reachable if _is_crown_jewel(n))
    r = len(reachable)
    if cj > 0:
        return min(99, 85 + cj * 5 + min(r, 9)), "CRITICAL"
    if r >= 10:
        return min(75, 40 + r * 2), "HIGH"
    if r >= 3:
        return min(40, 20 + r * 3), "MEDIUM"
    return max(5, r * 4), "LOW"


def _blast_payload(start: Dict[str, Any], reachable: List[Dict[str, Any]], elapsed_ms: float) -> Dict[str, Any]:
    by_type: Dict[str, int] = {}
    for n in reachable:
        by_type[n.get("label", "Node")] = by_type.get(n.get("label", "Node"), 0) + 1
    cjs = [n for n in reachable if _is_crown_jewel(n)]
    score, level = score_blast(reachable)
    return {
        "node_id": start["id"],
        "node_name": start["properties"].get("name", start["id"]),
        "label": start.get("label", "Node"),
        "reachable_nodes_count": len(reachable),
        "crown_jewels_count": len(cjs),
        "reachable_node_ids": [start["id"]] + [n["id"] for n in reachable],
        "crown_jewel_names": [c["properties"].get("name") for c in cjs],
        "by_type": by_type,
        "risk_score": score,
        "risk_level": level,
        "execution_time_ms": round(elapsed_ms, 3),
    }


def _empty_blast(identifier: str) -> Dict[str, Any]:
    return {
        "node_id": identifier, "node_name": identifier, "reachable_nodes_count": 0,
        "crown_jewels_count": 0, "reachable_node_ids": [], "crown_jewel_names": [],
        "by_type": {}, "risk_score": 0, "risk_level": "LOW", "execution_time_ms": 0.01,
    }


class _EngineMixin:
    """Algorithms written once on top of the primitive engine API."""

    def audit_all_identities(self) -> Dict[str, Any]:
        start_t = time.perf_counter()
        results = []
        for u in self.list_nodes("User"):
            name = u["properties"].get("name")
            blast = self.compute_blast_radius(name)
            path = self.find_shortest_path(name)
            names = [n["properties"].get("name") for n in path] if path else []
            results.append({
                "id": u["id"], "name": name,
                "department": u["properties"].get("department", "Engineering"),
                "risk_score": blast["risk_score"], "risk_level": blast["risk_level"],
                "blast_radius_resources": blast["reachable_nodes_count"],
                "crown_jewels_count": blast["crown_jewels_count"],
                "target_jewel": names[-1] if names else "None",
                "hops": len(names) - 1 if names else 0,
                "path_nodes": names,
            })
        results.sort(key=lambda x: (x["risk_score"], x["name"]), reverse=True)
        count = lambda lvl: sum(1 for r in results if r["risk_level"] == lvl)
        return {
            "total_assessed": len(results),
            "critical_count": count("CRITICAL"), "high_count": count("HIGH"),
            "medium_count": count("MEDIUM"), "low_count": count("LOW"),
            "identities": results,
            "execution_time_ms": round((time.perf_counter() - start_t) * 1000.0, 3),
            "engine": self.ENGINE_NAME,
        }

    def exposed_identities(self) -> List[str]:
        """Names of every User with at least one path to a Crown Jewel (ground truth)."""
        return sorted(u["properties"]["name"] for u in self.list_nodes("User")
                      if self.find_shortest_path(u["properties"]["name"]))

    def simulate_what_if(self, source_name: str, target_name: str) -> Dict[str, Any]:
        start_t = time.perf_counter()
        self._add_hypothetical_edge(source_name, target_name)
        try:
            new_path = self.find_shortest_path(source_name)
        finally:
            self._remove_hypothetical_edges()
        names = [n["properties"].get("name") for n in new_path] if new_path else []
        return {
            "source_name": source_name, "target_name": target_name,
            "opens_attack_path": new_path is not None,
            "target_compromised": names[-1] if names else None,
            "new_path_hops": len(names) - 1 if names else 0,
            "path_chain": names,
            "verdict": "DANGER: Creates direct multi-hop exploit path to Crown Jewels!" if new_path
                       else "SAFE: Zero transitive paths opened to Crown Jewels.",
            "execution_time_ms": round((time.perf_counter() - start_t) * 1000.0, 3),
            "engine": self.ENGINE_NAME,
        }


# ═══════════════════════════════════════════════════════════════════════════════
#  LIVE ENGINE — FalkorDB via Cypher
# ═══════════════════════════════════════════════════════════════════════════════
class LiveGraph(_EngineMixin):
    ENGINE_NAME = "FalkorDB (live Cypher)"

    def __init__(self, graph):
        self.graph = graph
        self.last_query_ms = 0.0

    def q(self, cypher: str, params: Optional[Dict[str, Any]] = None) -> List[List[Any]]:
        res = self.graph.query(cypher, params or {})
        self.last_query_ms = float(getattr(res, "run_time_ms", 0.0) or 0.0)
        return res.result_set

    @staticmethod
    def _node(d) -> Dict[str, Any]:
        d = dict(d)
        d["properties"] = dict(d.get("properties") or {})
        return d

    # ── primitives ──
    def resolve_node_id(self, identifier: str) -> str:
        n = self.get_node(identifier)
        return n["id"] if n else identifier

    def get_node(self, identifier: str) -> Optional[Dict[str, Any]]:
        rows = self.q(
            f"MATCH (n) WHERE (n.name = $x OR n.id = $x) AND NOT n:Incident AND NOT n:AgentMemory "
            f"RETURN {NODE_PROJ.format(v='n')} LIMIT 1", {"x": identifier})
        return self._node(rows[0][0]) if rows else None

    def list_nodes(self, label: Optional[str] = None) -> List[Dict[str, Any]]:
        if label:
            if label not in INFRA_LABELS:
                return []
            rows = self.q(f"MATCH (n:{label}) RETURN {NODE_PROJ.format(v='n')} ORDER BY n.name")
        else:
            rows = self.q(f"MATCH (n) WHERE NOT n:Incident AND NOT n:AgentMemory AND NOT n:Remediation "
                          f"RETURN {NODE_PROJ.format(v='n')}")
        return [self._node(r[0]) for r in rows]

    def neighbors(self, identifier: str) -> List[Dict[str, Any]]:
        rows = self.q(
            f"MATCH (n)-[r:{ATTACK_RELS}]->(m) WHERE n.name = $x OR n.id = $x "
            f"RETURN {NODE_PROJ.format(v='m')}, type(r), properties(r)", {"x": identifier})
        return [{"node": self._node(r[0]), "relation": r[1], "edge_props": dict(r[2] or {})} for r in rows]

    def has_crown_jewel_neighbor(self, identifier: str) -> bool:
        rows = self.q(
            f"MATCH (n)-[:{ATTACK_RELS}]->(m) WHERE (n.name = $x OR n.id = $x) AND m.is_crown_jewel = true "
            f"RETURN count(m)", {"x": identifier})
        return bool(rows and rows[0][0] > 0)

    def attack_edges(self) -> List[Dict[str, Any]]:
        rows = self.q(f"MATCH (a)-[r:{ATTACK_RELS}]->(b) "
                      f"RETURN a.name, labels(a)[0], b.name, labels(b)[0], type(r), coalesce(b.is_crown_jewel, false)")
        return [{"src": r[0], "src_label": r[1], "dst": r[2], "dst_label": r[3], "type": r[4],
                 "dst_is_crown_jewel": bool(r[5])} for r in rows]

    def edge_count(self) -> int:
        rows = self.q(f"MATCH ()-[r:{ATTACK_RELS}]->() RETURN count(r)")
        return rows[0][0] if rows else 0

    def find_shortest_path(self, start_identifier: str, target_sensitivity: str = "CrownJewel",
                           max_hops: int = 8) -> Optional[List[Dict[str, Any]]]:
        rows = self.q(
            f"MATCH (s) WHERE (s.name = $x OR s.id = $x) AND NOT s:Incident "
            f"MATCH (t:Resource) WHERE t.is_crown_jewel = true OR t.sensitivity = $sens "
            f"WITH s, t, shortestPath((s)-[:{ATTACK_RELS}*1..{int(max_hops)}]->(t)) AS p "
            f"WHERE p IS NOT NULL "
            f"RETURN [n IN nodes(p) | {NODE_PROJ.format(v='n')}] ORDER BY length(p) LIMIT 1",
            {"x": start_identifier, "sens": target_sensitivity})
        return [self._node(n) for n in rows[0][0]] if rows else None

    def compute_blast_radius(self, start_identifier: str, max_hops: int = 4) -> Dict[str, Any]:
        t0 = time.perf_counter()
        start = self.get_node(start_identifier)
        if not start:
            return _empty_blast(start_identifier)
        rows = self.q(
            f"MATCH (s)-[:{ATTACK_RELS}*1..{int(max_hops)}]->(m) WHERE (s.name = $x OR s.id = $x) "
            f"RETURN DISTINCT {NODE_PROJ.format(v='m')}", {"x": start_identifier})
        reachable = [self._node(r[0]) for r in rows if dict(r[0])["id"] != start["id"]]
        return _blast_payload(start, reachable, (time.perf_counter() - t0) * 1000.0)

    def _add_hypothetical_edge(self, src: str, dst: str):
        self.q("MATCH (a), (b) WHERE (a.name = $s OR a.id = $s) AND (b.name = $d OR b.id = $d) "
               "CREATE (a)-[:CAN_ASSUME {hypothetical: true}]->(b)", {"s": src, "d": dst})

    def _remove_hypothetical_edges(self):
        self.q("MATCH ()-[r {hypothetical: true}]->() DELETE r")

    def remove_edge(self, src: str, dst: str) -> List[Dict[str, Any]]:
        rows = self.q(f"MATCH (a)-[r:{ATTACK_RELS}]->(b) WHERE a.name = $s AND b.name = $d "
                      f"RETURN type(r), properties(r)", {"s": src, "d": dst})
        removed = [{"src": src, "dst": dst, "type": r[0], "properties": dict(r[1] or {})} for r in rows]
        self.q(f"MATCH (a)-[r:{ATTACK_RELS}]->(b) WHERE a.name = $s AND b.name = $d DELETE r", {"s": src, "d": dst})
        return removed

    def restore_edge(self, src: str, dst: str, rel_type: str, properties: Optional[Dict[str, Any]] = None):
        if rel_type not in ATTACK_REL_TYPES:
            raise ValueError(f"Refusing to create unknown relationship type {rel_type}")
        self.q(f"MATCH (a), (b) WHERE a.name = $s AND b.name = $d CREATE (a)-[r:{rel_type}]->(b) SET r = $p",
               {"s": src, "d": dst, "p": properties or {}})

    # ── cognitive memory (stored as graph nodes) ──
    def store_incident(self, incident: Dict[str, Any]) -> str:
        inc_id = f"inc_{int(time.time() * 1000)}"
        props = {
            "id": inc_id, "entrypoint": incident.get("entrypoint"), "target": incident.get("target"),
            "hops": incident.get("hops", 0), "path_chain": incident.get("path_chain", []),
            "choke_source": incident.get("choke_source"), "choke_target": incident.get("choke_target"),
            "status": incident.get("status", "active"), "severity": incident.get("severity", "CRITICAL"),
            "timestamp": time.time(),
        }
        self.q("CREATE (i:Incident) SET i = $p", {"p": props})
        # Link the memory to the real infrastructure it describes
        self.q("MATCH (i:Incident {id: $id}), (u:User {name: $ep}) CREATE (u)-[:TRIGGERED]->(i)",
               {"id": inc_id, "ep": props["entrypoint"]})
        self.q("MATCH (i:Incident {id: $id}), (t:Resource {name: $t}) CREATE (i)-[:TARGETED]->(t)",
               {"id": inc_id, "t": props["target"]})
        return inc_id

    def recall_incidents(self, entrypoint: Optional[str] = None, limit: int = 5) -> List[Dict[str, Any]]:
        rows = self.q("MATCH (i:Incident) WHERE $ep IS NULL OR i.entrypoint = $ep "
                      "RETURN properties(i) ORDER BY i.timestamp DESC LIMIT $lim",
                      {"ep": entrypoint, "lim": int(limit)})
        out = []
        for r in rows:
            p = dict(r[0])
            out.append({"id": p.get("id"), "label": "Incident", "properties": p})
        return out

    def update_incident(self, inc_id: str, fields: Dict[str, Any]):
        self.q("MATCH (i:Incident {id: $id}) SET i += $f", {"id": inc_id, "f": fields})

    def store_remediation(self, rem: Dict[str, Any]) -> str:
        rem_id = f"rem_{int(time.time() * 1000)}"
        p = dict(rem, id=rem_id, timestamp=time.time())
        p["edge_properties"] = json.dumps(p.get("edge_properties", {}))
        self.q("CREATE (r:Remediation) SET r = $p", {"p": p})
        if rem.get("incident_id"):
            self.q("MATCH (r:Remediation {id: $rid}), (i:Incident {id: $iid}) CREATE (i)-[:REMEDIATED_BY]->(r)",
                   {"rid": rem_id, "iid": rem["incident_id"]})
        return rem_id

    def recall_remediations(self, src: Optional[str] = None, dst: Optional[str] = None) -> List[Dict[str, Any]]:
        rows = self.q("MATCH (r:Remediation) WHERE ($s IS NULL OR r.src = $s) AND ($d IS NULL OR r.dst = $d) "
                      "RETURN properties(r) ORDER BY r.timestamp DESC", {"s": src, "d": dst})
        out = []
        for row in rows:
            p = dict(row[0])
            try:
                p["edge_properties"] = json.loads(p.get("edge_properties") or "{}")
            except ValueError:
                p["edge_properties"] = {}
            out.append(p)
        return out

    def store_agent_memory(self, agent_id: str, key: str, value: Any) -> None:
        self.q("MERGE (m:AgentMemory {agent_id: $a, key: $k}) SET m.value = $v, m.timestamp = $t",
               {"a": agent_id, "k": key, "v": json.dumps(value), "t": time.time()})

    def recall_agent_memory(self, agent_id: str) -> Dict[str, Any]:
        rows = self.q("MATCH (m:AgentMemory {agent_id: $a}) RETURN m.key, m.value", {"a": agent_id})
        out = {}
        for k, v in rows:
            try:
                out[k] = json.loads(v)
            except (TypeError, ValueError):
                out[k] = v
        return out

    def memory_stats(self) -> Dict[str, int]:
        rows = self.q("MATCH (n) WHERE n:Incident OR n:AgentMemory OR n:Remediation "
                      "RETURN labels(n)[0], count(n)")
        return {r[0]: r[1] for r in rows}


# ═══════════════════════════════════════════════════════════════════════════════
class FalkorClient:
    def __init__(self):
        self.driver = None
        self.graph = None
        self.live: Optional[LiveGraph] = None
        self._connect()

    def _connect(self):
        try:
            from falkordb import FalkorDB
            args = {"host": settings.FALKORDB_HOST, "port": settings.FALKORDB_PORT}
            if settings.FALKORDB_USERNAME:
                args["username"] = settings.FALKORDB_USERNAME
            if settings.FALKORDB_PASSWORD:
                args["password"] = settings.FALKORDB_PASSWORD
            self.driver = FalkorDB(**args)
            self.graph = self.driver.select_graph(settings.GRAPH_NAME)
            self.graph.query("RETURN 1")
            self.live = LiveGraph(self.graph)
            logger.info(f"Connected to FalkorDB at {settings.FALKORDB_HOST}:{settings.FALKORDB_PORT} — LIVE mode.")
        except Exception as e:
            logger.error(f"Could not connect to FalkorDB ({e}). Service will return HTTP 503 until FalkorDB is reachable.")
            self.live = None

    @property
    def engine(self) -> LiveGraph:
        """The active graph engine. Raises FalkorUnavailable when FalkorDB is down."""
        if self.live is None:
            raise FalkorUnavailable("FalkorDB is not connected")
        return self.live

    @property
    def is_live(self) -> bool:
        return self.live is not None

    @property
    def mode(self) -> str:
        return "live" if self.live is not None else "down"

    def query(self, cypher: str, params: Optional[Dict[str, Any]] = None) -> QueryResult:
        """Raw Cypher. Raises FalkorUnavailable when not connected."""
        if self.live is None:
            raise FalkorUnavailable("FalkorDB is not connected")
        t0 = time.perf_counter()
        res = self.graph.query(cypher, params or {})
        runtime = float(getattr(res, "run_time_ms", 0.0) or (time.perf_counter() - t0) * 1000.0)
        return QueryResult(result_set=res.result_set, header=getattr(res, "header", []), runtime_ms=runtime)

    # Back-compat delegations
    def compute_blast_radius(self, node_identifier: str, max_hops: int = 4):
        return self.engine.compute_blast_radius(node_identifier, max_hops)

    def simulate_what_if(self, source_name: str, target_name: str):
        return self.engine.simulate_what_if(source_name, target_name)

    def audit_all_identities(self):
        return self.engine.audit_all_identities()

    def store_incident(self, incident):
        return self.engine.store_incident(incident)

    def recall_incidents(self, entrypoint=None, limit: int = 5):
        return self.engine.recall_incidents(entrypoint, limit)

    def store_agent_memory(self, agent_id, key, value):
        self.engine.store_agent_memory(agent_id, key, value)

    def recall_agent_memory(self, agent_id):
        return self.engine.recall_agent_memory(agent_id)

    def health_check(self) -> Dict[str, Any]:
        t0 = time.perf_counter()
        if self.live is None:
            return {"status": "down", "mode": "down", "engine": "none",
                    "graph_name": settings.GRAPH_NAME,
                    "latency_ms": round((time.perf_counter() - t0) * 1000.0, 3)}
        info = {"status": "online", "mode": "live",
                "engine": self.live.ENGINE_NAME, "graph_name": settings.GRAPH_NAME}
        try:
            info.update({"nodes": len(self.live.list_nodes()),
                         "edges": self.live.edge_count(),
                         "memory": self.live.memory_stats()})
        except Exception as e:
            info.update({"status": "degraded", "error": str(e)})
        info["latency_ms"] = round((time.perf_counter() - t0) * 1000.0, 3)
        return info


falkor_client = FalkorClient()
