"""
Deterministic synthetic IAM graph for ARGUS (SEED=42, identical on every boot).

Graph data model
----------------
Node labels: User, Role, Policy, Compute, Resource (every node has a unique `name` and `id`).

Every edge points in the ATTACK direction: `(a)-[r]->(b)` reads "whoever controls `a`
can reach / gain `b`". A directed variable-length traversal over the five relationship
types below is therefore exactly the attacker's reachability.

| Rel type      | From → To                   | Meaning                                                                 | Properties |
|---------------|-----------------------------|-------------------------------------------------------------------------|------------|
| `MEMBER_OF`   | User → Role                 | User is a member of the role (group / SSO permission set)               | — |
| `HAS_POLICY`  | User, Role → Policy         | Identity-based policy attached to the principal                         | `attachment`: `managed` \\| `inline` |
| `CAN_ASSUME`  | User, Role, Compute → Role  | Principal or workload can obtain the role's credentials (escalation)   | `technique`: IAM action used, e.g. `sts:AssumeRole`, `iam:PassRole`, `iam:UpdateAssumeRolePolicy`; optional `granted_by` (policy name) |
| `ATTACHED_TO` | Role → Compute              | Role is bound to the workload (instance profile / execution role); a holder of the role runs code through that compute | `binding`: `instance-profile` \\| `execution-role` |
| `CAN_ACCESS`  | Role, Policy, Compute → Resource | Data-plane access to the resource                                  | `permission`: IAM action, e.g. `s3:GetObject`, `kms:Decrypt` |

Planted attack paths (the only identities that reach a Crown Jewel):
  A  DevIntern  -CAN_ASSUME-> CIRunnerRole -ATTACHED_TO-> BuildEC2 -CAN_ASSUME-> BackendAppRole
                -CAN_ACCESS-> ProdCustomerVault                                         (4 hops)
  B  Contractor -CAN_ASSUME{iam:UpdateAssumeRolePolicy}-> AdminRole -HAS_POLICY-> KMSDecryptPolicy
                -CAN_ACCESS-> ProdKMSKey                                                (3 hops)
  C  SupportUser -MEMBER_OF-> SupportOpsRole -ATTACHED_TO-> SupportLambda -CAN_ASSUME{iam:PassRole}->
                DynamoDBReaderRole -CAN_ACCESS-> CrownJewelDB                           (4 hops)

Background ("filler") environment: a set of product teams, each with engineers, a dev role,
an app role, a data policy, an API instance, a worker Lambda, a bucket and a table. Filler edges
follow the same schema but only ever point at team nodes or at shared, non-sensitive nodes
(ReadOnlyRole, S3ReadPolicy, DevLogsBucket), so they never open a new path to a Crown Jewel.
"""
import random
import time
import logging
from typing import Any, Dict, List, Tuple
from backend.db.falkor import falkor_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Fixed seed: the demo graph is identical on every boot, so rehearsal == stage.
SEED = 42

# rel type -> (allowed source labels, allowed target labels). Single source of truth for the model.
SCHEMA: Dict[str, Tuple[Tuple[str, ...], Tuple[str, ...]]] = {
    "MEMBER_OF":   (("User",), ("Role",)),
    "HAS_POLICY":  (("User", "Role"), ("Policy",)),
    "CAN_ASSUME":  (("User", "Role", "Compute"), ("Role",)),
    "ATTACHED_TO": (("Role",), ("Compute",)),
    "CAN_ACCESS":  (("Role", "Policy", "Compute"), ("Resource",)),
}
# Property each edge of that type must carry.
REQUIRED_EDGE_PROPS = {"CAN_ASSUME": "technique", "CAN_ACCESS": "permission", "ATTACHED_TO": "binding"}

ENTRYPOINT_TARGETS = {
    "DevIntern": ("ProdCustomerVault", 4),
    "Contractor": ("ProdKMSKey", 3),
    "SupportUser": ("CrownJewelDB", 4),
}

# ── Core (named) nodes ─────────────────────────────────────────────────────────
USERS = [
    # Attack entry points (assumed compromised)
    {"id": "usr_dev_intern", "name": "DevIntern", "department": "Engineering", "is_compromised": True},
    {"id": "usr_contractor", "name": "Contractor", "department": "Operations", "is_compromised": True},
    {"id": "usr_support", "name": "SupportUser", "department": "CustomerSupport", "is_compromised": True},
    # Standard identities
    {"id": "usr_cloud_admin", "name": "CloudAdmin", "department": "DevSecOps", "is_compromised": False},
    {"id": "usr_data_sci", "name": "DataScientist", "department": "Analytics", "is_compromised": False},
    {"id": "usr_qa_eng", "name": "QAEngineer", "department": "QA", "is_compromised": False},
]

ROLES = [
    {"id": "rol_ci_runner", "name": "CIRunnerRole", "trust_policy": "ec2.amazonaws.com"},
    {"id": "rol_backend_app", "name": "BackendAppRole", "trust_policy": "ec2.amazonaws.com"},
    {"id": "rol_admin", "name": "AdminRole", "trust_policy": "iam.amazonaws.com"},
    {"id": "rol_dynamo_reader", "name": "DynamoDBReaderRole", "trust_policy": "lambda.amazonaws.com"},
    {"id": "rol_readonly", "name": "ReadOnlyRole", "trust_policy": "sts.amazonaws.com"},
    {"id": "rol_support_ops", "name": "SupportOpsRole", "trust_policy": "lambda.amazonaws.com"},
]

POLICIES = [
    {"id": "pol_attach_policy", "name": "AttachPolicyPermissions", "effect": "Allow",
     "actions": "iam:AttachRolePolicy,iam:UpdateAssumeRolePolicy"},
    {"id": "pol_pass_role", "name": "PassRolePolicy", "effect": "Allow", "actions": "iam:PassRole,lambda:CreateFunction"},
    {"id": "pol_s3_read", "name": "S3ReadPolicy", "effect": "Allow", "actions": "s3:GetObject"},
    {"id": "pol_kms_decrypt", "name": "KMSDecryptPolicy", "effect": "Allow", "actions": "kms:Decrypt"},
]

COMPUTES = [
    {"id": "cmp_build_ec2", "name": "BuildEC2", "type": "EC2", "instance_profile": "CIRunnerProfile"},
    {"id": "cmp_prod_ec2", "name": "ProdAPIEC2", "type": "EC2", "instance_profile": "BackendAppProfile"},
    {"id": "cmp_support_lambda", "name": "SupportLambda", "type": "Lambda", "instance_profile": "SupportOpsRole"},
]

RESOURCES = [
    # Crown Jewels
    {"id": "res_prod_vault", "name": "ProdCustomerVault", "type": "S3Bucket", "sensitivity": "CrownJewel", "is_crown_jewel": True},
    {"id": "res_prod_kms", "name": "ProdKMSKey", "type": "KMSKey", "sensitivity": "CrownJewel", "is_crown_jewel": True},
    {"id": "res_crown_db", "name": "CrownJewelDB", "type": "DynamoDB", "sensitivity": "CrownJewel", "is_crown_jewel": True},
    # Standard resources
    {"id": "res_dev_bucket", "name": "DevLogsBucket", "type": "S3Bucket", "sensitivity": "Internal", "is_crown_jewel": False},
    {"id": "res_temp_db", "name": "TestStagingDB", "type": "RDS", "sensitivity": "Internal", "is_crown_jewel": False},
]

# ── Planted edges: three attack paths plus the benign edges around them ──────
PLANTED_EDGES = [
    # Path A (4 hops): CI runner credentials on the build box can assume the prod app role.
    ("DevIntern", "CIRunnerRole", "CAN_ASSUME", {"technique": "sts:AssumeRole"}),
    ("CIRunnerRole", "BuildEC2", "ATTACHED_TO", {"binding": "instance-profile"}),
    ("BuildEC2", "BackendAppRole", "CAN_ASSUME", {"technique": "sts:AssumeRole"}),
    ("BackendAppRole", "ProdCustomerVault", "CAN_ACCESS", {"permission": "s3:GetObject"}),
    # Path B (3 hops): contractor may rewrite AdminRole's trust policy, then assume it.
    ("Contractor", "AttachPolicyPermissions", "HAS_POLICY", {"attachment": "inline"}),
    ("Contractor", "AdminRole", "CAN_ASSUME",
     {"technique": "iam:UpdateAssumeRolePolicy", "granted_by": "AttachPolicyPermissions"}),
    ("AdminRole", "KMSDecryptPolicy", "HAS_POLICY", {"attachment": "managed"}),
    ("KMSDecryptPolicy", "ProdKMSKey", "CAN_ACCESS", {"permission": "kms:Decrypt"}),
    # Path C (4 hops): support Lambda's execution role can pass a more privileged role.
    ("SupportUser", "SupportOpsRole", "MEMBER_OF", {}),
    ("SupportOpsRole", "PassRolePolicy", "HAS_POLICY", {"attachment": "managed"}),
    ("SupportOpsRole", "SupportLambda", "ATTACHED_TO", {"binding": "execution-role"}),
    ("SupportLambda", "DynamoDBReaderRole", "CAN_ASSUME",
     {"technique": "iam:PassRole", "granted_by": "PassRolePolicy"}),
    ("DynamoDBReaderRole", "CrownJewelDB", "CAN_ACCESS", {"permission": "dynamodb:GetItem"}),
    # Benign context around the planted paths (no extra Crown Jewel reachability).
    ("BackendAppRole", "ProdAPIEC2", "ATTACHED_TO", {"binding": "instance-profile"}),
    ("BuildEC2", "TestStagingDB", "CAN_ACCESS", {"permission": "rds-db:connect"}),
    ("CloudAdmin", "ReadOnlyRole", "MEMBER_OF", {}),
    ("QAEngineer", "ReadOnlyRole", "MEMBER_OF", {}),
    ("DataScientist", "ReadOnlyRole", "MEMBER_OF", {}),
    ("ReadOnlyRole", "S3ReadPolicy", "HAS_POLICY", {"attachment": "managed"}),
    ("S3ReadPolicy", "DevLogsBucket", "CAN_ACCESS", {"permission": "s3:GetObject"}),
]

# ── Background environment: product teams ─────────────────────────────────────
TEAMS = ["payments", "checkout", "analytics", "search", "notifications", "identity", "billing",
         "catalog", "recommendations", "fraud", "logistics", "inventory", "web-frontend"]
_FIRST = ["alice", "bob", "carol", "dan", "erin", "farah", "gus", "hana", "ivan", "jun", "kofi", "lena",
          "mateo", "nadia", "omar", "priya", "quinn", "rosa", "sven", "tara", "umar", "vera", "wei", "yuki"]
_LAST = ["nguyen", "smith", "okafor", "garcia", "kim", "patel", "muller", "rossi", "silva", "tanaka",
         "cohen", "ali", "berg", "dubois", "ivanova", "lopez", "mensah", "novak", "reyes", "zhang"]
ENGINEERS_PER_TEAM = 3


def generate_team_environment(rng: random.Random):
    """Plausible team-owned nodes + schema-consistent edges. Edges only target team nodes or
    shared non-sensitive nodes, so no new Crown Jewel paths can appear."""
    users, roles, policies, computes, resources, edges = [], [], [], [], [], []
    used = set()
    people = []
    for team in TEAMS:
        dev, app, pol = f"{team}-dev-role", f"{team}-app-role", f"{team}-data-rw"
        api, worker = f"{team}-api-ec2", f"{team}-worker-lambda"
        bucket, table = f"{team}-assets-bucket", f"{team}-records-table"
        roles += [{"id": f"rol_{team}_dev", "name": dev, "trust_policy": "sts.amazonaws.com"},
                  {"id": f"rol_{team}_app", "name": app, "trust_policy": "ec2.amazonaws.com"}]
        policies.append({"id": f"pol_{team}_data", "name": pol, "effect": "Allow",
                         "actions": "s3:GetObject,s3:PutObject,dynamodb:Query"})
        computes += [{"id": f"cmp_{team}_api", "name": api, "type": "EC2", "instance_profile": f"{app}-profile"},
                     {"id": f"cmp_{team}_worker", "name": worker, "type": "Lambda", "instance_profile": app}]
        resources += [{"id": f"res_{team}_bucket", "name": bucket, "type": "S3Bucket",
                       "sensitivity": "Internal", "is_crown_jewel": False},
                      {"id": f"res_{team}_table", "name": table, "type": "DynamoDB",
                       "sensitivity": "Internal", "is_crown_jewel": False}]
        edges += [
            (dev, pol, "HAS_POLICY", {"attachment": "managed"}),
            (dev, app, "CAN_ASSUME", {"technique": "sts:AssumeRole"}),
            (app, pol, "HAS_POLICY", {"attachment": "managed"}),
            (pol, bucket, "CAN_ACCESS", {"permission": "s3:GetObject"}),
            (pol, table, "CAN_ACCESS", {"permission": "dynamodb:Query"}),
            (app, api, "ATTACHED_TO", {"binding": "instance-profile"}),
            (app, worker, "ATTACHED_TO", {"binding": "execution-role"}),
            (api, table, "CAN_ACCESS", {"permission": "dynamodb:PutItem"}),
            (worker, "DevLogsBucket", "CAN_ACCESS", {"permission": "s3:PutObject"}),
        ]
        for _ in range(ENGINEERS_PER_TEAM):
            while True:
                handle = f"{rng.choice(_FIRST)}.{rng.choice(_LAST)}"
                if handle not in used:
                    used.add(handle)
                    break
            users.append({"id": f"usr_{handle.replace('.', '_')}", "name": handle,
                          "department": team, "is_compromised": False})
            edges.append((handle, dev, "MEMBER_OF", {}))
            people.append(handle)
    # Cross-team wiring: engineers on-call for a neighbour team, workers calling other teams' APIs.
    for _ in range(12):
        edges.append((rng.choice(people), f"{rng.choice(TEAMS)}-dev-role", "CAN_ASSUME",
                      {"technique": "sts:AssumeRole"}))
    for _ in range(10):
        edges.append((f"{rng.choice(TEAMS)}-worker-lambda", f"{rng.choice(TEAMS)}-app-role", "CAN_ASSUME",
                      {"technique": "sts:AssumeRole"}))
    for team in rng.sample(TEAMS, 5):
        edges.append((f"{team}-dev-role", "ReadOnlyRole", "CAN_ASSUME", {"technique": "sts:AssumeRole"}))
    # Entrypoints and named users also do ordinary team work.
    edges += [
        ("DevIntern", "web-frontend-dev-role", "MEMBER_OF", {}),
        ("Contractor", "logistics-dev-role", "MEMBER_OF", {}),
        ("DataScientist", "analytics-dev-role", "MEMBER_OF", {}),
        ("QAEngineer", "checkout-dev-role", "MEMBER_OF", {}),
    ]
    # De-duplicate (and drop self-loops) while keeping deterministic order.
    seen, uniq = set(), []
    for s, d, t, p in edges:
        if s != d and (s, d, t) not in seen:
            seen.add((s, d, t))
            uniq.append((s, d, t, p))
    return users, roles, policies, computes, resources, uniq


def build_dataset() -> Tuple[Dict[str, List[Dict[str, Any]]], List[Tuple[str, str, str, Dict[str, Any]]]]:
    """Returns ({label: [props]}, [(src_name, dst_name, rel_type, props)]) — deterministic."""
    rng = random.Random(SEED)
    t_u, t_r, t_p, t_c, t_res, t_edges = generate_team_environment(rng)
    nodes = {
        "User": USERS + t_u, "Role": ROLES + t_r, "Policy": POLICIES + t_p,
        "Compute": COMPUTES + t_c, "Resource": RESOURCES + t_res,
    }
    return nodes, list(PLANTED_EDGES) + t_edges


def validate_dataset(nodes: Dict[str, List[Dict[str, Any]]],
                     edges: List[Tuple[str, str, str, Dict[str, Any]]]) -> Dict[str, str]:
    """Raise if any edge breaks SCHEMA; returns the name -> label map."""
    label_of: Dict[str, str] = {}
    for label, rows in nodes.items():
        for r in rows:
            if r["name"] in label_of:
                raise ValueError(f"duplicate node name {r['name']}")
            label_of[r["name"]] = label
    for s, d, t, p in edges:
        src_ok, dst_ok = SCHEMA[t]
        if label_of.get(s) not in src_ok or label_of.get(d) not in dst_ok:
            raise ValueError(f"schema violation: ({s}:{label_of.get(s)})-[:{t}]->({d}:{label_of.get(d)})")
        if t in REQUIRED_EDGE_PROPS and REQUIRED_EDGE_PROPS[t] not in p:
            raise ValueError(f"{t} edge {s}->{d} missing '{REQUIRED_EDGE_PROPS[t]}'")
    return label_of


def seed_database(force: bool = True) -> Dict[str, Any]:
    """
    Populates the active engine. Agent memory (:Incident, :AgentMemory, :Remediation) is never wiped.
    force=False (used at boot) keeps an existing live graph untouched, so state persists across restarts.
    """
    t0 = time.perf_counter()
    nodes, edges = build_dataset()
    label_of = validate_dataset(nodes, edges)
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
    # Group by (rel, src label, dst label) so every MATCH is label-scoped and hits the name index.
    groups: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = {}
    for s, d, t, p in edges:
        groups.setdefault((t, label_of[s], label_of[d]), []).append({"s": s, "d": d, "p": p})
    for (t, sl, dl), rows in groups.items():
        engine.q(f"UNWIND $rows AS r MATCH (a:{sl} {{name: r.s}}), (b:{dl} {{name: r.d}}) "
                 f"CREATE (a)-[e:{t}]->(b) SET e = r.p", {"rows": rows})
    ms = (time.perf_counter() - t0) * 1000.0
    total_nodes = sum(len(v) for v in nodes.values())
    logger.info(f"Seeded FalkorDB in {ms:.2f}ms ({total_nodes} nodes, {len(edges)} edges)")
    return {"status": "success", "nodes_created": total_nodes, "edges_created": len(edges),
            "elapsed_ms": round(ms, 2), "mode": "live"}


if __name__ == "__main__":
    print(seed_database())
