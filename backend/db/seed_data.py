import random
import time
import logging
from typing import Any, Dict, List, Tuple
from backend.db.falkor import falkor_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Node Schema definitions
USERS = [
    # Attack Entry Points
    {"id": "usr_dev_intern", "name": "DevIntern", "department": "Engineering", "is_compromised": True},
    {"id": "usr_contractor", "name": "Contractor", "department": "Operations", "is_compromised": True},
    {"id": "usr_support", "name": "SupportUser", "department": "CustomerSupport", "is_compromised": True},
    # Standard Identities
    {"id": "usr_cloud_admin", "name": "CloudAdmin", "department": "DevSecOps", "is_compromised": False},
    {"id": "usr_data_sci", "name": "DataScientist", "department": "Analytics", "is_compromised": False},
    {"id": "usr_qa_eng", "name": "QAEngineeer", "department": "QA", "is_compromised": False},
]

ROLES = [
    {"id": "rol_ci_runner", "name": "CIRunnerRole", "trust_policy": "ec2.amazonaws.com"},
    {"id": "rol_backend_app", "name": "BackendAppRole", "trust_policy": "ec2.amazonaws.com"},
    {"id": "rol_admin", "name": "AdminRole", "trust_policy": "iam.amazonaws.com"},
    {"id": "rol_dynamo_reader", "name": "DynamoDBReaderRole", "trust_policy": "lambda.amazonaws.com"},
    {"id": "rol_readonly", "name": "ReadOnlyRole", "trust_policy": "sts.amazonaws.com"},
]

POLICIES = [
    {"id": "pol_attach_policy", "name": "AttachPolicyPermissions", "effect": "Allow", "actions": "iam:AttachUserPolicy"},
    {"id": "pol_pass_role", "name": "PassRolePolicy", "effect": "Allow", "actions": "iam:PassRole"},
    {"id": "pol_s3_read", "name": "S3ReadPolicy", "effect": "Allow", "actions": "s3:GetObject"},
    {"id": "pol_kms_decrypt", "name": "KMSDecryptPolicy", "effect": "Allow", "actions": "kms:Decrypt"},
]

COMPUTES = [
    {"id": "cmp_build_ec2", "name": "BuildEC2", "type": "EC2", "instance_profile": "CIRunnerProfile"},
    {"id": "cmp_prod_ec2", "name": "ProdAPIEC2", "type": "EC2", "instance_profile": "BackendAppProfile"},
    {"id": "cmp_support_lambda", "name": "SupportLambda", "type": "Lambda", "instance_profile": "SupportLambdaProfile"},
]

RESOURCES = [
    # Crown Jewels
    {"id": "res_prod_vault", "name": "ProdCustomerVault", "type": "S3Bucket", "sensitivity": "CrownJewel", "is_crown_jewel": True},
    {"id": "res_prod_kms", "name": "ProdKMSKey", "type": "KMSKey", "sensitivity": "CrownJewel", "is_crown_jewel": True},
    {"id": "res_crown_db", "name": "CrownJewelDB", "type": "DynamoDB", "sensitivity": "CrownJewel", "is_crown_jewel": True},
    # Standard Resources
    {"id": "res_dev_bucket", "name": "DevLogsBucket", "type": "S3Bucket", "sensitivity": "Internal", "is_crown_jewel": False},
    {"id": "res_temp_db", "name": "TestStagingDB", "type": "RDS", "sensitivity": "Internal", "is_crown_jewel": False},
]

def generate_synthetic_nodes_and_edges():
    """Synthetic nodes to reach 150+ total nodes across the environment."""
    extra_users = [{"id": f"usr_dev_{i}", "name": f"Developer_{i}", "department": "Engineering", "is_compromised": False} for i in range(1, 40)]
    extra_roles = [{"id": f"rol_sec_{i}", "name": f"ServiceRole_{i}", "trust_policy": "sts.amazonaws.com"} for i in range(1, 40)]
    extra_computes = [{"id": f"cmp_node_{i}", "name": f"WorkerInstance_{i}", "type": "EC2", "instance_profile": f"WorkerProfile_{i}"} for i in range(1, 40)]
    extra_resources = [{"id": f"res_asset_{i}", "name": f"InternalAsset_{i}", "type": "S3Bucket", "sensitivity": "Internal", "is_crown_jewel": False} for i in range(1, 35)]
    return extra_users, extra_roles, extra_computes, extra_resources


# Fixed seed: the demo graph is identical on every boot, so rehearsal == stage.
SEED = 42

PLANTED_EDGES = [
    # Path A: DevIntern -> CIRunnerRole -> BuildEC2 -> BackendAppRole -> ProdCustomerVault (4 hops)
    ("DevIntern", "CIRunnerRole", "CAN_ASSUME", {}),
    ("CIRunnerRole", "BuildEC2", "ATTACHED_TO", {}),
    ("BuildEC2", "BackendAppRole", "CAN_ASSUME", {}),
    ("BackendAppRole", "ProdCustomerVault", "CAN_ACCESS", {"permission": "s3:GetObject"}),
    # Path B: Contractor -> AttachPolicyPermissions -> AdminRole -> ProdKMSKey (3 hops)
    ("Contractor", "AttachPolicyPermissions", "HAS_POLICY", {}),
    ("AttachPolicyPermissions", "AdminRole", "CAN_ASSUME", {}),
    ("AdminRole", "ProdKMSKey", "CAN_ACCESS", {"permission": "kms:Decrypt"}),
    # Path C: SupportUser -> SupportLambda -> PassRolePolicy -> DynamoDBReaderRole -> CrownJewelDB (4 hops)
    ("SupportUser", "SupportLambda", "CAN_ACCESS", {}),
    ("SupportLambda", "PassRolePolicy", "HAS_POLICY", {}),
    ("PassRolePolicy", "DynamoDBReaderRole", "CAN_ASSUME", {}),
    ("DynamoDBReaderRole", "CrownJewelDB", "CAN_ACCESS", {"permission": "dynamodb:GetItem"}),
]


def build_dataset() -> Tuple[Dict[str, List[Dict[str, Any]]], List[Tuple[str, str, str, Dict[str, Any]]]]:
    """Returns ({label: [props]}, [(src, dst, type, props)]) — deterministic."""
    rng = random.Random(SEED)
    e_u, e_r, e_c, e_res = generate_synthetic_nodes_and_edges()
    nodes = {
        "User": USERS + e_u, "Role": ROLES + e_r, "Policy": POLICIES,
        "Compute": COMPUTES + e_c, "Resource": RESOURCES + e_res,
    }
    edges = list(PLANTED_EDGES)
    noise_users = [u["name"] for u in USERS + e_u if u["name"] not in ("DevIntern", "Contractor", "SupportUser")]
    noise_roles = [r["name"] for r in ROLES + e_r if r["name"] != "AdminRole"]
    all_c = [c["name"] for c in COMPUTES + e_c]
    all_res = [r["name"] for r in RESOURCES + e_res if not r.get("is_crown_jewel")]
    for _ in range(60):
        edges.append((rng.choice(noise_users), rng.choice(noise_roles), "MEMBER_OF", {}))
    for _ in range(60):
        edges.append((rng.choice(all_c), rng.choice(all_res), "CAN_ACCESS", {"permission": "s3:ListBucket"}))
    return nodes, edges


def seed_database(force: bool = True) -> Dict[str, Any]:
    """
    Populates the active engine. Agent memory (:Incident, :AgentMemory, :Remediation) is never wiped.
    force=False (used at boot) keeps an existing live graph untouched, so state persists across restarts.
    """
    t0 = time.perf_counter()
    nodes, edges = build_dataset()
    if not falkor_client.is_live:
        logger.warning("FalkorDB not connected — skipping seed.")
        return {"status": "skipped", "mode": "down", "reason": "FalkorDB not reachable"}

    engine = falkor_client.engine
    existing = engine.q("MATCH (u:User) RETURN count(u)")[0][0]
    if existing and not force:
        logger.info(f"FalkorDB graph already holds {existing} users — keeping persisted state (no reseed).")
        return {"status": "kept", "mode": "live", "users": existing}

    engine.q("MATCH (n) WHERE n:User OR n:Role OR n:Policy OR n:Compute OR n:Resource DETACH DELETE n")
    for label, rows in nodes.items():
        for col in ("name", "id"):
            try:
                engine.q(f"CREATE INDEX FOR (n:{label}) ON (n.{col})")
            except Exception:
                pass  # index already exists
        engine.q(f"UNWIND $rows AS r CREATE (n:{label}) SET n = r", {"rows": rows})
    by_type: Dict[str, List[Dict[str, Any]]] = {}
    for s, d, t, p in edges:
        by_type.setdefault(t, []).append({"s": s, "d": d, "p": p})
    for t, rows in by_type.items():
        engine.q(f"UNWIND $rows AS r MATCH (a {{name: r.s}}), (b {{name: r.d}}) CREATE (a)-[e:{t}]->(b) SET e = r.p",
                 {"rows": rows})
    ms = (time.perf_counter() - t0) * 1000.0
    total_nodes = sum(len(v) for v in nodes.values())
    logger.info(f"Seeded FalkorDB in {ms:.2f}ms ({total_nodes} nodes, {len(edges)} edges)")
    return {"status": "success", "nodes_created": total_nodes, "edges_created": len(edges),
            "elapsed_ms": round(ms, 2), "mode": "live"}


if __name__ == "__main__":
    print(seed_database())
