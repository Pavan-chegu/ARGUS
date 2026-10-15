"""Traversal tests — run against whichever engine is active (live FalkorDB when reachable)."""
import pytest
from backend.db.falkor import falkor_client
from backend.db.seed_data import seed_database
from backend.agents.red_team import red_team_agent
from backend.agents.blue_team import blue_team_agent


@pytest.fixture(autouse=True)
def setup_seed_graph():
    seed_database(force=True)


def names(path):
    return [n["properties"]["name"] for n in path] if path else []


def test_database_seed_contains_nodes():
    assert len(falkor_client.engine.list_nodes()) >= 150
    assert falkor_client.engine.edge_count() >= 100


@pytest.mark.parametrize("entry,target,hops", [
    ("DevIntern", "ProdCustomerVault", 4),
    ("Contractor", "ProdKMSKey", 3),
    ("SupportUser", "CrownJewelDB", 4),
])
def test_planted_paths(entry, target, hops):
    p = names(falkor_client.engine.find_shortest_path(entry))
    assert p[0] == entry and p[-1] == target and len(p) - 1 == hops


def test_seed_is_deterministic():
    first = falkor_client.engine.exposed_identities()
    seed_database(force=True)
    assert falkor_client.engine.exposed_identities() == first


def test_agent_matches_ground_truth_for_every_identity():
    g = falkor_client.engine
    for u in g.list_nodes("User"):
        name = u["properties"]["name"]
        res = red_team_agent.execute_attack_simulation(name, record_incident=False)
        assert res["ground_truth"]["agrees"], f"agent disagreed with shortestPath for {name}"


def test_fix_loop_cuts_and_verifies_then_undo_restores():
    attack = red_team_agent.execute_attack_simulation("DevIntern")
    plan = blue_team_agent.analyze_and_remediate(attack)
    cp = plan["choke_point"]
    applied = blue_team_agent.apply_remediation_cypher(cp["source_name"], cp["target_name"], "DevIntern",
                                                       attack["incident_id"])
    assert applied["verification"]["verified"] is True
    assert "DevIntern" not in applied["verification"]["exposed_after"]
    undo = blue_team_agent.undo_remediation(cp["source_name"], cp["target_name"])
    assert undo["status"] == "restored"
    assert falkor_client.engine.find_shortest_path("DevIntern") is not None


def test_incident_memory_written_and_recalled():
    before = len(falkor_client.engine.recall_incidents("Contractor", limit=100))
    red_team_agent.execute_attack_simulation("Contractor")
    after = len(falkor_client.engine.recall_incidents("Contractor", limit=100))
    assert after == before + 1
