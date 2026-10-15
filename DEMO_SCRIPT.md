# ARGUS — 3-Minute Demo Script

> **Total runtime target: 2:50 – 3:00**
> Record at 1920×1080, 30 fps. Narrate live or use subtitles.

---

## [0:00 – 0:20] Cold Open — The Problem

**Screen:** Dashboard (home tab, full-screen app)

**Narration:**
> "Your cloud has 174 IAM identities, 244 permission edges, and somewhere inside
> that graph there is a path that lets a low-privilege developer intern reach your
> production KMS key — your Crown Jewel. Finding it with a Vector RAG chatbot is
> slow, hallucination-prone, and can't follow transitive trust.
> ARGUS does it in under a millisecond using FalkorDB."

*Point at the five stat cards: nodes, edges, crown jewels, critical findings, latency.*

---

## [0:20 – 0:50] Red Team — Graph Exploration

**Screen:** Click "Investigate" tab → pick "DevIntern" → click "Run Attack" in navbar

**Narration:**
> "The Red Team agent starts at DevIntern and explores the permission graph
> hop by hop — one Cypher neighbour query per step, best-first with backtracking.
> Watch the right panel: each hop is a deliberate decision logged into FalkorDB as AgentMemory."

*Let the attack animation run. Call out 2–3 interesting hops as they appear:*
- "DevIntern is a member of the DataAccessRole…"
- "DataAccessRole has a policy that can assume ProductionRole…"
- "ProductionRole can access ProdKMSKey — Crown Jewel reached."

**Narration:**
> "Four hops, 0.44 ms average per query. FalkorDB resolves transitive IAM paths
> in sub-millisecond time — impossible with embedding-based retrieval."

---

## [0:50 – 1:20] Blue Team — Graph Memory

**Screen:** In the right panel, click "Propose Remediation" then "Apply Fix in FalkorDB"

**Narration:**
> "The Blue Team agent computes the minimum edge cut — the single permission edge
> whose removal breaks every path to the Crown Jewel with the least collateral damage.
> It severs that edge with a Cypher DELETE and writes a Remediation node to the graph."

*Watch the severed edge disappear from the canvas. The engine re-verifies.*

**Narration:**
> "FalkorDB now holds memory: a `:Remediation` node linked to the severed relationship.
> The next Red Team run will recall this, skip the closed path, and either find
> an alternative route or declare the identity contained."

*Press "Run Attack" again — show the agent taking a different (or failed) path.*

---

## [1:20 – 1:50] Triage — N Findings, The Few That Matter

**Screen:** Click "Triage" tab

**Narration:**
> "ARGUS scores every permission edge across four dimensions: crown-jewel reachability,
> destination type, betweenness centrality, and blast radius.
> The headline tells you how many total findings collapse to the ones that actually matter."

*Point at the CRITICAL count, then expand one finding to show the impact score breakdown.*

**Narration:**
> "Click any finding to see the full attack path, the recommended remediation,
> and — for chokepoints — the betweenness score from `algo.betweenness`."

*Toggle the chokepoints panel to show ranked nodes.*

---

## [1:50 – 2:20] LLM Agent — Tool-Calling Over the Graph

**Screen:** Click "Agent" tab → select "BackendEngineer" → click "Run Agent"

**Narration:**
> "The ARGUS LLM agent — powered by Groq's llama-3.3-70b-versatile — runs a
> tool-calling loop over five graph tools. Watch it recall past incidents,
> triage findings, explain the attack path, and propose a fix."

*Let 3–4 SSE events stream in:*
- `recall_incidents` → green card
- `triage_findings` → yellow card
- `explain_path` → cyan card
- `propose_fix` → purple card

*Watch the verdict box appear at the bottom.*

**Narration:**
> "Every tool call is a deterministic Cypher query — no hallucination.
> The agent can optionally apply the fix live in FalkorDB with auto-apply."

---

## [2:20 – 2:40] Ask (Copilot) — Text-to-Cypher

**Screen:** Click "Ask" tab → type: "Which users can reach a crown jewel in 3 hops?"

**Narration:**
> "The Copilot tab lets anyone query the graph in plain English.
> The LLM generates a read-only Cypher query — write clauses are blocked by a guard —
> and runs it against FalkorDB. The answer comes back with the raw rows
> and a plain-English explanation."

*Show the result rows and the auto-generated Cypher.*

---

## [2:40 – 3:00] MCP + Closing

**Screen:** Switch to terminal / show `curl http://localhost:8001/mcp`
*(or show the /docs page listing the MCP endpoint)*

**Narration:**
> "ARGUS also exposes all five tools as a Model Context Protocol server
> at `/mcp` — so any MCP-compatible agent or IDE can call triage, explain,
> propose, apply, and recall directly."

*Back to dashboard — pause on the stat cards.*

**Narration:**
> "FalkorDB turns a cloud IAM permission graph into a cognitive brain:
> agents explore it, write memory into it, read that memory back, and close
> attack paths — all in sub-millisecond Cypher.
> This is ARGUS."

---

## Recording Checklist

- [ ] FalkorDB running (`docker compose up -d falkordb`)
- [ ] Backend running (`uvicorn backend.main:app --reload --port 8001`)
- [ ] Frontend running (`cd frontend && npm run dev`)
- [ ] LLM_API_KEY set in `.env` and Groq quota available
- [ ] Graph freshly seeded (`GET /api/graph/reseed` or restart backend)
- [ ] Screen resolution 1920×1080, browser zoom 100%
- [ ] Microphone tested, background noise suppressed
- [ ] OBS or QuickTime ready to record

## Key talking points to hit

1. **Sub-millisecond Cypher** vs Vector RAG latency
2. **Transitive trust** — impossible for embeddings to reason about
3. **Write-back episodic memory** — Incident + Remediation nodes persist across sessions
4. **Deterministic** — no hallucination, exact graph paths
5. **MCP server** — composable with any LLM agent framework
