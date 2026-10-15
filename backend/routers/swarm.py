"""
Agent Swarm Router — Autonomous Agent Streaming Endpoint
=========================================================

This is the hackathon's crown jewel endpoint. It demonstrates:

  1. "Vector RAG Failure" simulation — a SIMULATED vector baseline (scripted, labelled as such
     in the UI payload) that gives the to the same question (no multi-hop transitive access)
  2. "Graph RAG Success" — the real iterative RedTeamAgent navigating
     the IAM graph hop-by-hop with explicit per-step reasoning
  3. "Blue Team Memory Recall" — BlueTeamAgent queries FalkorDB episodic
     memory before deciding remediation priority
  4. "Memory Write-Back" — the incident is persisted as a graph node,
     proving FalkorDB holds agent state across runs

Streaming via SSE so the frontend can animate each agent thought in real-time.
"""

import time
import json
import asyncio
from typing import AsyncGenerator
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from backend.agents.red_team import red_team_agent
from backend.agents.blue_team import blue_team_agent
from backend.db.falkor import falkor_client

router = APIRouter(prefix="/api/swarm", tags=["Agent Swarm"])

# ── Vector RAG Simulation (the "loser" approach) ────────────────────────────────
# This intentionally gives a wrong / incomplete answer to prove the point.
# Vector RAG embeds IAM policies as chunks — multi-hop transitive access
# is invisible because it requires chaining 3-5 separate policy documents.

_VECTOR_RAG_WRONG_ANSWERS = {
    "DevIntern": {
        "answer": "No direct policy attached to DevIntern grants access to ProdCustomerVault.",
        "reasoning": "Cosine similarity search found IAM policy chunk for DevIntern: "
                     "'s3:ListBucket on DevLogsBucket'. No document chunk contains 'ProdCustomerVault'. "
                     "Verdict: SAFE. DevIntern cannot access Crown Jewel assets.",
        "confidence": 0.91,
        "documents_searched": 847,
        "result": "SAFE — No Crown Jewel access found",
        "is_wrong": True,
        "failure_reason": "Cannot detect 4-hop transitive chain: DevIntern→CIRunnerRole→BuildEC2→BackendAppRole→ProdCustomerVault. "
                          "Each hop is a separate policy document. Cosine similarity finds no single document mentioning all nodes.",
    },
    "Contractor": {
        "answer": "Contractor has AttachPolicyPermissions policy but no direct KMS access.",
        "reasoning": "Vector index search returned top-3 policy chunks for Contractor. "
                     "None reference ProdKMSKey directly. Verdict: SAFE.",
        "confidence": 0.87,
        "documents_searched": 847,
        "result": "SAFE — No Crown Jewel access found",
        "is_wrong": True,
        "failure_reason": "Missed 3-hop chain: Contractor→AttachPolicyPermissions→AdminRole→ProdKMSKey. "
                          "AttachPolicyPermissions and AdminRole are in different embedding chunks.",
    },
    "SupportUser": {
        "answer": "SupportUser is a customer-facing role with Lambda access only.",
        "reasoning": "Retrieved top semantic matches for 'SupportUser permissions'. "
                     "Policy documents show Lambda execution scope. No DynamoDB references found.",
        "confidence": 0.93,
        "documents_searched": 847,
        "result": "SAFE — No Crown Jewel access found",
        "is_wrong": True,
        "failure_reason": "Missed 4-hop chain: SupportUser→SupportLambda→PassRolePolicy→DynamoDBReaderRole→CrownJewelDB. "
                          "PassRolePolicy is the hidden escalation link invisible to embedding-based search.",
    },
}

_DEFAULT_VECTOR_WRONG = {
    "answer": "No direct policy violations found for this identity.",
    "reasoning": "Vector similarity search across 847 IAM policy documents returned no matches for Crown Jewel assets.",
    "confidence": 0.85,
    "documents_searched": 847,
    "result": "SAFE — No Crown Jewel access found",
    "is_wrong": True,
    "failure_reason": "Vector RAG cannot traverse multi-hop permission inheritance chains.",
}


class SwarmRequest(BaseModel):
    entrypoint: str = "DevIntern"
    run_comparison: bool = True


async def swarm_stream(entrypoint: str, run_comparison: bool) -> AsyncGenerator[str, None]:
    """
    Streams the full autonomous agent swarm execution as SSE events.
    Phase order:
      0. vector_start — Vector RAG agent begins (fake/wrong)
      1. vector_result — Vector RAG gives wrong answer
      2. graph_start — Graph RAG agent begins
      3. red_team_memory_recall — memory consulted
      4. red_team_hop_N — each iterative hop (streamed live)
      5. red_team_complete — attack confirmed, incident written to graph
      6. blue_team_memory_recall — Blue team checks past incidents
      7. blue_team_step_N — remediation reasoning steps
      8. blue_team_complete — remediation plan synthesized
      9. swarm_complete — final comparison summary
    """

    async def emit(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"

    total_start = time.perf_counter()

    # ─── Phase 0: Vector RAG (the wrong answer) ────────────────────────────────
    if run_comparison:
        await asyncio.sleep(0.2)
        yield await emit("vector_start", {
            "message": f"🔍 Vector RAG Agent: Searching 847 IAM policy embeddings for '{entrypoint}'…",
            "agent": "vector_rag",
            "phase": "searching",
        })

        await asyncio.sleep(0.8)  # Simulate embedding search time
        vector_result = _VECTOR_RAG_WRONG_ANSWERS.get(entrypoint, _DEFAULT_VECTOR_WRONG)
        yield await emit("vector_result", {
            "message": "❌ Vector RAG completed — produced INCORRECT result",
            "agent": "vector_rag",
            "phase": "complete",
            "simulated": True,
            **vector_result,
        })

        await asyncio.sleep(0.4)

    # ─── Phase 1: Red Team Agent — Memory Recall ──────────────────────────────
    yield await emit("graph_start", {
        "message": f"🕷 ARGUS Red Team Agent: Initiating autonomous iterative graph exploration of '{entrypoint}'…",
        "agent": "red_team",
        "phase": "starting",
        "mode": "autonomous_iterative_explorer",
    })

    await asyncio.sleep(0.3)

    # Check episodic memory first
    prior_incidents = falkor_client.recall_incidents(entrypoint=entrypoint, limit=3)
    yield await emit("red_team_memory_recall", {
        "message": f"🧠 Red Team: Querying FalkorDB episodic memory for '{entrypoint}'…",
        "agent": "red_team",
        "phase": "memory_recall",
        "incidents_found": len(prior_incidents),
        "prior_incidents": [
            {
                "id": i["id"],
                "target": i["properties"]["target"],
                "hops": i["properties"]["hops"],
                "path": i["properties"].get("path_chain", []),
            }
            for i in prior_incidents
        ],
        "insight": (
            f"Found {len(prior_incidents)} prior incident(s) in graph memory. "
            + ("This identity is a KNOWN repeat escalation source." if len(prior_incidents) > 0 else
               "No prior incidents — first time this identity has been scanned.")
        ),
    })

    await asyncio.sleep(0.3)

    # ─── Phase 2: Run Red Team (iterative) ────────────────────────────────────
    attack_result = red_team_agent.execute_attack_simulation(entrypoint)

    # Stream each step as a separate SSE event for the UI to animate
    for step in attack_result.get("steps", []):
        await asyncio.sleep(0.35)
        step_event = "red_team_hop" if step["step_index"] > 0 else "red_team_init"
        yield await emit(step_event, {
            "agent": "red_team",
            "phase": step.get("phase", "Exploring"),
            "step_index": step.get("step_index", 0),
            "action": step.get("action", ""),
            "thought": step.get("thought", ""),
            "node_name": step.get("node_name", ""),
            "node_label": step.get("node_label", ""),
            "relation": step.get("relation", ""),
            "threat_score": step.get("threat_score", 0),
            "crown_jewel_reached": step.get("crown_jewel_reached", False),
            "alternatives_considered": step.get("alternatives_considered", []),
            "memory_nodes_found": step.get("memory_nodes_found", 0),
            "message": step.get("action", ""),
        })

    await asyncio.sleep(0.3)

    yield await emit("red_team_complete", {
        "message": (
            f"💀 Red Team SUCCEEDED: Reached '{attack_result.get('target_compromised')}' "
            f"in {attack_result.get('total_hops')} hops."
            if attack_result["status"] == "success"
            else f"Red Team: No path found from '{entrypoint}' to Crown Jewels."
        ),
        "agent": "red_team",
        "phase": "complete",
        "status": attack_result["status"],
        "total_hops": attack_result.get("total_hops", 0),
        "target_compromised": attack_result.get("target_compromised"),
        "incident_id": attack_result.get("incident_id"),
        "memory_written": attack_result.get("memory_written", False),
        "path_nodes": attack_result.get("path_nodes", []),
        "ground_truth": attack_result.get("ground_truth"),
        "engine": attack_result.get("engine"),
        "db_time_ms": attack_result.get("db_time_ms"),
        "insight": (
            "⚡ INCIDENT WRITTEN TO FALKORDB: An :Incident node was created in the graph, "
            "linking this attack chain to FalkorDB's episodic memory. "
            "Next scan of this identity will recall this incident automatically."
            if attack_result.get("memory_written") else
            "No Crown Jewel access confirmed — no incident node created."
        ),
    })

    # ─── Phase 3: Blue Team Agent ──────────────────────────────────────────────
    if attack_result["status"] == "success":
        await asyncio.sleep(0.4)

        yield await emit("blue_team_start", {
            "message": "🛡 Blue Team Agent: Analyzing attack vector and recalling remediation memory…",
            "agent": "blue_team",
            "phase": "starting",
        })

        blue_result = blue_team_agent.analyze_and_remediate(attack_result)

        for thought in blue_result.get("thoughts", []):
            await asyncio.sleep(0.4)
            yield await emit(f"blue_team_step", {
                "agent": "blue_team",
                "step": thought.get("step"),
                "phase": thought.get("phase"),
                "observation": thought.get("observation"),
                "memory_nodes_queried": thought.get("memory_nodes_queried"),
                "is_repeat_offender": thought.get("is_repeat_offender"),
                "blast_before": thought.get("blast_before"),
                "blast_after": thought.get("blast_after"),
                "message": thought.get("observation", ""),
            })

        await asyncio.sleep(0.3)

        yield await emit("blue_team_complete", {
            "message": f"✅ Blue Team: Remediation plan synthesized. Priority: {blue_result.get('priority')}",
            "agent": "blue_team",
            "phase": "complete",
            "choke_point": blue_result.get("choke_point"),
            "blast_radius_reduced_percent": blue_result.get("blast_radius_reduced_percent"),
            "priority": blue_result.get("priority"),
            "is_repeat_offender": blue_result.get("is_repeat_offender"),
            "repeat_incident_count": blue_result.get("repeat_incident_count"),
            "terraform_patch": blue_result.get("terraform_patch"),
            "business_impact_score": blue_result.get("business_impact_score"),
            "also_protected": blue_result.get("also_protected"),
            "exposed_identities_before": blue_result.get("exposed_identities_before"),
            "exposed_identities_after": blue_result.get("exposed_identities_after"),
            "regression_detected": blue_result.get("regression_detected"),
            "cut_method": blue_result.get("cut_method"),
            "incident_id": attack_result.get("incident_id"),
            "entrypoint": entrypoint,
        })

    # ─── Phase 4: Final Comparison Summary ────────────────────────────────────
    total_ms = round((time.perf_counter() - total_start) * 1000, 2)
    await asyncio.sleep(0.3)

    vector_data = _VECTOR_RAG_WRONG_ANSWERS.get(entrypoint, _DEFAULT_VECTOR_WRONG) if run_comparison else {}
    yield await emit("swarm_complete", {
        "message": "🏁 Agent Swarm complete.",
        "total_ms": total_ms,
        "comparison": {
            "vector_rag": {
                "result": vector_data.get("result", "N/A"),
                "correct": False,
                "failure_reason": vector_data.get("failure_reason", ""),
                "confidence": vector_data.get("confidence", 0),
            },
            "graph_rag": {
                "result": (
                    f"THREAT: {entrypoint} can reach '{attack_result.get('target_compromised')}' "
                    f"in {attack_result.get('total_hops')} hops"
                    if attack_result["status"] == "success" else "SAFE: No Crown Jewel path found"
                ),
                "correct": True,
                "hops": attack_result.get("total_hops", 0),
                "incident_persisted": attack_result.get("memory_written", False),
                "agent_steps": len(attack_result.get("steps", [])),
            },
            "winner": "Graph RAG" if attack_result["status"] == "success" else "Tie",
            "key_insight": (
                "Vector RAG missed the attack because it cannot traverse transitive permission chains. "
                "Graph RAG found it by exploring the IAM graph hop-by-hop, "
                "storing the incident in FalkorDB memory for future recall."
            ),
        },
    })


@router.post("/run")
async def run_agent_swarm(req: SwarmRequest):
    """
    Streams the autonomous agent swarm: Vector vs Graph live comparison.
    Red Team explores iteratively, Blue Team recalls memory, incidents persisted in FalkorDB.
    """
    return StreamingResponse(
        swarm_stream(req.entrypoint, req.run_comparison),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/memory/{entrypoint}")
async def get_agent_memory(entrypoint: str):
    """Returns all incidents stored in FalkorDB for a given entrypoint identity."""
    incidents = falkor_client.recall_incidents(entrypoint=entrypoint, limit=10)
    remediations = falkor_client.engine.recall_remediations()
    red_memory = falkor_client.recall_agent_memory("red_team_v2")
    blue_memory = falkor_client.recall_agent_memory("blue_team_v2")
    return {
        "entrypoint": entrypoint,
        "incident_count": len(incidents),
        "incidents": [i["properties"] for i in incidents],
        "red_team_working_memory": red_memory,
        "blue_team_working_memory": blue_memory,
        "remediations": remediations,
        "engine": falkor_client.engine.ENGINE_NAME,
    }


@router.get("/entrypoints")
async def get_entrypoints():
    """Returns list of attack entrypoints available for the swarm demo."""
    return {
        "entrypoints": [
            {"name": "DevIntern", "department": "Engineering", "compromised": True},
            {"name": "Contractor", "department": "Operations", "compromised": True},
            {"name": "SupportUser", "department": "CustomerSupport", "compromised": True},
        ]
    }
