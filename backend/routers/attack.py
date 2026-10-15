from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional
from backend.agents.red_team import red_team_agent
from backend.agents.blue_team import blue_team_agent

router = APIRouter(prefix="/api/simulate", tags=["Agent Simulations & Attacks"])

class AttackRequest(BaseModel):
    entrypoint: str = "DevIntern"

class RemediateRequest(BaseModel):
    attack_result: Dict[str, Any]

class ApplyRemediationRequest(BaseModel):
    source_name: str
    target_name: str
    entrypoint: Optional[str] = None
    incident_id: Optional[str] = None

@router.post("/attack")
def run_red_team_attack(req: AttackRequest) -> Dict[str, Any]:
    """Triggers Red Team Attacker Agent to discover multi-hop escalation path."""
    return red_team_agent.execute_attack_simulation(req.entrypoint)

@router.post("/remediate")
def run_blue_team_analysis(req: RemediateRequest) -> Dict[str, Any]:
    """Triggers Blue Team Remediator Agent to compute choke point & Terraform patch."""
    return blue_team_agent.analyze_and_remediate(req.attack_result)

@router.post("/apply-patch")
def apply_remediation_patch(req: ApplyRemediationRequest) -> Dict[str, Any]:
    """Severs the choke point edge in FalkorDB and verifies path closure."""
    return blue_team_agent.apply_remediation_cypher(req.source_name, req.target_name,
                                                    req.entrypoint, req.incident_id)

@router.post("/undo-patch")
def undo_remediation_patch(req: ApplyRemediationRequest) -> Dict[str, Any]:
    """Restores a previously revoked edge from its :Remediation node (for demo resets / drift tests)."""
    return blue_team_agent.undo_remediation(req.source_name, req.target_name)
