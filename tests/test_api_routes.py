import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.db.seed_data import seed_database

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_api_seed():
    seed_database(force=True)

def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["app"] == "Argus CloudMesh Engine"
    assert data["status"] == "online"

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"

def test_graph_overview_endpoint():
    response = client.get("/api/graph/overview")
    assert response.status_code == 200
    data = response.json()
    assert data["total_nodes"] >= 150

def test_graph_topology_endpoint():
    response = client.get("/api/graph/topology")
    assert response.status_code == 200
    data = response.json()
    assert "nodes" in data
    assert "links" in data
    assert len(data["nodes"]) >= 150

def test_red_team_attack_simulation():
    response = client.post("/api/simulate/attack", json={"entrypoint": "DevIntern"})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["entrypoint"] == "DevIntern"
    assert data["total_hops"] >= 3
    assert data["ground_truth"]["agrees"] is True

def test_blue_team_remediation_simulation():
    # Run attack first
    attack_res = client.post("/api/simulate/attack", json={"entrypoint": "DevIntern"}).json()
    
    # Run blue team remediation
    response = client.post("/api/simulate/remediate", json={"attack_result": attack_res})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "choke_point" in data
    assert "terraform_patch" in data
    assert "resource" in data["terraform_patch"]

def test_apply_patch_endpoint():
    response = client.post("/api/simulate/apply-patch", json={
        "source_name": "CIRunnerRole",
        "target_name": "BuildEC2"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "applied"

def test_risk_scorecard_endpoint():
    response = client.get("/api/graph/risk-scorecard")
    assert response.status_code == 200
    data = response.json()
    assert data["total_assessed"] >= 5
    assert data["critical_vulnerabilities"] >= 3

def test_benchmark_compare_endpoint():
    response = client.post("/api/graph/benchmark/compare", params={"entrypoint": "DevIntern"})
    assert response.status_code == 200
    data = response.json()
    assert "vector_rag" in data
    assert "falkordb" in data
    assert data["falkordb"]["traversal_capable"] is True
    assert data["vector_rag"]["traversal_capable"] is False
