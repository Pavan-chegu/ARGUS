"""
BlueTeamAgent — Cypher-native cut planning.

Run against a dedicated graph:  GRAPH_NAME=ArgusTest_Blue pytest tests/test_blue_team_cypher.py
Expected cuts were captured from the previous Python implementation (BFS + Edmonds-Karp over an
edge snapshot) on the same seeded graph, so these tests pin the Cypher planner to the same answer.
"""
import os

os.environ.setdefault("GRAPH_NAME", "ArgusTest_Blue")

import pytest  # noqa: E402
from backend.db.seed_data import seed_database  # noqa: E402
from backend.db.falkor import falkor_client  # noqa: E402
from backend.agents.blue_team import BlueTeamAgent  # noqa: E402

pytestmark = pytest.mark.skipif(not falkor_client.is_live, reason="FalkorDB not reachable")

PLANTED = ["DevIntern", "Contractor", "SupportUser"]
# entrypoint -> (expected cut edge on the seeded graph, crown jewel)
EXPECTED_CUT = {
    "DevIntern": (("BackendAppRole", "ProdCustomerVault"), "ProdCustomerVault"),
    "Contractor": (("KMSDecryptPolicy", "ProdKMSKey"), "ProdKMSKey"),
    "SupportUser": (("DynamoDBReaderRole", "CrownJewelDB"), "CrownJewelDB"),
}


@pytest.fixture(autouse=True)
def seeded():
    seed_database(force=True)
    yield
    seed_database(force=True)


@pytest.fixture
def agent():
    return BlueTeamAgent(falkor_client)


def _path_names(ep):
    p = falkor_client.engine.find_shortest_path(ep)
    return [n["properties"]["name"] for n in p] if p else None


@pytest.mark.parametrize("ep", PLANTED)
def test_plan_cut_matches_old_algorithm(agent, ep):
    plan = agent.plan_cut(ep)
    assert plan["status"] == "ok"
    (cut, cj) = EXPECTED_CUT[ep]
    assert [tuple(e) for e in plan["cut"]] == [cut]
    assert plan["collateral"] == 0
    assert plan["exposed_before"] == sorted(PLANTED)
    assert plan["exposed_after"] == sorted(set(PLANTED) - {ep})
    assert plan["protected_identities"] == [ep]
    # the cut edge lies on the entrypoint's shortest attack path
    path = _path_names(ep)
    assert path[-1] == cj
    assert any(path[i:i + 2] == list(cut) for i in range(len(path) - 1))
    # Cypher transparency + FalkorDB-measured timing
    assert len(plan["cypher"]) >= 4 and all("MATCH" in q for q in plan["cypher"])
    assert plan["falkordb_time_ms"] > 0 and plan["falkordb_queries"] >= 4
    meta = plan["cut_meta"][0]
    assert meta["type"] and meta["src_label"] and meta["dst_label"] == "Resource"


@pytest.mark.parametrize("ep", PLANTED)
def test_apply_verifies_and_undo_restores(agent, ep):
    assert _path_names(ep) is not None
    plan = agent.plan_cut(ep)
    src, dst = plan["cut"][0]
    applied = agent.apply_remediation_cypher(src, dst, ep)
    assert applied["status"] == "applied" and applied["edges_removed"] == 1
    assert applied["verification"]["verified"] is True
    assert ep not in applied["verification"]["exposed_after"]
    assert _path_names(ep) is None
    assert agent.plan_cut(ep)["status"] == "no_path"
    assert applied["run_id"] and applied["cypher"]

    undo = agent.undo_remediation(src, dst)
    assert undo["status"] == "restored"
    assert ep in undo["exposed_now"]
    assert _path_names(ep)[-1] == EXPECTED_CUT[ep][1]


def test_analyze_and_remediate_shape(agent):
    from backend.agents.red_team import red_team_agent
    attack = red_team_agent.execute_attack_simulation("DevIntern", record_incident=True)
    res = agent.analyze_and_remediate(attack)
    assert res["status"] == "success"
    for k in ("choke_point", "cut_edges", "cut_method", "collateral_pairs_lost", "also_protected",
              "exposed_identities_before", "exposed_identities_after", "blast_radius_before",
              "blast_radius_after", "blast_radius_reduced_percent", "business_impact_score",
              "is_repeat_offender", "repeat_incident_count", "regression_detected", "priority",
              "terraform_patch", "thoughts", "engine", "execution_time_ms", "agent_mode",
              "run_id", "cypher", "falkordb_time_ms"):
        assert k in res, k
    cp = res["choke_point"]
    assert (cp["source_name"], cp["target_name"]) == EXPECTED_CUT["DevIntern"][0]
    assert res["blast_radius_after"]["crown_jewels_count"] == 0
    assert "aws_iam_role_policy" in res["terraform_patch"] and "s3:GetObject" in res["terraform_patch"]


def test_terraform_patches_follow_schema(agent):
    tf = agent._generate_terraform_patch
    # CAN_ASSUME granted by a policy -> strip the granting policy's action
    p = tf({"src": "Contractor", "src_label": "User", "dst": "AdminRole", "dst_label": "Role",
            "type": "CAN_ASSUME", "properties": {"technique": "iam:UpdateAssumeRolePolicy",
                                                 "granted_by": "AttachPolicyPermissions"}}, "Contractor", False)
    assert 'resource "aws_iam_policy" "attachpolicypermissions"' in p and "iam:UpdateAssumeRolePolicy" in p
    # CAN_ASSUME from Compute -> the instance-profile role is the principal
    p = tf({"src": "BuildEC2", "src_label": "Compute", "dst": "BackendAppRole", "dst_label": "Role",
            "type": "CAN_ASSUME", "properties": {"technique": "sts:AssumeRole"}}, "DevIntern", False)
    assert "aws_iam_role.cirunnerrole.arn" in p and 'resource "aws_iam_role" "backendapprole"' in p
    # HAS_POLICY from a Role -> roles = [...]
    p = tf({"src": "AdminRole", "src_label": "Role", "dst": "KMSDecryptPolicy", "dst_label": "Policy",
            "type": "HAS_POLICY", "properties": {"attachment": "managed"}}, "Contractor", True)
    assert '- roles = ["AdminRole"]' in p and "P0_EMERGENCY" in p
    # ATTACHED_TO execution role -> lambda function role swap
    p = tf({"src": "SupportOpsRole", "src_label": "Role", "dst": "SupportLambda", "dst_label": "Compute",
            "type": "ATTACHED_TO", "properties": {"binding": "execution-role"}}, "SupportUser", False)
    assert 'resource "aws_lambda_function" "supportlambda"' in p
    # CAN_ACCESS from Policy -> remove permission from that policy
    p = tf({"src": "KMSDecryptPolicy", "src_label": "Policy", "dst": "ProdKMSKey", "dst_label": "Resource",
            "type": "CAN_ACCESS", "properties": {"permission": "kms:Decrypt"}}, "Contractor", False)
    assert "aws_kms_key.prodkmskey.arn" in p and "kms:Decrypt" in p


def test_greedy_multi_edge_cut_when_no_single_edge_works(agent):
    """Add an edge-disjoint second path DevIntern -> ProdCustomerVault; no single edge can cut both."""
    g = falkor_client.engine
    g.q("CREATE (:Role {name: 'BlueTestShadowRole', id: 'rol_blue_test_shadow'})")
    g.q("MATCH (u:User {name: 'DevIntern'}), (r:Role {name: 'BlueTestShadowRole'}) "
        "CREATE (u)-[:CAN_ASSUME {technique: 'sts:AssumeRole'}]->(r)")
    g.q("MATCH (r:Role {name: 'BlueTestShadowRole'}), (v:Resource {name: 'ProdCustomerVault'}) "
        "CREATE (r)-[:CAN_ACCESS {permission: 's3:GetObject'}]->(v)")
    plan = agent.plan_cut("DevIntern")
    assert plan["status"] == "ok"
    assert plan["method"].startswith("Greedy multi-edge cut")
    assert len(plan["cut"]) == 2 and plan["collateral"] is None
    assert "DevIntern" not in plan["exposed_after"]
    for s, d in plan["cut"]:
        g.remove_edge(s, d)
    assert _path_names("DevIntern") is None
