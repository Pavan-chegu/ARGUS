"""Graph data-model checks for the seeded IAM graph, verified with Cypher against FalkorDB.

Run with GRAPH_NAME=ArgusTest_Seed so the demo graph is not touched.
"""
import pytest
from backend.db.falkor import falkor_client, ATTACK_REL_TYPES
from backend.db.seed_data import (SCHEMA, REQUIRED_EDGE_PROPS, ENTRYPOINT_TARGETS,
                                  build_dataset, seed_database, validate_dataset)

INFRA = "n:User OR n:Role OR n:Policy OR n:Compute OR n:Resource"


@pytest.fixture(scope="module")
def g():
    if not falkor_client.is_live:
        pytest.skip("FalkorDB not reachable")
    seed_database(force=True)
    return falkor_client.engine


def test_schema_covers_exactly_the_attack_rel_types():
    assert set(SCHEMA) == set(ATTACK_REL_TYPES)


def test_dataset_validates_offline():
    nodes, edges = build_dataset()
    validate_dataset(nodes, edges)
    assert 150 <= sum(len(v) for v in nodes.values()) <= 180


def test_build_is_deterministic():
    assert build_dataset() == build_dataset()


def test_no_typos_or_generic_filler_names():
    nodes, _ = build_dataset()
    names = {r["name"] for rows in nodes.values() for r in rows}
    assert "QAEngineer" in names and "QAEngineeer" not in names
    for bad in ("Developer_", "ServiceRole_", "WorkerInstance_", "InternalAsset_"):
        assert not any(n.startswith(bad) for n in names)


@pytest.mark.parametrize("rel", sorted(SCHEMA))
def test_no_edge_violates_schema(g, rel):
    src, dst = SCHEMA[rel]
    rows = g.q(f"MATCH (a)-[r:{rel}]->(b) "
               f"WHERE NOT (labels(a)[0] IN $src AND labels(b)[0] IN $dst) "
               f"RETURN a.name, labels(a)[0], b.name, labels(b)[0] LIMIT 10",
               {"src": list(src), "dst": list(dst)})
    assert rows == [], f"{rel} violations: {rows}"
    assert g.q(f"MATCH ()-[r:{rel}]->() RETURN count(r)")[0][0] > 0


@pytest.mark.parametrize("rel,prop", sorted(REQUIRED_EDGE_PROPS.items()))
def test_required_edge_properties(g, rel, prop):
    rows = g.q(f"MATCH (a)-[r:{rel}]->(b) WHERE r.{prop} IS NULL RETURN a.name, b.name LIMIT 10")
    assert rows == [], f"{rel} edges missing {prop}: {rows}"


def test_node_names_unique(g):
    rows = g.q(f"MATCH (n) WHERE {INFRA} WITH n.name AS name, count(*) AS c WHERE c > 1 RETURN name")
    assert rows == []


def test_no_isolated_nodes(g):
    rows = g.q(f"MATCH (n) WHERE ({INFRA}) AND NOT (n)--() RETURN labels(n)[0], n.name")
    assert rows == [], f"isolated nodes: {rows}"


@pytest.mark.parametrize("entry", sorted(ENTRYPOINT_TARGETS))
def test_entrypoint_reaches_its_crown_jewel(g, entry):
    target, hops = ENTRYPOINT_TARGETS[entry]
    rels = "|".join(ATTACK_REL_TYPES)
    rows = g.q(f"MATCH (u:User {{name: $u}}), (t:Resource {{name: $t}}) "
               f"WITH shortestPath((u)-[:{rels}*1..8]->(t)) AS p WHERE p IS NOT NULL "
               f"RETURN length(p), [n IN nodes(p) | n.name]", {"u": entry, "t": target})
    assert rows, f"{entry} cannot reach {target}"
    assert rows[0][0] == hops, rows[0][1]
    # and that crown jewel is also its overall nearest one
    path = g.find_shortest_path(entry)
    assert path[-1]["properties"]["name"] == target and len(path) - 1 == hops


def test_only_planted_entrypoints_reach_crown_jewels(g):
    rels = "|".join(ATTACK_REL_TYPES)
    rows = g.q(f"MATCH (u:User)-[:{rels}*1..10]->(t:Resource {{is_crown_jewel: true}}) "
               f"RETURN DISTINCT u.name ORDER BY u.name")
    assert [r[0] for r in rows] == sorted(ENTRYPOINT_TARGETS)
