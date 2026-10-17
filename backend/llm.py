"""
LLM client (Groq or xAI Grok) — OpenAI-compatible chat completions over httpx.

Configure in .env:
    XAI_API_KEY=xai-...
    XAI_MODEL=grok-3-mini          # optional; auto-picked from /v1/models if unset or unavailable
    XAI_BASE_URL=https://api.x.ai/v1

The LLM never decides what is vulnerable. It (1) turns questions into READ-ONLY Cypher
and (2) explains rows that FalkorDB returned. Every entity it names is checked against those rows.
"""
import hashlib
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

import backend.config  # noqa: F401  (loads .env before reading XAI_* vars)

logger = logging.getLogger(__name__)

# Works with any OpenAI-compatible provider. A Groq key (gsk_...) is routed to Groq automatically.
API_KEY = os.getenv("LLM_API_KEY") or os.getenv("GROQ_API_KEY") or os.getenv("XAI_API_KEY", "")
_DEFAULT_BASE = "https://api.groq.com/openai/v1" if API_KEY.startswith("gsk_") else "https://api.x.ai/v1"
BASE_URL = (os.getenv("LLM_BASE_URL") or os.getenv("XAI_BASE_URL") or _DEFAULT_BASE).rstrip("/")
_configured: Optional[str] = os.getenv("LLM_MODEL") or os.getenv("XAI_MODEL") or None
_model: Optional[str] = None
_unusable: set = set()   # models the provider rejected (retired / not found) during this run
PREFERRED_MODELS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b",
                    "moonshotai/kimi-k2-instruct", "grok-3-mini", "grok-4", "llama-3.1-8b-instant"]
CACHE_DIR = Path(os.getenv("LLM_CACHE_DIR", Path(__file__).resolve().parent.parent / ".llm_cache"))
STAGE_MODE = os.getenv("LLM_STAGE_MODE", "false").lower() in ("1", "true", "yes")  # replay cache only

SCHEMA = """Graph schema (FalkorDB, Cypher):
Nodes: (:User {name, department, is_compromised}), (:Role {name, trust_policy}),
       (:Policy {name, effect, actions}), (:Compute {name, type, instance_profile}),
       (:Resource {name, type, sensitivity, is_crown_jewel})
Permission edges (attack direction: whoever controls the source can reach the target):
  (:User)-[:MEMBER_OF]->(:Role)
  (:User|Role)-[:HAS_POLICY {attachment}]->(:Policy)
  (:User|Role|Compute)-[:CAN_ASSUME {technique, granted_by}]->(:Role)
  (:Role)-[:ATTACHED_TO {binding}]->(:Compute)
  (:Role|Policy|Compute)-[:CAN_ACCESS {permission}]->(:Resource)
Memory: (:User)-[:TRIGGERED]->(:Incident {entrypoint, target, hops, path_chain, status, timestamp})-[:TARGETED]->(:Resource)
        (:Incident)-[:REMEDIATED_BY]->(:Remediation {src, dst, type, status})
        (:Remediation)-[:SEVERED_FROM]->(src node), (:Remediation)-[:SEVERED]->(dst node)
        (:Incident)-[:HAS_DECISION]->(:Decision {agent_id, run_id, step, action, reason, score})-[:CHOSE]->(node)
        (:Decision)-[:CONSIDERED {score}]->(node), (:Decision)-[:NEXT]->(:Decision), (:Decision)-[:INFORMED_BY]->(:Incident|Remediation)
Crown jewels: (:Resource {is_crown_jewel: true})
FalkorDB rule: shortestPath() is only allowed in WITH or RETURN, e.g.
  MATCH (u:User {name:'DevIntern'}), (t:Resource {is_crown_jewel:true})
  WITH u, t, shortestPath((u)-[:MEMBER_OF|HAS_POLICY|CAN_ASSUME|ATTACHED_TO|CAN_ACCESS*1..8]->(t)) AS p
  WHERE p IS NOT NULL RETURN u.name, t.name, length(p), [n IN nodes(p) | n.name] ORDER BY length(p)"""

EXAMPLES = [
    ("Which identities can reach a crown jewel?",
     "MATCH (u:User), (t:Resource {is_crown_jewel:true}) WITH u, t, shortestPath((u)-[:MEMBER_OF|HAS_POLICY|CAN_ASSUME|ATTACHED_TO|CAN_ACCESS*1..8]->(t)) AS p WHERE p IS NOT NULL RETURN u.name AS identity, t.name AS target, length(p) AS hops, [n IN nodes(p) | n.name] AS path ORDER BY hops LIMIT 25"),
    ("Who can assume AdminRole?",
     "MATCH (n)-[:CAN_ASSUME]->(r:Role {name:'AdminRole'}) RETURN n.name AS principal, labels(n)[0] AS kind LIMIT 25"),
    ("What past incidents do we have?",
     "MATCH (i:Incident) RETURN i.entrypoint, i.target, i.hops, i.status ORDER BY i.timestamp DESC LIMIT 10"),
    ("Which roles have the most members?",
     "MATCH (u:User)-[:MEMBER_OF]->(r:Role) RETURN r.name AS role, count(u) AS members ORDER BY members DESC LIMIT 10"),
]

WRITE_WORDS = re.compile(r"\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|LOAD|FOREACH)\b", re.I)


def enabled() -> bool:
    return bool(API_KEY) or STAGE_MODE


def _cache_path(payload: Dict[str, Any]) -> Path:
    h = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:24]
    return CACHE_DIR / f"{h}.json"


def _pick_model(client: httpx.Client) -> str:
    """The configured model if the provider still offers it, else the best available one.
    Providers retire models (Groq dropped llama-3.3-70b-versatile), so LLM_MODEL is a preference,
    not a hard requirement."""
    global _model
    if _model and _model not in _unusable:
        return _model
    try:
        r = client.get(f"{BASE_URL}/models", headers={"Authorization": f"Bearer {API_KEY}"}, timeout=10)
        r.raise_for_status()
        ids = [m["id"] for m in r.json().get("data", []) if m["id"] not in _unusable]
        chat_like = [i for i in ids if not any(x in i for x in ("whisper", "guard", "tts", "embed", "playai", "safeguard"))]
        if _configured and _configured in ids:
            _model = _configured
        else:
            if _configured:
                logger.warning(f"LLM_MODEL={_configured} is not offered by {BASE_URL}; picking an available model")
            preferred = [m for m in PREFERRED_MODELS if m in ids]
            _model = (preferred or chat_like or ids)[0]
    except Exception as e:  # pragma: no cover
        fallback = [m for m in ([_configured] if _configured else []) + PREFERRED_MODELS if m and m not in _unusable]
        _model = fallback[0]
        logger.warning(f"Could not list models ({e}); using {_model}")
    logger.info(f"LLM: {BASE_URL} model={_model}")
    return _model


def model_rejected(resp: httpx.Response) -> bool:
    """True when the provider refused the request because of the model itself (retired/unknown)."""
    if resp.status_code == 404:
        return True
    return resp.status_code == 400 and "model" in resp.text.lower() and         any(w in resp.text.lower() for w in ("decommission", "not found", "does not exist", "not supported"))


def reasoning_params(model: str) -> Dict[str, Any]:
    """Keep hidden reasoning short on reasoning models so it can't eat the whole answer budget."""
    return {"reasoning_effort": "low"} if model.startswith("openai/gpt-oss") else {}


def mark_unusable(model: str) -> None:
    """Forget a rejected model so the next _pick_model call chooses another."""
    global _model
    _unusable.add(model)
    if _model == model:
        _model = None
    logger.warning(f"LLM model {model} rejected by provider; switching")


def chat(messages: List[Dict[str, str]], temperature: float = 0.0, max_tokens: int = 700) -> str:
    """One chat completion with on-disk cache (stage mode replays the cache only)."""
    key = {"messages": messages, "temperature": temperature}
    path = _cache_path(key)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))["content"]
    if STAGE_MODE and not API_KEY:
        raise RuntimeError("LLM stage mode: no cached response for this prompt")
    with httpx.Client(timeout=40) as client:
        budget = max_tokens
        for _ in range(3):
            model = _pick_model(client)
            r = client.post(f"{BASE_URL}/chat/completions",
                            headers={"Authorization": f"Bearer {API_KEY}"},
                            json={"model": model, "messages": messages, "temperature": temperature,
                                  "max_tokens": budget, **reasoning_params(model)})
            if model_rejected(r):              # retired model: switch and retry
                mark_unusable(model)
                continue
            r.raise_for_status()
            choice = r.json()["choices"][0]
            content = (choice["message"].get("content") or "").strip()
            # Reasoning models spend hidden tokens first; an empty reply cut off by the budget
            # gets one retry with more room.
            if not content and choice.get("finish_reason") == "length":
                budget *= 3
                continue
            break
    if not content:
        raise RuntimeError(f"LLM returned an empty response (model {model})")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)   # only non-empty answers are cached
    path.write_text(json.dumps({"content": content}), encoding="utf-8")
    return content


def _strip_fences(text: str) -> str:
    m = re.search(r"```(?:cypher)?\s*(.*?)```", text, re.S | re.I)
    return (m.group(1) if m else text).strip().rstrip(";")


def validate_read_only(cypher: str) -> str:
    if WRITE_WORDS.search(cypher):
        raise ValueError("Generated Cypher contains a write clause — refused.")
    if re.search(r"\bCALL\b", cypher, re.I) and not re.search(r"\bCALL\s+algo\.", cypher, re.I):
        raise ValueError("Only algo.* procedures may be called.")
    if not re.search(r"\bLIMIT\s+\d+", cypher, re.I):
        cypher += " LIMIT 50"
    return cypher


def text_to_cypher(question: str, previous_error: Optional[str] = None) -> str:
    shots = "\n\n".join(f"Q: {q}\nCypher: {c}" for q, c in EXAMPLES)
    user = f"{shots}\n\nQ: {question}\nCypher:"
    if previous_error:
        user += f"\n(Your previous attempt failed with: {previous_error}. Fix it.)"
    out = chat([
        {"role": "system", "content": "You translate security questions into ONE read-only Cypher query "
                                      "for FalkorDB. Output only the query, no prose.\n" + SCHEMA},
        {"role": "user", "content": user},
    ])
    cypher = _strip_fences(out)
    if not re.search(r"\b(MATCH|RETURN|CALL|WITH|UNWIND)\b", cypher, re.I):
        raise ValueError("LLM did not return a Cypher query")
    return validate_read_only(cypher)


def narrate(question: str, rows: Any, known_names: List[str]) -> Dict[str, Any]:
    """Explain graph results. Returns answer + which named entities were verified against the rows."""
    rows_json = json.dumps(rows, default=str)[:6000]
    answer = chat([
        {"role": "system", "content": "You are ARGUS, a cloud IAM security analyst. Answer ONLY from the graph "
                                      "results provided. Name identities, roles and resources exactly as they "
                                      "appear. Write paths as A → B → C. If results are empty, say no path was "
                                      "found. Be concise: a verdict line, then the evidence, then one fix."},
        {"role": "user", "content": f"Question: {question}\n\nGraph results (from FalkorDB):\n{rows_json}"},
    ], max_tokens=600)
    mentioned = [n for n in known_names if n and re.search(rf"\b{re.escape(n)}\b", answer)]
    unverified = [n for n in mentioned if n not in rows_json]
    return {"answer": answer, "entities_mentioned": mentioned, "entities_unverified": unverified,
            "grounded": not unverified}
