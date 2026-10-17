"""
Triage router — scanner-style findings ranked by graph impact.

GET  /api/triage           — full ranked findings list
GET  /api/triage/summary   — counts only (fast)
POST /api/triage/chokepoints — betweenness-ranked chokepoints
"""
import time
import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter

from backend.db.falkor import falkor_client, ATTACK_REL_TYPES, ATTACK_RELS

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/triage", tags=["triage"])

# ─── helpers ────────────────────────────────────────────────────────────────

# Both helpers answer for every source at once: one Cypher query each instead of two
# round-trips per source node (~200 sequential queries took ~23 s against FalkorDB Cloud).

def _crown_jewel_reachers(names: List[str], hops: int = 6) -> set:
    """Names among `names` that have a path of <= hops attack edges to any crown jewel."""
    rows = falkor_client.engine.q(
        f"UNWIND $names AS x "
        f"MATCH (s) WHERE s.name = x AND NOT s:Incident "
        f"MATCH (t:Resource) WHERE t.is_crown_jewel = true OR t.sensitivity = 'CrownJewel' "
        f"WITH x, shortestPath((s)-[:{ATTACK_RELS}*1..{int(hops)}]->(t)) AS p "
        f"WHERE p IS NOT NULL RETURN DISTINCT x",
        {"names": names})
    return {r[0] for r in rows}

def _reachable_counts(names: List[str], hops: int = 4) -> Dict[str, int]:
    """{name: number of distinct nodes reachable within `hops` attack edges (excluding itself)}."""
    rows = falkor_client.engine.q(
        f"UNWIND $names AS x "
        f"MATCH (s) WHERE s.name = x "
        f"MATCH (s)-[:{ATTACK_RELS}*1..{int(hops)}]->(m) WHERE m <> s "
        f"RETURN x, count(DISTINCT m)",
        {"names": names})
    return {r[0]: int(r[1]) for r in rows}

def _betweenness_scores() -> Dict[str, float]:
    """
    Returns {node_name: betweenness_score} via algo.betweenness.
    Falls back to empty dict if the procedure is unavailable.
    """
    try:
        rows = falkor_client.query(
            "CALL algo.betweenness({relationshipTypes: $rels, samplingSeed: 42}) "
            "YIELD node, score RETURN node.name, score",
            {"rels": ATTACK_REL_TYPES}
        ).result_set
        return {r[0]: float(r[1]) for r in rows if r[0]}
    except Exception as e:
        logger.warning("betweenness unavailable: %s", e)
        return {}

def _impact_score(edge: Dict[str, Any],
                  betweenness: Dict[str, float],
                  src_reaches_cj: bool,
                  reachable: int) -> int:
    """
    Composite 0-100 impact score for a single permission edge.
    """
    score = 0
    # Crown-jewel path through this edge's source
    if src_reaches_cj:
        score += 50
    # Destination is itself a crown jewel
    if edge.get("dst_is_crown_jewel"):
        score += 30
    # Betweenness of the source node (normalise to 0-15)
    bw = betweenness.get(edge["src"], 0.0)
    bw_norm = min(15, int(bw / 10))
    score += bw_norm
    # Blast radius of source (normalise to 0-5)
    score += min(5, reachable // 2)
    return min(100, score)

def _severity(score: int) -> str:
    if score >= 75:
        return "CRITICAL"
    if score >= 50:
        return "HIGH"
    if score >= 25:
        return "MEDIUM"
    return "LOW"


# ─── endpoints ───────────────────────────────────────────────────────────────

@router.get("")
def get_findings(max_findings: int = 200) -> Dict[str, Any]:
    """
    Return every permission edge as a ranked finding.
    The top entries are the ones that matter most for remediation.
    """
    t0 = time.perf_counter()
    edges = falkor_client.engine.attack_edges()
    betweenness = _betweenness_scores()

    sources = sorted({e["src"] for e in edges})
    reaches_cj = _crown_jewel_reachers(sources)
    reach_counts = _reachable_counts(sources)
    src_cj_cache = {s: s in reaches_cj for s in sources}
    src_blast_cache = {s: reach_counts.get(s, 0) for s in sources}

    findings = []
    for edge in edges:
        src = edge["src"]

        score = _impact_score(
            edge, betweenness,
            src_cj_cache[src], src_blast_cache[src]
        )
        findings.append({
            "finding_id": f"{edge['src']}→{edge['type']}→{edge['dst']}",
            "src": edge["src"],
            "src_label": edge.get("src_label", ""),
            "rel_type": edge["type"],
            "dst": edge["dst"],
            "dst_label": edge.get("dst_label", ""),
            "dst_is_crown_jewel": edge.get("dst_is_crown_jewel", False),
            "src_reaches_crown_jewel": src_cj_cache[src],
            "blast_radius": src_blast_cache[src],
            "betweenness": round(betweenness.get(src, 0.0), 2),
            "impact_score": score,
            "severity": _severity(score),
            "recommendation": _recommend(edge, src_cj_cache[src]),
        })

    findings.sort(key=lambda f: f["impact_score"], reverse=True)
    findings = findings[:max_findings]

    counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for f in findings:
        counts[f["severity"]] += 1

    return {
        "total_findings": len(findings),
        "severity_counts": counts,
        "headline": f"{len(findings)} findings → {counts['CRITICAL'] + counts['HIGH']} that matter",
        "findings": findings,
        "execution_time_ms": round((time.perf_counter() - t0) * 1000.0, 1),
    }


@router.get("/summary")
def get_summary() -> Dict[str, Any]:
    """Fast summary — severity distribution + headline, no per-edge detail."""
    result = get_findings(max_findings=500)
    return {
        "total_findings": result["total_findings"],
        "severity_counts": result["severity_counts"],
        "headline": result["headline"],
        "execution_time_ms": result["execution_time_ms"],
    }


@router.get("/chokepoints")
def get_chokepoints(top_n: int = 10) -> Dict[str, Any]:
    """Return top-N chokepoints by betweenness score."""
    t0 = time.perf_counter()
    betweenness = _betweenness_scores()
    ranked = sorted(betweenness.items(), key=lambda x: x[1], reverse=True)[:top_n]
    return {
        "chokepoints": [{"node": name, "betweenness_score": round(score, 3)} for name, score in ranked],
        "algorithm": "algo.betweenness (FalkorDB 4.18)",
        "execution_time_ms": round((time.perf_counter() - t0) * 1000.0, 1),
    }


def _recommend(edge: Dict[str, Any], src_reaches_cj: bool) -> str:
    rel = edge["type"]
    dst_cj = edge.get("dst_is_crown_jewel")
    if dst_cj:
        return f"Remove or scope-down the {rel} permission — destination is a Crown Jewel."
    if rel == "CAN_ASSUME" and src_reaches_cj:
        return f"Restrict role assumption: {edge['src']} can assume {edge['dst']} and reach Crown Jewels."
    if rel == "HAS_POLICY" and src_reaches_cj:
        return f"Audit policy {edge['dst']}: grants {edge['src']} a path to sensitive resources."
    if rel == "MEMBER_OF":
        return f"Review group membership: {edge['src']} inherits {edge['dst']} permissions."
    return f"Review {rel} edge: {edge['src']} → {edge['dst']}."
