"""
Cross-agent remediation memory + decision provenance, against live FalkorDB.

Run with an isolated graph:  GRAPH_NAME=ArgusTest_Memory python -m pytest -q tests/test_memory_trace.py
"""
import os
os.environ.setdefault("GRAPH_NAME", "ArgusTest_Memory")

import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app
from backend.db.seed_data import seed_database
from backend.db.falkor import falkor_client
from backend.agents.red_team import red_team_agent
from backend.agents.blue_team import blue_team_agent

client = TestClient(app)
ENTRY = "DevIntern"

pytestmark = pytest.mark.skipif(not falkor_client.is_live, reason="FalkorDB not reachable")


@pytest.fixture(autouse=True)
def fresh_graph():
    g = falkor_client.engine
    # Memory nodes survive reseeding by design; wipe them only on a non-production graph.
    if settings.GRAPH_NAME != "ArgusCloud":
        g.q("MATCH (n) WHERE n:Incident OR n:Remediation OR n:Decision OR n:AgentMemory DETACH DELETE n")
    seed_database(force=True)
    yield


def _attack_and_remediate():
    r1 = red_team_agent.execute_attack_simulation(ENTRY)
    assert r1["status"] == "success"
    plan = blue_team_agent.analyze_and_remediate(r1)
    cp = plan["choke_point"]
    applied = blue_team_agent.apply_remediation_cypher(cp["source_name"], cp["target_name"], ENTRY, r1["incident_id"])
    assert applied["edges_removed"] >= 1
    return r1, cp


def test_remediation_creates_severed_edges():
    _, cp = _attack_and_remediate()
    g = falkor_client.engine
    rows = g.q("MATCH (s)<-[:SEVERED_FROM]-(r:Remediation)-[:SEVERED]->(d) RETURN s.name, d.name, r.status")
    assert [cp["source_name"], cp["target_name"], "applied"] in rows
    # Remediation stays out of the IAM topology listing
    assert all(n["label"] != "Remediation" for n in g.list_nodes())


def test_second_run_verifies_cut_still_absent():
    r1, cp = _attack_and_remediate()
    r2 = red_team_agent.execute_attack_simulation(ENTRY)

    remembered = {(e["src"], e["dst"]) for e in r2["remediations_remembered"]}
    assert (cp["source_name"], cp["target_name"]) in remembered
    recall = r2["steps"][0]
    assert recall["phase"] == "Memory Recall"
    assert "1 severed edge(s) remembered, verified still absent" in recall["thought"]
    assert all(v["still_absent"] for v in recall["remediations_verified"])
    assert r2["regressions"] == []

    # Different outcome: the jewel is not reached through the severed edge
    names = [n["name"] for n in r2["path_nodes"]]
    assert (cp["source_name"], cp["target_name"]) not in set(zip(names, names[1:]))
    assert names != [n["name"] for n in r1["path_nodes"]]
    assert r2["ground_truth"]["agrees"]

    # The recall Decision records the verification and points at the Remediation
    first = falkor_client.engine.get_decision_trace(run_id=r2["run_id"])["decisions"][0]
    assert "verified still absent" in first["reason"]
    assert any(m["label"] == "Remediation" for m in first["informed_by"])


def test_reintroduced_edge_is_reported_as_regression():
    _, cp = _attack_and_remediate()
    g = falkor_client.engine
    rem_id = g.active_remediated_edges()[0]["id"]
    rel = g.q("MATCH (r:Remediation {id: $id}) RETURN r.type", {"id": rem_id})[0][0]
    # Drift: someone re-creates the edge by hand, bypassing undo
    g.q(f"MATCH (a {{name: $s}}), (b {{name: $d}}) CREATE (a)-[:{rel}]->(b)",
        {"s": cp["source_name"], "d": cp["target_name"]})

    r3 = red_team_agent.execute_attack_simulation(ENTRY)
    assert "exist again" in r3["steps"][0]["thought"]
    assert r3["regressions"] == [{"src": cp["source_name"], "dst": cp["target_name"], "remediation_id": rem_id}]
    reg_steps = [s for s in r3["steps"] if s["phase"] == "Regression Detected"]
    assert len(reg_steps) == 1
    assert reg_steps[0]["thought"].startswith(
        f"Edge {cp['source_name']}→{cp['target_name']} was severed by remediation {rem_id} but exists again.")
    assert r3["status"] == "success"
    assert g.q("MATCH (i:Incident {id: $id}) RETURN i.regression", {"id": r3["incident_id"]}) == [[True]]

    reg_dec = [d for d in g.get_decision_trace(run_id=r3["run_id"])["decisions"] if d["action"] == "regression"]
    assert len(reg_dec) == 1
    assert [m["id"] for m in reg_dec[0]["informed_by"] if m["label"] == "Remediation"] == [rem_id]


def test_undo_marks_remediation_reverted():
    _, cp = _attack_and_remediate()
    blue_team_agent.undo_remediation(cp["source_name"], cp["target_name"])
    g = falkor_client.engine
    assert g.q("MATCH (r:Remediation) RETURN r.status") == [["reverted"]]
    assert g.active_remediated_edges() == []
    r3 = red_team_agent.execute_attack_simulation(ENTRY)
    assert r3["remediations_remembered"] == []
    assert r3["status"] == "success"


def test_decisions_chained_and_linked_to_incident():
    r1 = red_team_agent.execute_attack_simulation(ENTRY)
    g = falkor_client.engine
    run_id, inc = r1["run_id"], r1["incident_id"]
    n_dec = g.q("MATCH (d:Decision) WHERE d.run_id = $r RETURN count(d)", {"r": run_id})[0][0]
    assert n_dec == len(r1["steps"])
    n_next = g.q("MATCH (a:Decision)-[:NEXT]->(b:Decision) WHERE a.run_id = $r AND b.run_id = $r "
                 "AND b.step = a.step + 1 RETURN count(*)", {"r": run_id})[0][0]
    assert n_next == n_dec - 1
    n_linked = g.q("MATCH (:Incident {id: $i})-[:HAS_DECISION]->(d:Decision) RETURN count(d)", {"i": inc})[0][0]
    assert n_linked == n_dec

    trace = g.get_decision_trace(incident_id=inc)
    assert trace["run_id"] == run_id and trace["incident_id"] == inc
    steps = [d["step"] for d in trace["decisions"]]
    assert steps == sorted(steps)
    last = trace["decisions"][-1]
    assert last["action"] == "objective_reached" and last["chosen"] == r1["target_compromised"]
    assert any(d["considered"] for d in trace["decisions"])
    assert all(d["chosen"] not in {c["name"] for c in d["considered"]} for d in trace["decisions"])
    assert "MATCH (d:Decision)" in trace["cypher"]
    assert "Decision" in g.memory_stats()
    assert all(n["label"] != "Decision" for n in g.list_nodes())


def test_second_run_decisions_informed_by_memory():
    r1, _ = _attack_and_remediate()
    r2 = red_team_agent.execute_attack_simulation(ENTRY)
    trace = falkor_client.engine.get_decision_trace(run_id=r2["run_id"])
    first = trace["decisions"][0]
    labels = {m["label"] for m in first["informed_by"]}
    ids = {m["id"] for m in first["informed_by"]}
    assert {"Incident", "Remediation"} <= labels
    assert r1["incident_id"] in ids


def test_trace_endpoints():
    r1 = red_team_agent.execute_attack_simulation(ENTRY)
    by_run = client.get(f"/api/trace/run/{r1['run_id']}")
    assert by_run.status_code == 200 and by_run.json()["decisions"]
    by_inc = client.get(f"/api/trace/incident/{r1['incident_id']}")
    assert by_inc.status_code == 200 and by_inc.json()["run_id"] == r1["run_id"]
    latest = client.get("/api/trace/latest", params={"entrypoint": ENTRY})
    assert latest.status_code == 200 and latest.json()["incident_id"] == r1["incident_id"]
    assert client.get("/api/trace/run/run_does_not_exist").status_code == 404
    empty = client.get("/api/trace/latest", params={"entrypoint": "QAEngineer"})
    assert empty.status_code == 200 and empty.json()["decisions"] == [] and empty.json()["incident_id"] is None
