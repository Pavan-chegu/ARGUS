# ARGUS — 3-Minute Demo Script

> **Total runtime target: 2:50 – 3:00**
> Record at 1920×1080, 30 fps. Narrate live or use subtitles.

---

## [0:00 – 0:20] Cold Open — The Problem

**Screen:** Dashboard (home tab, full-screen app)

**Narration:**
> "Imagine you're a cloud security engineer. Your company has hundreds of users,
> roles, and services — and somewhere buried in that mess, a junior intern has
> a hidden chain of permissions that leads straight to your most sensitive data.
> A normal chatbot can't find it. It would need to follow chains of trust across
> multiple hops — and that's exactly what ARGUS does, in under a millisecond,
> using a graph database called FalkorDB."

*Point at the five stat cards: nodes, edges, crown jewels, critical findings, latency.*

---

## [0:20 – 0:50] Red Team — Graph Exploration

**Screen:** Click "Investigate" tab → pick "DevIntern" → click "Run Attack"

**Narration:**
> "Let's say we're an attacker starting as DevIntern — the lowest privilege user.
> Our Red Team agent explores the permission graph one hop at a time,
> and every single step is a real query against FalkorDB."

*Let the attack animation run. Call out 2–3 interesting hops as they appear:*

> "DevIntern can assume a CI runner role…
> that role is tied to a build server… which can assume a backend role…
> and that backend role can read the production secrets vault. Crown Jewel reached."

**Narration:**
> "Four hops. Each one took less than a millisecond.
> You can see the actual query time on screen — that's FalkorDB, not an approximation."

---

## [0:50 – 1:20] Blue Team — Graph Memory

**Screen:** In the right panel, click "Propose Remediation" then "Apply Fix in FalkorDB"

**Narration:**
> "Now the Blue Team kicks in. It figures out the single weakest link in that chain —
> the one permission that, if removed, blocks every path to the crown jewel
> with the least side effects. One click, and that edge is gone."

*Watch the severed edge disappear. The engine re-verifies.*

**Narration:**
> "Here's the key part — FalkorDB remembers this fix. It writes a Remediation node
> directly into the graph. So the next time our Red Team agent runs,
> it recalls what was fixed and checks whether it's still fixed."

*Press "Run Attack" again. Show the agent failing to reach the jewel.*

> "See? The attack can't get through anymore. And if someone accidentally
> re-adds that permission, ARGUS catches the regression."

*Open the **Decision Trail** tab to show the full audit trail.*

---

## [1:20 – 1:50] Triage — Cut Through the Noise

**Screen:** Click "Triage" tab

**Narration:**
> "In a real cloud, you'd have hundreds of findings. Most of them don't matter.
> ARGUS scores every risky permission across four dimensions — can it reach
> sensitive data, what kind of resource is it, how central is it in the graph,
> and how much damage would it cause."

*Point at the CRITICAL count, then expand one finding.*

**Narration:**
> "So instead of 200 alerts, you get the 5 that actually matter.
> Click any one to see the full attack path and the recommended fix."

*Toggle the chokepoints panel to show ranked nodes.*

---

## [1:50 – 2:20] LLM Agent — AI That Uses the Graph

**Screen:** Click "Agent" tab → select "BackendEngineer" → click "Run Agent"

**Narration:**
> "This is where it gets interesting. ARGUS has an LLM agent that doesn't
> just chat — it has tools. It can query the graph, recall past incidents,
> triage findings, explain attack paths, and propose fixes.
> Watch it work."

*Let 3–4 SSE tool call cards stream in.*

**Narration:**
> "Every single tool call you just saw is a real Cypher query against FalkorDB.
> There's no hallucination here — the LLM decides what to ask,
> but the graph gives the answer."

---

## [2:20 – 2:40] Ask (Copilot) — Plain English Queries

**Screen:** Click "Ask" tab → type: "Which users can reach a crown jewel in 3 hops?"

**Narration:**
> "And for anyone who doesn't want to write code — just ask in plain English.
> The copilot translates your question into a graph query, runs it,
> and gives you back real results with an explanation.
> Write queries are blocked automatically, so it's safe to let anyone use."

*Show the result rows and the auto-generated Cypher.*

---

## [2:40 – 3:00] MCP + Closing

**Screen:** Switch to terminal / show `curl http://localhost:8001/mcp`
*(or show the /docs page listing the MCP endpoint)*

**Narration:**
> "One more thing — all of these agent tools are exposed as an MCP server.
> That means any compatible AI agent or IDE can plug into ARGUS
> and use its graph intelligence directly."

*Back to dashboard — pause on the stat cards.*

**Narration:**
> "FalkorDB isn't just storage here — it's the brain.
> Agents explore it. They write memories into it. They read those memories back.
> And they close attack paths — all in sub-millisecond time.
> This is ARGUS."

---

## Recording Checklist

- [ ] FalkorDB running (`docker compose up -d falkordb`)
- [ ] ARGUS app running (`docker compose up -d` or dev mode)
- [ ] LLM_API_KEY set in `.env` and Groq quota available
- [ ] Graph freshly seeded (`POST /api/graph/reseed`)
- [ ] Screen resolution 1920×1080, browser zoom 100 %
- [ ] Microphone tested, background noise suppressed
- [ ] Recording tool ready (Loom / OBS / Xbox Game Bar)

## Key talking points to hit

1. **Sub-millisecond graph queries** — real measured times on screen
2. **Chain-of-trust reasoning** — following multi-hop permission paths, not keyword matching
3. **Graph memory** — agents write Remediation nodes, recall them next run
4. **No hallucination** — LLM picks the tool, but FalkorDB gives the answer
5. **MCP server** — plug ARGUS into any AI agent or IDE
