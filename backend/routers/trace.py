"""
Decision trace router — "decisions you can trace".

Every Red Team hop/backtrack is persisted as a (:Decision) node in FalkorDB:
  (d)-[:CHOSE]->(node), (d)-[:CONSIDERED {score}]->(alt), (d)-[:INFORMED_BY]->(Incident|Remediation),
  (prev)-[:NEXT]->(d), (:Incident)-[:HAS_DECISION]->(d)

GET /api/trace/run/{run_id}
GET /api/trace/incident/{incident_id}
GET /api/trace/latest?entrypoint=DevIntern
"""
from typing import Any, Dict
from fastapi import APIRouter, HTTPException, Query

from backend.db.falkor import falkor_client

router = APIRouter(prefix="/api/trace", tags=["trace"])


def _or_404(trace: Dict[str, Any], what: str) -> Dict[str, Any]:
    if not trace.get("decisions"):
        raise HTTPException(status_code=404, detail=f"No decision trace found for {what}.")
    return trace


@router.get("/run/{run_id}")
def trace_run(run_id: str) -> Dict[str, Any]:
    return _or_404(falkor_client.engine.get_decision_trace(run_id=run_id), f"run '{run_id}'")


@router.get("/incident/{incident_id}")
def trace_incident(incident_id: str) -> Dict[str, Any]:
    return _or_404(falkor_client.engine.get_decision_trace(incident_id=incident_id), f"incident '{incident_id}'")


@router.get("/latest")
def trace_latest(entrypoint: str = Query("DevIntern")) -> Dict[str, Any]:
    g = falkor_client.engine
    inc = g.latest_incident_id(entrypoint)
    if not inc:
        # Nothing recorded yet is a normal state for this identity, not a missing resource.
        return {"run_id": None, "incident_id": None, "decisions": [], "cypher": None}
    return _or_404(g.get_decision_trace(incident_id=inc), f"incident '{inc}'")
