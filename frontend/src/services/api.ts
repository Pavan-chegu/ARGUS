const API_BASE = '/api';

export interface GraphNode {
  id: string;
  name: string;
  label: string;
  sensitivity?: string;
  is_crown_jewel?: boolean;
  department?: string;
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  type: string;
  properties?: Record<string, any>;
}

export interface GraphTopology {
  nodes: GraphNode[];
  links: GraphLink[];
  count_nodes: number;
  count_links: number;
}

export interface RedTeamStep {
  step_index: number;
  phase: string;
  action: string;
  node_id: string;
  thought: string;
  crown_jewel_reached?: boolean;
  regression?: boolean;
}

export interface RedTeamAttackResult {
  status: 'success' | 'failed';
  message?: string;
  entrypoint: string;
  target_compromised: string;
  total_hops: number;
  execution_time_ms: number;
  cypher_executed: string;
  path_nodes: GraphNode[];
  steps: RedTeamStep[];
  run_id?: string | null;
  incident_id?: string | null;
}

export interface BlueTeamRemediationResult {
  status: 'success' | 'error';
  message?: string;
  detail?: string;
  choke_point?: {
    source_id: string;
    source_name: string;
    source_type: string;
    target_id: string;
    target_name: string;
    target_type: string;
    recommended_action: string;
  };
  blast_radius_reduced_percent?: number;
  business_impact_score?: string;
  terraform_patch?: string;
  thoughts?: Array<{
    step: number;
    phase: string;
    observation: string;
  }>;
  execution_time_ms?: number;
}

export async function fetchGraphOverview(): Promise<{
  total_nodes: number;
  total_edges: number;
  users: string[];
  crown_jewels: string[];
  health: Record<string, any>;
}> {
  const res = await fetch(`${API_BASE}/graph/overview`);
  return res.json();
}

export async function fetchGraphTopology(): Promise<GraphTopology> {
  const res = await fetch(`${API_BASE}/graph/topology`);
  if (res.status === 503) throw Object.assign(new Error('falkordb_down'), { status: 503 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function runRedTeamAttack(entrypoint: string): Promise<RedTeamAttackResult> {
  const res = await fetch(`${API_BASE}/simulate/attack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entrypoint }),
  });
  return res.json();
}

export async function runBlueTeamRemediation(attackResult: RedTeamAttackResult): Promise<BlueTeamRemediationResult> {
  const res = await fetch(`${API_BASE}/simulate/remediate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attack_result: attackResult }),
  });
  return res.json();
}

export async function applyRemediationPatch(sourceName: string, targetName: string,
                                            entrypoint?: string, incidentId?: string | null) {
  // entrypoint + incident_id link the :Remediation (and the Blue Team decision) to the incident.
  const res = await fetch(`${API_BASE}/simulate/apply-patch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_name: sourceName, target_name: targetName,
                           entrypoint: entrypoint ?? null, incident_id: incidentId ?? null }),
  });
  return res.json();
}

export async function reseedGraph() {
  const res = await fetch(`${API_BASE}/graph/reseed`, { method: 'POST' });
  return res.json();
}

export async function fetchRiskScorecard() {
  const res = await fetch(`${API_BASE}/graph/risk-scorecard`);
  return res.json();
}

export interface BenchmarkSide {
  name: string;
  query_type: string;
  result: string;
  hops_discovered: number;
  hallucination?: string;
  traversal_capable: boolean;
  latency_ms: number | null;
  accuracy: string;
  simulated?: boolean;
}

export interface BenchmarkCompareResult {
  entrypoint: string;
  vector_rag: BenchmarkSide;
  falkordb: BenchmarkSide;
  speedup_factor: number | null;
  conclusion?: string;
}

export async function fetchBenchmarkCompare(entrypoint: string = 'DevIntern'): Promise<BenchmarkCompareResult> {
  const res = await fetch(`${API_BASE}/graph/benchmark/compare?entrypoint=${encodeURIComponent(entrypoint)}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface BlastRadiusResult {
  node_id: string;
  node_name: string;
  label: string;
  reachable_nodes_count: number;
  crown_jewels_count: number;
  reachable_node_ids: string[];
  crown_jewel_names: string[];
  by_type: Record<string, number>;
  risk_score: number;
  risk_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  execution_time_ms: number;
}

export interface GlobalAuditResult {
  total_assessed: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  identities: Array<{
    id: string;
    name: string;
    department: string;
    risk_score: number;
    risk_level: string;
    blast_radius_resources: number;
    crown_jewels_count: number;
    target_jewel: string;
    hops: number;
    path_nodes: string[];
  }>;
  execution_time_ms: number;
}

export interface WhatIfResult {
  source_name: string;
  target_name: string;
  opens_attack_path: boolean;
  target_compromised?: string | null;
  new_path_hops: number;
  path_chain: string[];
  verdict: string;
  execution_time_ms: number;
}

export async function fetchBlastRadius(nodeId: string): Promise<BlastRadiusResult> {
  const res = await fetch(`${API_BASE}/graph/blast-radius?node_id=${encodeURIComponent(nodeId)}`);
  return res.json();
}

export async function fetchGlobalAudit(): Promise<GlobalAuditResult> {
  const res = await fetch(`${API_BASE}/graph/audit-all`);
  return res.json();
}

export async function runCypherPlayground(query: string) {
  const res = await fetch(`${API_BASE}/graph/cypher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    // e.g. 400 for a write sent to the read-only playground: surface FalkorDB's message
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Query failed (HTTP ${res.status})`);
  }
  return res.json();
}

export async function runWhatIfSimulation(sourceName: string, targetName: string): Promise<WhatIfResult> {
  const res = await fetch(`${API_BASE}/graph/what-if`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_name: sourceName, target_name: targetName }),
  });
  return res.json();
}




// ── Triage ────────────────────────────────────────────────────────────────────
export interface TriageFinding {
  finding_id: string;
  src: string;
  src_label: string;
  rel_type: string;
  dst: string;
  dst_label: string;
  dst_is_crown_jewel: boolean;
  src_reaches_crown_jewel: boolean;
  blast_radius: number;
  betweenness: number;
  impact_score: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  recommendation: string;
}

export interface TriageResult {
  total_findings: number;
  severity_counts: Record<string, number>;
  headline: string;
  findings: TriageFinding[];
  execution_time_ms: number;
}

export async function fetchTriage(maxFindings = 100): Promise<TriageResult> {
  const res = await fetch(`${API_BASE}/triage?max_findings=${maxFindings}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface TriageSummary {
  total_findings: number;
  severity_counts: Record<string, number>;
  headline: string;
  execution_time_ms: number;
}

export async function fetchTriageSummary(): Promise<TriageSummary> {
  const res = await fetch(`${API_BASE}/triage/summary`);
  if (res.status === 503) throw Object.assign(new Error('falkordb_down'), { status: 503 });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchChokepoints(topN = 10): Promise<{ chokepoints: { node: string; betweenness_score: number }[] }> {
  const res = await fetch(`${API_BASE}/triage/chokepoints?top_n=${topN}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Decision Trail (agent decision trace) ─────────────────────────────────────
export interface TraceConsidered {
  name: string;
  score: number;
}

export interface TraceMemoryRef {
  id: string;
  label: string; // 'Incident' | 'Remediation'
  summary: string;
}

export interface TraceDecision {
  id: string;
  agent_id: string;
  step: number;
  action: string;
  reason: string;
  score: number;
  ts: number | string;
  chosen: string | null;
  considered: TraceConsidered[];
  informed_by: TraceMemoryRef[];
}

export interface DecisionTrace {
  run_id: string | null;
  incident_id: string | null;
  decisions: TraceDecision[];
  cypher: string;
}

async function fetchTrace(url: string): Promise<DecisionTrace> {
  const res = await fetch(url);
  if (res.status === 404) throw Object.assign(new Error('No decision trail found'), { status: 404 });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  const data = await res.json();
  return {
    run_id: data?.run_id ?? null,
    incident_id: data?.incident_id ?? null,
    decisions: Array.isArray(data?.decisions) ? data.decisions : [],
    cypher: typeof data?.cypher === 'string' ? data.cypher : '',
  };
}

export function fetchLatestTrace(entrypoint: string): Promise<DecisionTrace> {
  return fetchTrace(`${API_BASE}/trace/latest?entrypoint=${encodeURIComponent(entrypoint)}`);
}

export function fetchTraceByRun(runId: string): Promise<DecisionTrace> {
  return fetchTrace(`${API_BASE}/trace/run/${encodeURIComponent(runId)}`);
}

export function fetchTraceByIncident(incidentId: string): Promise<DecisionTrace> {
  return fetchTrace(`${API_BASE}/trace/incident/${encodeURIComponent(incidentId)}`);
}

export interface SwarmEntrypoint {
  name: string;
  department?: string;
  compromised?: boolean;
}

export async function fetchSwarmEntrypoints(): Promise<SwarmEntrypoint[]> {
  const res = await fetch(`${API_BASE}/swarm/entrypoints`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.entrypoints) ? data.entrypoints : [];
}
