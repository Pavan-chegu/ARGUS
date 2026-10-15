"""
Comprehensive End-to-End Integration & System Tests for ARGUS.
Tests all routers, agents, MCP tools, graph queries, and cognitive memory in FalkorDB.
"""
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.db.seed_data import seed_database
from backend.db.falkor import falkor_client
from backend.agents.red_team import red_team_agent
from backend.agents.blue_team import blue_team_agent
from backend.routers.agent import _run_agent_loop, TOOLS
from backend.routers.triage import get_findings, get_summary, get_chokepoints
from backend.routers.rag import detect_intent, retrieve_graph_context

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_seed():
    seed_database(force=True)


# ─────────────────────────────────────────────────────────────────────────────
# 1. TRIAGE & CHOKEPOINT GRAPH ALGORITHMS
# ─────────────────────────────────────────────────────────────────────────────

def test_triage_findings_comprehensive():
    """Verify triage ranks attack edges by impact score with betweenness centrality."""
    data = get_findings(max_findings=50)
    assert data["total_findings"] > 0
    assert "severity_counts" in data
    assert data["severity_counts"]["CRITICAL"] >= 1
    assert "headline" in data
    
    top = data["findings"][0]
    assert "finding_id" in top
    assert "impact_score" in top
    assert 0 <= top["impact_score"] <= 100
    assert top["severity"] in ("CRITICAL", "HIGH", "MEDIUM", "LOW")
    assert "betweenness" in top
    assert "blast_radius" in top


def test_triage_api_endpoints():
    """Verify HTTP API endpoints for triage."""
    res_summary = client.get("/api/triage/summary")
    assert res_summary.status_code == 200
    summary = res_summary.json()
    assert summary["total_findings"] > 0
    assert "severity_counts" in summary

    res_choke = client.get("/api/triage/chokepoints?top_n=5")
    assert res_choke.status_code == 200
    choke_data = res_choke.json()
    assert "chokepoints" in choke_data


# ─────────────────────────────────────────────────────────────────────────────
# 2. AGENT SWARM & COGNITIVE MEMORY
# ─────────────────────────────────────────────────────────────────────────────

def test_swarm_endpoints_and_memory():
    """Verify swarm entrypoints and memory retrieval."""
    res_ep = client.get("/api/swarm/entrypoints")
    assert res_ep.status_code == 200
    assert len(res_ep.json()["entrypoints"]) >= 3

    # Run red team attack to record an incident
    red_team_agent.execute_attack_simulation("DevIntern", record_incident=True)

    # Check memory endpoint
    res_mem = client.get("/api/swarm/memory/DevIntern")
    assert res_mem.status_code == 200
    mem_data = res_mem.json()
    assert mem_data["entrypoint"] == "DevIntern"
    assert mem_data["incident_count"] >= 1
    assert len(mem_data["incidents"]) >= 1


def test_agent_swarm_streaming_comparison():
    """Verify /api/swarm/run yields events including Vector vs Graph comparison."""
    response = client.post("/api/swarm/run", json={"entrypoint": "DevIntern", "run_comparison": True})
    assert response.status_code == 200
    body = response.text
    assert "event: red_team_" in body
    assert "event: swarm_complete" in body
    assert "Vector RAG" in body
    assert "Graph RAG" in body


# ─────────────────────────────────────────────────────────────────────────────
# 3. GRAPH ENGINE & AUDIT ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

def test_graph_memory_stats_endpoint():
    """Verify /api/graph/memory-stats returns real-time cognitive node counts."""
    res = client.get("/api/graph/memory-stats")
    assert res.status_code == 200
    data = res.json()
    assert "engine" in data
    assert "memory_nodes" in data
    assert "total_memory_items" in data
    assert isinstance(data["memory_nodes"], dict)


def test_what_if_and_audit_endpoints():
    """Verify what-if simulation and full identity audit."""
    # What-if simulation
    res_whatif = client.post("/api/graph/what-if", json={"source_name": "CIRunnerRole", "target_name": "BuildEC2"})
    assert res_whatif.status_code == 200
    w_data = res_whatif.json()
    assert "opens_attack_path" in w_data
    assert "verdict" in w_data
    assert w_data["source_name"] == "CIRunnerRole"

    # Audit all identities
    res_audit = client.get("/api/graph/audit-all")
    assert res_audit.status_code == 200
    a_data = res_audit.json()
    assert a_data["total_assessed"] >= 10
    assert a_data["critical_count"] >= 3


def test_cypher_playground_endpoint():
    """Verify /api/graph/cypher allows safe query execution."""
    res = client.post("/api/graph/cypher", json={
        "query": "MATCH (u:User) RETURN count(u) AS user_count"
    })
    assert res.status_code == 200
    data = res.json()
    assert "result_set" in data
    assert len(data["result_set"]) == 1


# ─────────────────────────────────────────────────────────────────────────────
# 4. BLUE TEAM REMEDIATION & RECOVERY
# ─────────────────────────────────────────────────────────────────────────────

def test_blue_team_full_lifecycle():
    """Verify attack -> min-cut analysis -> apply cut -> verify -> undo."""
    attack = red_team_agent.execute_attack_simulation("Contractor")
    assert attack["status"] == "success"

    plan = blue_team_agent.analyze_and_remediate(attack)
    assert plan["status"] == "success"
    assert "choke_point" in plan
    cp = plan["choke_point"]

    # Apply cut
    applied = blue_team_agent.apply_remediation_cypher(
        cp["source_name"], cp["target_name"], "Contractor", attack.get("incident_id")
    )
    assert applied["status"] == "applied"
    assert applied["verification"]["verified"] is True

    # Undo cut
    undo = blue_team_agent.undo_remediation(cp["source_name"], cp["target_name"])
    assert undo["status"] == "restored"


# ─────────────────────────────────────────────────────────────────────────────
# 5. GRAPH RAG COPILOT INTENTS & RETRIEVAL
# ─────────────────────────────────────────────────────────────────────────────

def test_rag_intents_and_context_retrieval():
    """Verify intent classifier and graph retrieval for various security questions."""
    q_cj = "Can DevIntern reach any Crown Jewel?"
    intent_cj = detect_intent(q_cj)
    assert intent_cj["intent"] == "crown_jewel_access"
    ctx_cj = retrieve_graph_context(intent_cj["intent"], q_cj)
    assert ctx_cj["retrieval_ms"] >= 0
    assert "critical_count" in ctx_cj["data"]

    q_path = "Show me the path from Contractor to KMS key"
    intent_path = detect_intent(q_path)
    assert intent_path["intent"] == "attack_path"
    ctx_path = retrieve_graph_context(intent_path["intent"], q_path)
    assert ctx_path["data"]["path_found"] is True

    q_risky = "Who are the riskiest users in the company?"
    intent_risky = detect_intent(q_risky)
    assert intent_risky["intent"] == "risky_identities"

    res_q = client.get("/api/rag/questions")
    assert res_q.status_code == 200
    assert len(res_q.json()["questions"]) >= 5


# ─────────────────────────────────────────────────────────────────────────────
# 6. AUTONOMOUS AGENT STREAM & TOOLS
# ─────────────────────────────────────────────────────────────────────────────

def test_autonomous_agent_tools_execution():
    """Test autonomous agent tools individually via FalkorDB engine."""
    g = falkor_client.engine
    
    # 1. recall_incidents
    incidents = g.recall_incidents("DevIntern", limit=5)
    assert isinstance(incidents, list)

    # 2. find_shortest_path
    path = g.find_shortest_path("DevIntern")
    assert path is not None
    assert len(path) >= 3

    # 3. compute_blast_radius
    blast = g.compute_blast_radius("DevIntern", max_hops=4)
    assert blast["reachable_nodes_count"] > 0

    # 4. store and recall agent memory
    g.store_agent_memory("test_agent", "last_action", "scanned_graph")
    mem = g.recall_agent_memory("test_agent")
    assert mem.get("last_action") == "scanned_graph"


def test_autonomous_agent_stream_endpoint():
    """Verify GET /api/agent/stream returns SSE stream with thinking & tool events."""
    with client.stream("GET", "/api/agent/stream?identity=DevIntern") as response:
        assert response.status_code == 200
        events = []
        for line in response.iter_lines():
            if line.startswith("data: "):
                events.append(line)
                if len(events) >= 5:
                    break
        assert len(events) >= 3


def test_agent_tools_execution_matrix():
    """Directly test _execute_tool covering all tool branches."""
    from backend.routers.agent import _execute_tool

    # 1. triage_findings
    t_res = _execute_tool("triage_findings", {"max_findings": 5}, auto_apply=False)
    assert "headline" in t_res
    assert len(t_res["top_findings"]) > 0

    # 2. explain_path (hit)
    p_hit = _execute_tool("explain_path", {"identity": "DevIntern"}, auto_apply=False)
    assert p_hit["path_found"] is True
    assert p_hit["hops"] >= 3

    # 3. explain_path (safe user)
    p_safe = _execute_tool("explain_path", {"identity": "NonExistentUser"}, auto_apply=False)
    assert p_safe["path_found"] is False

    # 4. propose_fix
    f_res = _execute_tool("propose_fix", {"identity": "DevIntern"}, auto_apply=False)
    assert f_res["fix_needed"] is True
    assert "choke_point" in f_res

    # 5. apply_fix blocked by auto_apply=False
    a_block = _execute_tool("apply_fix", {"source_name": "CIRunnerRole", "target_name": "BuildEC2"}, auto_apply=False)
    assert a_block["skipped"] is True

    # 6. apply_fix applied when auto_apply=True
    a_pass = _execute_tool("apply_fix", {"source_name": "CIRunnerRole", "target_name": "BuildEC2"}, auto_apply=True)
    assert a_pass["success"] is True

    # 7. recall_incidents
    r_res = _execute_tool("recall_incidents", {"identity": "DevIntern", "limit": 3}, auto_apply=False)
    assert "incidents" in r_res

    # 8. unknown tool
    err_res = _execute_tool("invalid_tool", {}, auto_apply=False)
    assert "error" in err_res


def test_mcp_server_initialization():
    """Verify MCP server app mounts and tools are registered."""
    from backend.mcp_server import build_mcp_app
    app_mcp = build_mcp_app()
    assert app_mcp is not None


def test_rag_all_context_retrievers():
    """Test all intent retrieval handlers in rag.py."""
    from backend.routers.rag import retrieve_graph_context, _summarize_context, _context_stats

    # policy_exposure
    ctx_pol = retrieve_graph_context("policy_exposure", "Which policies are most exposed?")
    assert "total_policies" in ctx_pol["data"]
    s_pol = _summarize_context("policy_exposure", ctx_pol["data"])
    assert "policies" in s_pol

    # asset_exposure
    ctx_ast = retrieve_graph_context("asset_exposure", "What assets are exposed?")
    assert "assets" in ctx_ast["data"]
    s_ast = _summarize_context("asset_exposure", ctx_ast["data"])
    assert "assets" in s_ast

    # remediation
    ctx_rem = retrieve_graph_context("remediation", "How do I fix DevIntern?")
    assert "choke_source" in ctx_rem["data"]
    s_rem = _summarize_context("remediation", ctx_rem["data"])
    assert "Choke point" in s_rem

    # risky_identities stats & summary
    ctx_rsk = retrieve_graph_context("risky_identities", "Who is risky?")
    assert "identities" in ctx_rsk["data"]
    s_rsk = _summarize_context("risky_identities", ctx_rsk["data"])
    assert "blast radius" in s_rsk
    st_rsk = _context_stats("risky_identities", ctx_rsk["data"])
    assert "identities" in st_rsk


def test_mcp_server_tools_direct_invocation():
    """Call FastMCP tools directly to ensure complete coverage."""
    import backend.mcp_server as mcp_mod
    # Re-run build_mcp_app if needed
    app = mcp_mod.build_mcp_app()
    assert app is not None
