"""
Autonomous LLM agent loop — tool-calling over ARGUS graph tools.

POST /api/agent/run          — one-shot run, returns full trace
GET  /api/agent/stream       — SSE stream of tool calls + reasoning
GET  /api/agent/stream?identity=DevIntern&auto_apply=false

The agent is given 5 tools:
  triage_findings    — ranked permission-edge findings
  explain_path       — shortest attack path for an identity
  propose_fix        — blue-team min-cut recommendation
  apply_fix          — sever the choke-point edge in FalkorDB
  recall_incidents   — episodic memory of past attacks

It runs a Groq tool-calling loop (llama-3.3-70b-versatile), streaming
each step as an SSE event so the UI can render it live.
"""
import json
import logging
import time
from typing import Any, Dict, Generator, List, Optional

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from backend.db.falkor import falkor_client
import backend.llm as llm_module

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agent", tags=["agent"])

# ─── Tool schemas (Groq / OpenAI function-calling format) ────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "triage_findings",
            "description": (
                "Scan every permission edge in the IAM graph and return findings ranked by graph impact. "
                "Always call this first to understand the attack surface."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "max_findings": {
                        "type": "integer",
                        "description": "Maximum findings to return (default 10 for speed).",
                        "default": 10,
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explain_path",
            "description": (
                "Find the shortest attack path from an identity to any Crown Jewel resource. "
                "Returns the hop chain, blast radius, and risk score."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "identity": {
                        "type": "string",
                        "description": "Name of the IAM identity (User node) to start from.",
                    }
                },
                "required": ["identity"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_fix",
            "description": (
                "Run the Blue Team agent to find the minimum-cost edge to sever that "
                "closes all paths from an identity to Crown Jewels."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "identity": {
                        "type": "string",
                        "description": "Name of the IAM identity to protect against.",
                    }
                },
                "required": ["identity"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "apply_fix",
            "description": (
                "Permanently remove a permission edge from FalkorDB and verify the attack path is closed. "
                "Only call this when the user has confirmed they want the fix applied."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "source_name": {
                        "type": "string",
                        "description": "Source node name of the edge to remove.",
                    },
                    "target_name": {
                        "type": "string",
                        "description": "Target node name of the edge to remove.",
                    },
                },
                "required": ["source_name", "target_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "recall_incidents",
            "description": (
                "Retrieve past attack incidents from ARGUS episodic memory (stored as graph nodes). "
                "Use this to check if an identity has been seen before."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "identity": {
                        "type": "string",
                        "description": "Filter by entrypoint identity (optional).",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max incidents to return.",
                        "default": 5,
                    },
                },
                "required": [],
            },
        },
    },
]

SYSTEM_PROMPT = """\
You are ARGUS, an autonomous cloud IAM security analyst powered by FalkorDB.
Your job: given an IAM environment, find the riskiest attack paths and propose fixes.

Workflow — follow this order:
1. recall_incidents — check what ARGUS already knows about past attacks.
2. triage_findings — scan all permission edges ranked by impact. Focus on CRITICAL findings.
3. explain_path — for the top CRITICAL identity, trace the exact attack chain.
4. propose_fix — get the Blue Team's minimum-cut recommendation.
5. If auto_apply is true: apply_fix with the choke point from propose_fix.
6. Give a concise final verdict: what was found, what was fixed, what remains.

Rules:
- Ground every claim in tool outputs. Name entities exactly as the graph returns them.
- Write paths as: Identity → Role → Policy → Resource.
- Be terse: one verdict line, then evidence, then fix. No fluff.
- If a path was already remediated in a prior incident, say so and move on.
"""


# ─── Tool execution ─────────────────────────────────────────────────────────

def _execute_tool(name: str, args: Dict[str, Any], auto_apply: bool) -> Any:
    from backend.routers.triage import get_findings
    from backend.agents.red_team import RedTeamAgent
    from backend.agents.blue_team import BlueTeamAgent

    if name == "triage_findings":
        result = get_findings(max_findings=args.get("max_findings", 10))
        # Slim down for LLM context window
        slim = {
            "headline": result["headline"],
            "severity_counts": result["severity_counts"],
            "top_findings": [
                {k: f[k] for k in ("src", "rel_type", "dst", "severity", "impact_score",
                                    "src_reaches_crown_jewel", "recommendation")}
                for f in result["findings"][:10]
            ],
        }
        return slim

    if name == "explain_path":
        identity = args["identity"]
        path = falkor_client.engine.find_shortest_path(identity)
        if not path:
            return {"identity": identity, "path_found": False, "message": "No path to Crown Jewels."}
        names = [n["properties"].get("name", n.get("id")) for n in path]
        blast = falkor_client.engine.compute_blast_radius(identity)
        return {
            "identity": identity,
            "path_found": True,
            "hops": len(path) - 1,
            "path_chain": names,
            "target": names[-1],
            "risk_level": blast["risk_level"],
            "blast_radius": blast["reachable_nodes_count"],
            "crown_jewels": blast["crown_jewels_count"],
        }

    if name == "propose_fix":
        identity = args["identity"]
        agent = RedTeamAgent(falkor_client)
        red = agent.execute_attack_simulation(identity, record_incident=False)
        if red.get("status") != "success":
            return {"identity": identity, "fix_needed": False, "message": "No attack path found."}
        blue_agent = BlueTeamAgent(falkor_client)
        blue = blue_agent.analyze_and_remediate(red)
        cp = blue.get("choke_point")
        if not cp:
            return {"identity": identity, "fix_needed": True, "choke_point": None,
                    "message": "Could not isolate a single chokepoint."}
        return {
            "identity": identity,
            "fix_needed": True,
            "choke_point": cp,
            "collateral_score": blue.get("collateral_pairs_lost", 0),
            "also_protected": blue.get("also_protected", []),
            "priority": blue.get("priority", "P1 Standard"),
            "explanation": (
                f"Remove {cp.get('relation','edge')} from {cp['source_name']} → {cp['target_name']}. "
                f"Collateral: {blue.get('collateral_pairs_lost', 0)} legitimate access pairs lost. "
                f"Also protects: {', '.join(blue.get('also_protected', [])) or 'none'}."
            ),
        }

    if name == "apply_fix":
        if not auto_apply:
            return {"skipped": True, "reason": "auto_apply=false — user must confirm before applying fixes."}
        src, dst = args["source_name"], args["target_name"]
        removed = falkor_client.engine.remove_edge(src, dst)
        if not removed:
            return {"success": False, "message": f"No edge found: {src} → {dst}"}
        path_after = falkor_client.engine.find_shortest_path(src)
        rem_id = falkor_client.engine.store_remediation({
            "src": src, "dst": dst,
            "rel_type": removed[0]["type"],
            "edge_properties": removed[0].get("properties", {}),
            "verified": path_after is None,
        })
        return {
            "success": True,
            "removed": removed,
            "path_still_open": path_after is not None,
            "remediation_id": rem_id,
            "verdict": "Path closed ✓" if not path_after else "Path still open via another route — further action needed.",
        }

    if name == "recall_incidents":
        incidents = falkor_client.engine.recall_incidents(
            entrypoint=args.get("identity"), limit=args.get("limit", 5)
        )
        return {
            "count": len(incidents),
            "incidents": [
                {
                    "id": i.get("id", i.get("properties", {}).get("id")),
                    "entrypoint": (i.get("properties", {}) or {}).get("entrypoint"),
                    "target": (i.get("properties", {}) or {}).get("target"),
                    "hops": (i.get("properties", {}) or {}).get("hops"),
                    "status": (i.get("properties", {}) or {}).get("status"),
                    "severity": (i.get("properties", {}) or {}).get("severity"),
                    "choke_point": f"{(i.get('properties', {}) or {}).get('choke_source')} -> {(i.get('properties', {}) or {}).get('choke_target')}" if (i.get('properties', {}) or {}).get('choke_source') else None,
                }
                for i in incidents
            ],
        }

    return {"error": f"Unknown tool: {name}"}


# ─── Core loop ───────────────────────────────────────────────────────────────

def _run_agent_loop(
    identity: Optional[str],
    auto_apply: bool,
    max_turns: int = 8,
) -> Generator[str, None, None]:
    """Yields SSE-formatted lines."""

    def sse(obj: Dict[str, Any]) -> str:
        return f"data: {json.dumps(obj)}\n\n"

    yield sse({"type": "start", "identity": identity, "auto_apply": auto_apply,
               "ts": round(time.time() * 1000)})

    if not llm_module.enabled():
        yield sse({"type": "error", "message": "LLM not configured — set LLM_API_KEY in .env"})
        return

    system_msg = SYSTEM_PROMPT
    if identity:
        system_msg += f"\n\nFocus on identity: {identity}"
    if auto_apply:
        system_msg += "\nauto_apply=true: you MAY call apply_fix after proposing a fix."
    else:
        system_msg += "\nauto_apply=false: do NOT call apply_fix — just propose."

    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": system_msg},
        {"role": "user", "content": (
            f"Analyse the IAM graph{' focusing on identity: ' + identity if identity else ''}. "
            "Follow your workflow and give a final verdict."
        )},
    ]

    with httpx.Client(timeout=60) as client:
        model = llm_module._pick_model(client)
        turn = 0

        while turn < max_turns:
            turn += 1
            yield sse({"type": "thinking", "turn": turn})

            resp = None
            for attempt in range(3):
                try:
                    resp = client.post(
                        f"{llm_module.BASE_URL}/chat/completions",
                        headers={"Authorization": f"Bearer {llm_module.API_KEY}"},
                        json={
                            "model": model,
                            "messages": messages,
                            "tools": TOOLS,
                            "tool_choice": "auto",
                            "temperature": 0.0,
                            "max_tokens": 800,
                        },
                    )
                    if resp.status_code == 429 and attempt < 2:
                        time.sleep(2.0 * (attempt + 1))
                        continue
                    resp.raise_for_status()
                    break
                except Exception as e:
                    if attempt == 2 or (isinstance(e, httpx.HTTPStatusError) and e.response.status_code != 429):
                        yield sse({"type": "error", "message": str(e)})
                        return
                    time.sleep(2.0)
            if not resp or resp.status_code >= 400:
                yield sse({"type": "error", "message": f"LLM request failed: {resp.status_code if resp else 'no response'}"})
                return

            choice = resp.json()["choices"][0]
            msg = choice["message"]
            finish = choice.get("finish_reason", "")

            # Add assistant message to history
            messages.append(msg)

            # ── Pure text response → final verdict ──────────────────────────
            if finish == "stop" or not msg.get("tool_calls"):
                content = msg.get("content") or ""
                yield sse({"type": "verdict", "content": content, "turn": turn})
                break

            # ── Tool calls ──────────────────────────────────────────────────
            for tc in msg.get("tool_calls", []):
                fn = tc["function"]
                tool_name = fn["name"]
                try:
                    args = json.loads(fn.get("arguments", "{}"))
                except json.JSONDecodeError:
                    args = {}

                yield sse({"type": "tool_call", "tool": tool_name, "args": args, "turn": turn})

                t0 = time.perf_counter()
                try:
                    result = _execute_tool(tool_name, args, auto_apply)
                    elapsed = round((time.perf_counter() - t0) * 1000, 1)
                    yield sse({"type": "tool_result", "tool": tool_name,
                               "result": result, "elapsed_ms": elapsed})
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps(result, default=str),
                    })
                except Exception as e:
                    yield sse({"type": "tool_error", "tool": tool_name, "error": str(e)})
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps({"error": str(e)}),
                    })
        else:
            yield sse({"type": "error", "message": f"Agent loop hit max_turns ({max_turns}) without a verdict."})

    yield sse({"type": "done", "ts": round(time.time() * 1000)})


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/stream")
def agent_stream(
    identity: Optional[str] = Query(None, description="IAM identity to focus on"),
    auto_apply: bool = Query(False, description="If true, the agent will apply the fix in FalkorDB"),
):
    """SSE stream of the agent loop — tool calls, reasoning, verdict."""
    return StreamingResponse(
        _run_agent_loop(identity, auto_apply),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/run")
def agent_run(
    identity: Optional[str] = Query(None),
    auto_apply: bool = Query(False),
):
    """Non-streaming: collect all events and return as a list."""
    events = list(_run_agent_loop(identity, auto_apply))
    parsed = []
    for e in events:
        line = e.strip()
        if line.startswith("data: "):
            try:
                parsed.append(json.loads(line[6:]))
            except json.JSONDecodeError:
                pass
    return {"events": parsed, "turns": sum(1 for e in parsed if e.get("type") == "tool_call")}
