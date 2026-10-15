"""
ARGUS MCP Server — exposes ARGUS graph tools via the Model Context Protocol.

Uses FastMCP (mcp>=1.2,<2).  Mount in main.py via:
    app.mount("/mcp", mcp_app)

Tools exposed:
  triage           — ranked findings list
  explain_path     — shortest attack path for an identity
  propose_fix      — blue-team choke-point recommendation for a path
  apply_fix        — sever a choke-point edge in FalkorDB
  recall_incidents — episodic memory of past attacks
"""
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

try:
    from mcp.server.fastmcp import FastMCP
    _MCP_AVAILABLE = True
except ImportError:
    logger.warning("mcp package not installed; MCP server disabled. Run: pip install 'mcp>=1.2,<2'")
    FastMCP = None  # type: ignore
    _MCP_AVAILABLE = False


def build_mcp_app():
    """Returns an ASGI app or None if mcp is not installed."""
    if not _MCP_AVAILABLE or FastMCP is None:
        return None

    mcp = FastMCP("ARGUS — Cloud IAM Exposure Analyzer")

    # ── lazy import to avoid circular deps ──
    def _falkor():
        from backend.db.falkor import falkor_client
        return falkor_client

    # ────────────────────────────────────────────────────────────────────────
    @mcp.tool()
    def triage(max_findings: int = 50) -> Dict[str, Any]:
        """
        Return permission-edge findings ranked by graph impact.
        Each finding has: src, rel_type, dst, impact_score (0-100), severity, recommendation.
        """
        from backend.routers.triage import get_findings
        return get_findings(max_findings=max_findings)

    # ────────────────────────────────────────────────────────────────────────
    @mcp.tool()
    def explain_path(identity: str, max_hops: int = 8) -> Dict[str, Any]:
        """
        Find the shortest attack path from `identity` to any Crown Jewel.
        Returns the hop chain, blast radius and risk score.
        """
        fc = _falkor()
        path = fc.engine.find_shortest_path(identity, max_hops=max_hops)
        if not path:
            return {"identity": identity, "path_found": False,
                    "message": "No path to Crown Jewels found."}
        names = [n["properties"].get("name", n.get("id")) for n in path]
        blast = fc.engine.compute_blast_radius(identity)
        return {
            "identity": identity,
            "path_found": True,
            "hops": len(path) - 1,
            "path_chain": names,
            "target": names[-1],
            "risk_score": blast["risk_score"],
            "risk_level": blast["risk_level"],
            "blast_radius": blast["reachable_nodes_count"],
        }

    # ────────────────────────────────────────────────────────────────────────
    @mcp.tool()
    def propose_fix(identity: str) -> Dict[str, Any]:
        """
        Run the Blue Team agent to identify the minimum edge cut (choke point)
        that severs all paths from `identity` to Crown Jewels.
        Returns the recommended edge to remove.
        """
        from backend.agents.red_team import RedTeamAgent
        from backend.agents.blue_team import BlueTeamAgent
        fc = _falkor()
        red_result = RedTeamAgent(fc).execute_attack_simulation(identity, record_incident=False)
        if red_result.get("status") != "success":
            return {"identity": identity, "fix_needed": False,
                    "message": "No attack path — no fix needed."}
        blue_result = BlueTeamAgent(fc).analyze_and_remediate(red_result)
        cp = blue_result.get("choke_point")
        if not cp:
            return {"identity": identity, "fix_needed": True, "choke_point": None,
                    "message": "Blue Team could not isolate a single choke point."}
        return {
            "identity": identity,
            "fix_needed": True,
            "choke_point": cp,
            "collateral_score": blue_result.get("collateral_score", 0),
            "explanation": (
                f"Remove the {cp.get('rel_type', 'permission')} edge "
                f"from {cp['source_name']} to {cp['target_name']}. "
                f"This severs the path to {red_result.get('target_node')} "
                f"with minimal collateral impact (score {blue_result.get('collateral_score', 0)})."
            ),
        }

    # ────────────────────────────────────────────────────────────────────────
    @mcp.tool()
    def apply_fix(source_name: str, target_name: str) -> Dict[str, Any]:
        """
        Permanently sever the permission edge between source_name and target_name in FalkorDB.
        Records a Remediation node linked to the affected Incident (if known).
        """
        fc = _falkor()
        removed = fc.engine.remove_edge(source_name, target_name)
        if not removed:
            return {"success": False, "message": f"No edge found between {source_name} and {target_name}."}
        # Re-verify: path should be gone
        path_after = fc.engine.find_shortest_path(source_name)
        rem_id = fc.engine.store_remediation({
            "src": source_name,
            "dst": target_name,
            "rel_type": removed[0]["type"],
            "edge_properties": removed[0].get("properties", {}),
            "verified": path_after is None,
        })
        return {
            "success": True,
            "removed_edges": removed,
            "path_still_exists": path_after is not None,
            "remediation_id": rem_id,
            "message": (
                f"Edge severed. Path to Crown Jewel {'still exists via another route — further action needed' if path_after else 'is closed ✓'}."
            ),
        }

    # ────────────────────────────────────────────────────────────────────────
    @mcp.tool()
    def recall_incidents(identity: Optional[str] = None, limit: int = 10) -> Dict[str, Any]:
        """
        Retrieve past attack incidents from ARGUS episodic memory.
        Optionally filter by `identity` (entrypoint). Returns most recent first.
        """
        fc = _falkor()
        incidents = fc.engine.recall_incidents(entrypoint=identity, limit=limit)
        return {
            "identity_filter": identity,
            "count": len(incidents),
            "incidents": incidents,
        }

    if hasattr(mcp, "sse_app"):
        return mcp.sse_app()
    if hasattr(mcp, "get_asgi_app"):
        return mcp.get_asgi_app()
    return None


mcp_app = build_mcp_app()
