from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from backend.db.falkor import falkor_client
from backend.db.seed_data import seed_database

router = APIRouter(prefix="/api/graph", tags=["Graph & Topology"])

class CypherQueryRequest(BaseModel):
    query: str
    params: Optional[Dict[str, Any]] = None

@router.get("/overview")
def get_graph_overview() -> Dict[str, Any]:
    g = falkor_client.engine
    users = [n["properties"]["name"] for n in g.list_nodes("User")]
    cjs = [n["properties"]["name"] for n in g.list_nodes("Resource") if n["properties"].get("is_crown_jewel")]
    return {
        "health": falkor_client.health_check(),
        "total_nodes": len(g.list_nodes()),
        "total_edges": g.edge_count(),
        "users": users[:10],
        "crown_jewels": cjs,
        "engine": g.ENGINE_NAME,
    }

@router.get("/topology")
def get_graph_topology() -> Dict[str, Any]:
    """Nodes and edges for the graph canvas, read from the active engine."""
    g = falkor_client.engine
    nodes = g.list_nodes()
    name_to_id = {n["properties"].get("name"): n["id"] for n in nodes}
    formatted_nodes = [{
        "id": n["id"], "name": n["properties"].get("name", n["id"]), "label": n.get("label", "Node"),
        "sensitivity": n["properties"].get("sensitivity", "Standard"),
        "is_crown_jewel": bool(n["properties"].get("is_crown_jewel", False)),
    } for n in nodes]
    links = [{"id": f"edge_{i}", "source": name_to_id.get(e["src"], e["src"]),
              "target": name_to_id.get(e["dst"], e["dst"]), "type": e["type"], "properties": {}}
             for i, e in enumerate(g.attack_edges())]
    return {"nodes": formatted_nodes, "links": links, "count_nodes": len(formatted_nodes),
            "count_links": len(links), "engine": g.ENGINE_NAME}

@router.post("/reseed")
def reseed_graph() -> Dict[str, Any]:
    """Resets infrastructure to the known demo state. Agent memory is kept."""
    return seed_database(force=True)

@router.post("/cypher")
def run_cypher_playground(req: CypherQueryRequest) -> Dict[str, Any]:
    try:
        res = falkor_client.query(req.query, req.params)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "header": res.header,
        "result_set": res.result_set,
        "execution_time_ms": round(res.runtime, 3)
    }

@router.get("/memory-stats")
def get_memory_stats() -> Dict[str, Any]:
    """Returns counts of cognitive memory nodes (Incident, Remediation, AgentMemory) in FalkorDB."""
    g = falkor_client.engine
    stats = g.memory_stats() if hasattr(g, "memory_stats") else {}
    return {
        "engine": g.ENGINE_NAME,
        "memory_nodes": stats,
        "total_memory_items": sum(stats.values()),
    }

@router.get("/risk-scorecard")
def get_risk_scorecard() -> Dict[str, Any]:
    """Identity risk ranking computed live from the graph (no hardcoded values)."""
    audit = falkor_client.engine.audit_all_identities()
    top = [{
        "id": i["id"], "name": i["name"], "department": i["department"],
        "risk_score": i["risk_score"], "risk_level": i["risk_level"],
        "blast_radius_resources": i["blast_radius_resources"],
        "max_escalation_hops": i["hops"], "target_jewel": i["target_jewel"],
        "vector_rag_detectable": i["hops"] <= 1,
        "falkordb_detectable": True,
    } for i in audit["identities"][:8]]
    return {"identities": top, "total_assessed": audit["total_assessed"],
            "critical_vulnerabilities": audit["critical_count"], "engine": audit["engine"]}

@router.post("/benchmark/compare")
def compare_vector_rag_vs_falkordb(entrypoint: str = "DevIntern") -> Dict[str, Any]:
    """Graph side is MEASURED on the active engine. Vector side is a labelled simulation."""
    import time as _t
    g = falkor_client.engine
    runs = []
    path = None
    for _ in range(20):
        t0 = _t.perf_counter()
        path = g.find_shortest_path(entrypoint)
        runs.append(g.last_query_ms or (_t.perf_counter() - t0) * 1000.0)
    runs.sort()
    names = [n["properties"].get("name") for n in path] if path else []
    median = round(runs[len(runs) // 2], 3)
    return {
        "entrypoint": entrypoint,
        "vector_rag": {
            "name": "Vector RAG over policy chunks (SIMULATED baseline)",
            "query_type": "Cosine similarity over per-policy text chunks",
            "result": f"No single chunk links '{entrypoint}' to a Crown Jewel; multi-hop chain not recoverable from top-k chunks.",
            "hops_discovered": 1, "hallucination": "Answers SAFE on multi-hop exposure",
            "traversal_capable": False, "latency_ms": None, "accuracy": "not measured", "simulated": True,
        },
        "falkordb": {
            "name": g.ENGINE_NAME, "query_type": "Cypher shortestPath (median of 20 runs)",
            "result": (f"{len(names) - 1}-hop path: " + " -> ".join(names)) if names else "No path",
            "hops_discovered": max(0, len(names) - 1), "hallucination": "None — every hop is an edge",
            "traversal_capable": True, "latency_ms": median, "accuracy": "exact (deterministic traversal)",
        },
        "speedup_factor": None,
        "conclusion": "The graph side is measured live; the vector side is a labelled simulation.",
    }

@router.get("/blast-radius")
def get_node_blast_radius(node_id: str, max_hops: int = 4) -> Dict[str, Any]:
    """Computes dynamic multi-hop blast radius reachability for any clicked node."""
    return falkor_client.compute_blast_radius(node_id, max_hops)

@router.get("/audit-all")
def get_global_org_audit() -> Dict[str, Any]:
    """Executes organization-wide threat audit across all enterprise identities."""
    return falkor_client.audit_all_identities()

class WhatIfRequest(BaseModel):
    source_name: str
    target_name: str

@router.post("/what-if")
def simulate_what_if_permission(req: WhatIfRequest) -> Dict[str, Any]:
    """Tests hypothetical privilege escalation grants in FalkorDB without changing live state."""
    return falkor_client.simulate_what_if(req.source_name, req.target_name)


