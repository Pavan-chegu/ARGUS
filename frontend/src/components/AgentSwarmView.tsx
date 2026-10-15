/**
 * AgentSwarmView — Live Autonomous Agent Swarm Demo
 * ==================================================
 *
 * The hackathon's kill-shot feature. Shows in real-time:
 *  - LEFT PANEL: Vector RAG "Confident but Wrong" result
 *  - RIGHT PANEL: Autonomous Graph RAG agent exploring hop-by-hop
 *  - CENTER: Live agent thought stream (each step animated)
 *  - BOTTOM: Memory panel showing FalkorDB incident nodes
 *  - FINAL: Side-by-side verdict: Vector=WRONG, Graph=CORRECT
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type SwarmEvent = {
  type: string;
  data: Record<string, any>;
  timestamp: number;
};

type AgentStep = {
  id: string;
  agent: 'vector_rag' | 'red_team' | 'blue_team' | 'system';
  phase: string;
  message: string;
  thought?: string;
  node_name?: string;
  node_label?: string;
  relation?: string;
  threat_score?: number;
  crown_jewel_reached?: boolean;
  is_wrong?: boolean;
  is_memory?: boolean;
  incidents_found?: number;
  is_repeat_offender?: boolean;
  blast_before?: any;
  blast_after?: any;
  alternatives?: any[];
};

type FinalResult = {
  vector: { result: string; correct: boolean; failure_reason: string; confidence: number } | null;
  graph: { result: string; correct: boolean; hops: number; incident_persisted: boolean; agent_steps: number } | null;
  insight: string;
};

const ENTRYPOINTS = [
  { name: 'DevIntern', label: '🚨 DevIntern (Engineering)', dept: 'Engineering' },
  { name: 'Contractor', label: '🚨 Contractor (Operations)', dept: 'Operations' },
  { name: 'SupportUser', label: '🚨 SupportUser (CustomerSupport)', dept: 'CustomerSupport' },
];

const AGENT_COLORS = {
  vector_rag: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.3)', accent: '#ef4444', label: 'Vector RAG' },
  red_team:   { bg: 'rgba(251,146,60,0.08)', border: 'rgba(251,146,60,0.3)', accent: '#f97316', label: 'Red Team' },
  blue_team:  { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.3)', accent: '#3b82f6', label: 'Blue Team' },
  system:     { bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.2)', accent: '#64748b', label: 'System' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function PhaseTag({ phase, agent }: { phase: string; agent: keyof typeof AGENT_COLORS }) {
  const color = AGENT_COLORS[agent]?.accent ?? '#64748b';
  return (
    <span style={{
      fontSize: 9,
      fontFamily: 'var(--font-mono)',
      padding: '2px 6px',
      borderRadius: 4,
      background: `${color}22`,
      border: `1px solid ${color}44`,
      color,
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
      fontWeight: 600,
      flexShrink: 0,
    }}>{phase}</span>
  );
}

function ThreatBar({ score }: { score: number }) {
  const color = score >= 100 ? '#ef4444' : score >= 70 ? '#f97316' : score >= 40 ? '#eab308' : '#22c55e';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 60, height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, score)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: 9, color, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{score}</span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export const AgentSwarmView: React.FC<{ selectedEntrypoint?: string }> = ({ selectedEntrypoint }) => {
  const [entrypoint, setEntrypoint] = useState(selectedEntrypoint || 'DevIntern');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [events, setEvents] = useState<SwarmEvent[]>([]);
  const [finalResult, setFinalResult] = useState<FinalResult | null>(null);
  const [vectorResult, setVectorResult] = useState<any>(null);
  const [attackPath, setAttackPath] = useState<any[]>([]);
  const [incidentMemory, setIncidentMemory] = useState<any[]>([]);
  const [blueChoke, setBlueChoke] = useState<any>(null);
  const [blueResult, setBlueResult] = useState<any>(null);
  const [fixResult, setFixResult] = useState<any>(null);
  const [fixBusy, setFixBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'vector' | 'red' | 'blue' | 'done'>('idle');
  const stepsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps]);

  const addStep = useCallback((step: Omit<AgentStep, 'id'>) => {
    setSteps(prev => [...prev, { ...step, id: `${Date.now()}_${Math.random()}` }]);
  }, []);

  const applyFix = useCallback(async (undo: boolean) => {
    if (!blueChoke) return;
    setFixBusy(true);
    try {
      const res = await fetch(`/api/simulate/${undo ? 'undo-patch' : 'apply-patch'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_name: blueChoke.source_name, target_name: blueChoke.target_name,
          entrypoint: blueResult?.entrypoint, incident_id: blueResult?.incident_id,
        }),
      });
      const data = await res.json();
      setFixResult(undo ? null : data);
    } catch (e: any) {
      setFixResult({ status: 'error', error: e?.message });
    } finally {
      setFixBusy(false);
    }
  }, [blueChoke, blueResult]);

  const handleRun = useCallback(async () => {
    if (running) {
      abortRef.current?.abort();
      setRunning(false);
      return;
    }

    // Reset state
    setRunning(true);
    setSteps([]);
    setEvents([]);
    setFinalResult(null);
    setVectorResult(null);
    setAttackPath([]);
    setIncidentMemory([]);
    setBlueChoke(null);
    setBlueResult(null);
    setFixResult(null);
    setPhase('vector');

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('http://localhost:8000/api/swarm/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entrypoint, run_comparison: true }),
        signal: ctrl.signal,
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          if (!part.trim()) continue;
          const lines = part.split('\n');
          let eventType = '';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
          }
          if (!eventType || !dataStr) continue;

          let data: any = {};
          try { data = JSON.parse(dataStr); } catch { continue; }

          setEvents(prev => [...prev, { type: eventType, data, timestamp: Date.now() }]);

          // ── Route each event ──────────────────────────────────────────────

          if (eventType === 'vector_start') {
            addStep({ agent: 'vector_rag', phase: 'Searching', message: data.message });
          }

          if (eventType === 'vector_result') {
            setVectorResult(data);
            setPhase('red');
            addStep({
              agent: 'vector_rag',
              phase: 'Complete',
              message: `${data.result}`,
              thought: `Confidence: ${Math.round((data.confidence || 0) * 100)}% | Documents searched: ${data.documents_searched || 0}`,
              is_wrong: data.is_wrong,
            });
          }

          if (eventType === 'graph_start') {
            addStep({ agent: 'red_team', phase: 'Starting', message: data.message });
          }

          if (eventType === 'red_team_memory_recall') {
            setIncidentMemory(data.prior_incidents || []);
            addStep({
              agent: 'red_team',
              phase: 'Memory Recall',
              message: data.message,
              thought: data.insight,
              is_memory: true,
              incidents_found: data.incidents_found,
            });
          }

          if (eventType === 'red_team_init') {
            addStep({ agent: 'red_team', phase: data.phase, message: data.action, thought: data.thought });
          }

          if (eventType === 'red_team_hop') {
            addStep({
              agent: 'red_team',
              phase: data.phase,
              message: data.action,
              thought: data.thought,
              node_name: data.node_name,
              node_label: data.node_label,
              relation: data.relation,
              threat_score: data.threat_score,
              crown_jewel_reached: data.crown_jewel_reached,
              alternatives: data.alternatives_considered,
            });
          }

          if (eventType === 'red_team_complete') {
            setAttackPath(data.path_nodes || []);
            addStep({
              agent: 'red_team',
              phase: 'Complete',
              message: data.message,
              thought: data.insight,
            });
          }

          if (eventType === 'blue_team_start') {
            setPhase('blue');
            addStep({ agent: 'blue_team', phase: 'Starting', message: data.message });
          }

          if (eventType === 'blue_team_step') {
            addStep({
              agent: 'blue_team',
              phase: data.phase,
              message: data.observation || data.message,
              is_repeat_offender: data.is_repeat_offender,
              is_memory: data.phase === 'Episodic Memory Recall',
              blast_before: data.blast_before,
              blast_after: data.blast_after,
            });
          }

          if (eventType === 'blue_team_complete') {
            setBlueChoke(data.choke_point);
            setBlueResult(data);
            addStep({ agent: 'blue_team', phase: 'Complete', message: data.message });
          }

          if (eventType === 'swarm_complete') {
            setPhase('done');
            setFinalResult({
              vector: data.comparison?.vector_rag,
              graph: data.comparison?.graph_rag,
              insight: data.comparison?.key_insight || '',
            });
            setRunning(false);
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        addStep({ agent: 'system', phase: 'Error', message: `Connection error: ${e?.message}. Is the backend running on port 8000?` });
      }
      setRunning(false);
    }
  }, [entrypoint, running, addStep]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--bg-base)',
      overflow: 'hidden',
    }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'var(--bg-surface)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
            🤖 Autonomous Agent Swarm
            <span style={{
              fontSize: 9, padding: '2px 7px', borderRadius: 4,
              background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)',
              color: '#a78bfa', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em',
            }}>LIVE DEMO</span>
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
            Vector RAG vs Graph RAG — watch why graphs win
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Entrypoint selector */}
        <select
          value={entrypoint}
          onChange={e => setEntrypoint(e.target.value)}
          disabled={running}
          style={{
            background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8, padding: '6px 12px', fontSize: 12,
            fontFamily: 'var(--font-mono)', color: '#cbd5e1', outline: 'none',
            opacity: running ? 0.5 : 1,
          }}
        >
          {ENTRYPOINTS.map(ep => (
            <option key={ep.name} value={ep.name}>{ep.label}</option>
          ))}
        </select>

        {/* Run button */}
        <button
          onClick={handleRun}
          style={{
            padding: '7px 18px',
            borderRadius: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            background: running
              ? 'rgba(239,68,68,0.15)'
              : 'linear-gradient(135deg, #7c3aed, #4f46e5)',
            color: running ? '#ef4444' : 'white',
            boxShadow: running ? 'none' : '0 0 20px rgba(124,58,237,0.3)',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            border: running ? '1px solid rgba(239,68,68,0.3)' : 'none',
          } as any}
        >
          {running ? (
            <>
              <span style={{ width: 10, height: 10, border: '2px solid #ef444455', borderTopColor: '#ef4444', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
              Stop
            </>
          ) : (
            <>⚡ Launch Swarm</>
          )}
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: 0 }}>

        {/* ── Left: Vector RAG Panel ───────────────────────────────────────── */}
        <div style={{
          width: 280,
          flexShrink: 0,
          borderRight: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(239,68,68,0.03)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(239,68,68,0.1)', flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#ef4444', letterSpacing: '0.1em', fontWeight: 700 }}>
              ❌ VECTOR RAG (simulated baseline)
            </div>
            <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>
              Pinecone / Weaviate / OpenSearch
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
            {!vectorResult && phase === 'idle' && (
              <div style={{ color: '#334155', fontSize: 11, fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
                Vector RAG embeds each IAM policy as a text chunk.<br /><br />
                It cannot see <em>transitive</em> access chains — each hop is a separate document.
              </div>
            )}
            {!vectorResult && phase === 'vector' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
                  🔍 Searching embeddings…
                </div>
                {[0.85, 0.79, 0.71].map((sim, i) => (
                  <div key={i} style={{
                    padding: '8px 10px', borderRadius: 6,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ fontSize: 9, color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                      similarity: {sim} — chunk_{i + 1}.json
                    </div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 3, lineHeight: 1.4 }}>
                      {['iam:ListBuckets on DevLogsBucket', 'sts:GetCallerIdentity', 'ec2:DescribeInstances'][i]}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {vectorResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{
                  padding: 12, borderRadius: 8,
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.25)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', marginBottom: 4 }}>
                    Verdict: {vectorResult.result}
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
                    {vectorResult.answer}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 9, color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                    Confidence: {Math.round((vectorResult.confidence || 0) * 100)}% |
                    Docs: {vectorResult.documents_searched}
                  </div>
                </div>

                <div style={{
                  padding: 10, borderRadius: 6,
                  background: 'rgba(239,68,68,0.05)',
                  border: '1px dashed rgba(239,68,68,0.2)',
                }}>
                  <div style={{ fontSize: 9, color: '#ef4444', fontFamily: 'var(--font-mono)', fontWeight: 700, marginBottom: 4 }}>
                    WHY IT FAILED:
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
                    {vectorResult.failure_reason}
                  </div>
                </div>

                <div style={{
                  padding: 8, borderRadius: 6,
                  background: 'rgba(239,68,68,0.06)',
                  border: '1px solid rgba(239,68,68,0.15)',
                  textAlign: 'center' as const,
                }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: '#ef4444' }}>WRONG</div>
                  <div style={{ fontSize: 9, color: '#ef444488', fontFamily: 'var(--font-mono)' }}>
                    Missed multi-hop escalation
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Center: Agent Stream ─────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Attack path visualization */}
          {attackPath.length > 0 && (
            <div style={{
              padding: '8px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(249,115,22,0.04)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
              overflowX: 'auto',
            }}>
              <span style={{ fontSize: 10, color: '#f97316', fontFamily: 'var(--font-mono)', fontWeight: 700, flexShrink: 0 }}>
                ATTACK PATH:
              </span>
              {attackPath.map((node, i) => (
                <React.Fragment key={i}>
                  <div style={{
                    padding: '3px 8px', borderRadius: 4,
                    background: node.properties?.is_crown_jewel || node.properties?.sensitivity === 'CrownJewel'
                      ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${node.properties?.is_crown_jewel ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.1)'}`,
                    fontSize: 10, fontFamily: 'var(--font-mono)',
                    color: node.properties?.is_crown_jewel ? '#ef4444' : '#94a3b8',
                    fontWeight: node.properties?.is_crown_jewel ? 700 : 400,
                    flexShrink: 0,
                    whiteSpace: 'nowrap' as const,
                  }}>
                    {node.properties?.is_crown_jewel ? '💎 ' : ''}{node.name}
                  </div>
                  {i < attackPath.length - 1 && (
                    <span style={{ color: '#f97316', fontSize: 12, flexShrink: 0 }}>→</span>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Step stream */}
          <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>

            {phase === 'idle' && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                height: '100%', gap: 16, color: '#334155',
              }}>
                <div style={{ fontSize: 48, filter: 'grayscale(0.3)' }}>🤖</div>
                <div style={{ textAlign: 'center' as const }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                    Autonomous Agent Swarm Ready
                  </div>
                  <div style={{ fontSize: 12, color: '#334155', maxWidth: 360, lineHeight: 1.6 }}>
                    Select an entrypoint identity and click <strong style={{ color: '#7c3aed' }}>Launch Swarm</strong> to watch the AI agents explore the IAM graph live, hop by hop.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
                  {[
                    { icon: '🧠', label: 'Memory Recall', desc: 'FalkorDB episodic memory' },
                    { icon: '🕷', label: 'Iterative Explore', desc: 'Hop-by-hop agent reasoning' },
                    { icon: '🛡', label: 'Blue Team', desc: 'Memory-augmented remediation' },
                  ].map(f => (
                    <div key={f.label} style={{ textAlign: 'center' as const }}>
                      <div style={{ fontSize: 24 }}>{f.icon}</div>
                      <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 4 }}>{f.label}</div>
                      <div style={{ fontSize: 9, color: '#334155' }}>{f.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {steps.map(step => {
              const colors = AGENT_COLORS[step.agent];
              const isSpecial = step.crown_jewel_reached || step.is_wrong;
              return (
                <div
                  key={step.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: isSpecial
                      ? (step.crown_jewel_reached ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.06)')
                      : step.is_memory
                        ? 'rgba(139,92,246,0.06)'
                        : colors.bg,
                    border: `1px solid ${isSpecial
                      ? (step.crown_jewel_reached ? 'rgba(239,68,68,0.35)' : 'rgba(239,68,68,0.2)')
                      : step.is_memory
                        ? 'rgba(139,92,246,0.25)'
                        : colors.border}`,
                    animation: 'fadeInUp 0.25s ease',
                  }}
                >
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: step.thought ? 6 : 0 }}>
                    <PhaseTag phase={step.phase} agent={step.agent} />
                    <span style={{ fontSize: 11, color: '#cbd5e1', flex: 1, fontFamily: 'var(--font-mono)', lineHeight: 1.4 }}>
                      {step.message}
                    </span>
                    {step.crown_jewel_reached && (
                      <span style={{ fontSize: 16, flexShrink: 0 }}>💎</span>
                    )}
                    {step.is_wrong === true && (
                      <span style={{ fontSize: 10, color: '#ef4444', fontFamily: 'var(--font-mono)', fontWeight: 700, flexShrink: 0 }}>✗ WRONG</span>
                    )}
                    {step.threat_score !== undefined && (
                      <ThreatBar score={step.threat_score} />
                    )}
                    {step.incidents_found !== undefined && (
                      <span style={{
                        fontSize: 9, padding: '2px 6px', borderRadius: 4,
                        background: 'rgba(139,92,246,0.15)', color: '#a78bfa',
                        fontFamily: 'var(--font-mono)', fontWeight: 700,
                      }}>
                        {step.incidents_found} memory node{step.incidents_found !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {/* Thought bubble */}
                  {step.thought && (
                    <div style={{
                      marginTop: 6,
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: 'rgba(0,0,0,0.2)',
                      borderLeft: `2px solid ${colors.accent}44`,
                      fontSize: 10,
                      color: '#64748b',
                      lineHeight: 1.55,
                      fontFamily: 'var(--font-mono)',
                    }}>
                      💭 {step.thought}
                    </div>
                  )}

                  {/* Alternatives considered */}
                  {step.alternatives && step.alternatives.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                      <span style={{ fontSize: 9, color: '#475569', fontFamily: 'var(--font-mono)' }}>skipped:</span>
                      {step.alternatives.map((a: any, i: number) => (
                        <span key={i} style={{
                          fontSize: 9, padding: '1px 6px', borderRadius: 3,
                          background: 'rgba(100,116,139,0.1)',
                          border: '1px solid rgba(100,116,139,0.15)',
                          color: '#475569', fontFamily: 'var(--font-mono)',
                        }}>
                          {a.name} ({a.label})
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Blast radius delta */}
                  {step.blast_before && step.blast_after && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                      {[
                        { label: 'Before', d: step.blast_before, color: '#ef4444' },
                        { label: 'After', d: step.blast_after, color: '#22c55e' },
                      ].map(({ label, d, color }) => (
                        <div key={label} style={{
                          flex: 1, padding: '6px 8px', borderRadius: 6,
                          background: 'rgba(0,0,0,0.2)',
                          border: `1px solid ${color}22`,
                        }}>
                          <div style={{ fontSize: 8, color, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{label}</div>
                          <div style={{ fontSize: 11, color, fontWeight: 700 }}>{d.risk_score}</div>
                          <div style={{ fontSize: 8, color: '#475569' }}>{d.risk_level} | {d.reachable_nodes_count} nodes</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {running && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', color: '#475569' }}>
                <span style={{ width: 12, height: 12, border: '2px solid #334155', borderTopColor: '#7c3aed', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>Agent reasoning…</span>
              </div>
            )}
            <div ref={stepsEndRef} />
          </div>
        </div>

        {/* ── Right: Memory + Result Panel ────────────────────────────────────── */}
        <div style={{
          width: 280,
          flexShrink: 0,
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(59,130,246,0.03)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(59,130,246,0.1)', flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#3b82f6', letterSpacing: '0.1em', fontWeight: 700 }}>
              ✅ GRAPH RAG (FalkorDB)
            </div>
            <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>
              Autonomous agent + cognitive memory
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* FalkorDB Memory panel */}
            <div>
              <div style={{ fontSize: 9, color: '#7c3aed', fontFamily: 'var(--font-mono)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.08em' }}>
                🧠 FALKORDB EPISODIC MEMORY
              </div>
              {incidentMemory.length === 0 ? (
                <div style={{ fontSize: 10, color: '#334155', fontFamily: 'var(--font-mono)' }}>
                  {phase === 'idle' ? 'No incidents loaded yet.' : 'Querying graph memory…'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {incidentMemory.map((inc: any, i: number) => (
                    <div key={i} style={{
                      padding: '7px 9px', borderRadius: 6,
                      background: 'rgba(139,92,246,0.07)',
                      border: '1px solid rgba(139,92,246,0.2)',
                    }}>
                      <div style={{ fontSize: 9, color: '#a78bfa', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                        :Incident node #{i + 1}
                      </div>
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3 }}>
                        {inc.path?.join(' → ')}
                      </div>
                    </div>
                  ))}
                  <div style={{ fontSize: 9, color: '#475569', fontFamily: 'var(--font-mono)' }}>
                    ↑ Loaded from FalkorDB graph nodes. Vector RAG has no equivalent memory.
                  </div>
                </div>
              )}
            </div>

            {/* Choke point */}
            {blueChoke && (
              <div>
                <div style={{ fontSize: 9, color: '#3b82f6', fontFamily: 'var(--font-mono)', fontWeight: 700, marginBottom: 6 }}>
                  🛡 REMEDIATION CHOKE POINT
                </div>
                <div style={{
                  padding: '8px 10px', borderRadius: 6,
                  background: 'rgba(59,130,246,0.07)',
                  border: '1px solid rgba(59,130,246,0.2)',
                }}>
                  <div style={{ fontSize: 10, color: '#3b82f6', fontWeight: 700 }}>
                    {blueChoke.source_name} → {blueChoke.target_name}
                  </div>
                  <div style={{ fontSize: 9, color: '#64748b', marginTop: 4, lineHeight: 1.4 }}>
                    {blueChoke.recommended_action}
                  </div>
                  {blueResult?.exposed_identities_before && (
                    <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>
                      Identities exposed org-wide: <b style={{ color: '#ef4444' }}>{blueResult.exposed_identities_before.length}</b>
                      {' → '}<b style={{ color: '#22c55e' }}>{blueResult.exposed_identities_after.length}</b>
                      {blueResult.also_protected?.length > 0 && (
                        <div>This one cut also protects: <b style={{ color: '#e2e8f0' }}>{blueResult.also_protected.join(', ')}</b></div>
                      )}
                      {blueResult.cut_method && <div style={{ color: '#475569' }}>{blueResult.cut_method}</div>}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button disabled={fixBusy || !!fixResult} onClick={() => applyFix(false)}
                      style={{ fontSize: 10, padding: '4px 8px', borderRadius: 4, border: '1px solid #22c55e',
                               background: 'rgba(34,197,94,0.12)', color: '#22c55e', cursor: 'pointer' }}>
                      {fixBusy ? 'Applying…' : 'Apply fix in FalkorDB + verify'}
                    </button>
                    {fixResult && (
                      <button disabled={fixBusy} onClick={() => applyFix(true)}
                        style={{ fontSize: 10, padding: '4px 8px', borderRadius: 4, border: '1px solid #64748b',
                                 background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>Undo</button>
                    )}
                  </div>
                  {fixResult?.verification && (
                    <div style={{ fontSize: 9, marginTop: 6, color: fixResult.verification.verified ? '#22c55e' : '#ef4444', lineHeight: 1.5 }}>
                      {fixResult.verification.verified ? '✔ VERIFIED' : '✖ NOT VERIFIED'}: shortestPath re-query for {fixResult.verification.entrypoint_checked} returned {fixResult.verification.paths_remaining_for_entrypoint} path(s).
                      {' '}Exposed identities now: {fixResult.verification.exposed_after.length}. ({fixResult.execution_time_ms} ms on {fixResult.engine})
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Final verdict */}
            {finalResult && (
              <div style={{
                padding: 12, borderRadius: 8,
                background: 'linear-gradient(135deg, rgba(34,197,94,0.08), rgba(59,130,246,0.08))',
                border: '1px solid rgba(34,197,94,0.25)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', marginBottom: 8 }}>
                  FINAL VERDICT
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>Vector RAG</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', fontFamily: 'var(--font-mono)' }}>✗ WRONG</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>Graph RAG</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', fontFamily: 'var(--font-mono)' }}>✓ CORRECT</span>
                  </div>
                  <div style={{ marginTop: 4, padding: '6px 8px', borderRadius: 5, background: 'rgba(0,0,0,0.2)', fontSize: 9, color: '#64748b', lineHeight: 1.5 }}>
                    {finalResult.insight}
                  </div>
                  {finalResult.graph?.incident_persisted && (
                    <div style={{ fontSize: 9, color: '#a78bfa', fontFamily: 'var(--font-mono)', padding: '4px 0' }}>
                      💾 Incident persisted to FalkorDB graph memory
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default AgentSwarmView;
