/**
 * AgentView — live SSE console for the ARGUS LLM tool-calling agent + FalkorDB Cognitive Memory Inspector.
 *
 * Streams /api/agent/stream and renders each SSE event as a styled entry:
 *   thinking   → spinner row
 *   tool_call  → cyan tool card with arguments
 *   tool_result→ collapsed result (expand on click)
 *   tool_error → red error card
 *   verdict    → prominent green conclusion box
 *   error      → red banner
 *   done       → elapsed time stamp
 *
 * Plus right-hand Cognitive Memory panel displaying live FalkorDB :Incident and :Remediation nodes.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────

interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

interface LogEntry {
  id: number;
  event: SSEEvent;
  ts: number;
  expanded?: boolean;
}

interface MemoryData {
  entrypoint: string;
  incident_count: number;
  incidents: Array<Record<string, any>>;
  remediations: Array<Record<string, any>>;
  red_team_working_memory: Record<string, any>;
  blue_team_working_memory: Record<string, any>;
  engine: string;
}

const TOOL_ICONS: Record<string, string> = {
  triage_findings: '⚠',
  explain_path: '🔍',
  propose_fix: '🛡',
  apply_fix: '✂',
  recall_incidents: '🧠',
};

const TOOL_COLORS: Record<string, string> = {
  triage_findings: '#fbbf24',
  explain_path: '#38bdf8',
  propose_fix: '#a78bfa',
  apply_fix: '#f87171',
  recall_incidents: '#34d399',
};

// ─── Log Row Components ─────────────────────────────────────────────────────

const ThinkingRow: React.FC<{ turn: number }> = ({ turn }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', opacity: 0.7 }}>
    <span style={{ color: '#38bdf8', fontFamily: 'var(--font-mono)', fontSize: 11 }}>Turn {turn}</span>
    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: '2px solid #38bdf8', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
    <span style={{ color: '#64748b', fontFamily: 'var(--font-mono)', fontSize: 11 }}>Reasoning…</span>
  </div>
);

const ToolCallRow: React.FC<{ event: SSEEvent }> = ({ event }) => {
  const tool = event.tool as string;
  const args = event.args as Record<string, unknown> ?? {};
  const color = TOOL_COLORS[tool] ?? '#94a3b8';
  const icon = TOOL_ICONS[tool] ?? '🔧';
  const argStr = Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
  return (
    <div style={{ padding: '6px 10px', margin: '4px 0', borderRadius: 8, background: `${color}12`, border: `1px solid ${color}35` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 700, color }}>{tool}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#64748b', marginLeft: 4 }}>{argStr || '(no args)'}</span>
      </div>
    </div>
  );
};

const ToolResultRow: React.FC<{ event: SSEEvent; expanded: boolean; onToggle: () => void }> = ({
  event, expanded, onToggle,
}) => {
  const tool = event.tool as string;
  const result = event.result as Record<string, unknown> ?? {};
  const ms = event.elapsed_ms as number ?? 0;
  const color = TOOL_COLORS[tool] ?? '#94a3b8';
  const summary = (() => {
    if (Array.isArray(result)) return `${result.length} items`;
    if (result.findings) return `${(result.findings as unknown[]).length} findings`;
    if (result.status) return String(result.status);
    if (result.error) return `Error: ${result.error}`;
    return 'OK';
  })();
  return (
    <div style={{ margin: '2px 0 4px 24px' }}>
      <button
        onClick={onToggle}
        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}
      >
        <span style={{ color: '#22c55e', fontFamily: 'var(--font-mono)', fontSize: 10 }}>✓</span>
        <span style={{ color, fontFamily: 'var(--font-mono)', fontSize: 10 }}>{tool}</span>
        <span style={{ color: '#475569', fontFamily: 'var(--font-mono)', fontSize: 10 }}>→ {summary}</span>
        <span style={{ color: '#334155', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{ms}ms</span>
        <span style={{ color: '#475569', fontSize: 9 }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <pre style={{
          margin: '4px 0 0 0', padding: '8px 10px', borderRadius: 6,
          background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.06)',
          fontFamily: 'var(--font-mono)', fontSize: 10, color: '#94a3b8',
          overflowX: 'auto', maxHeight: 200,
        }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
};

const ToolErrorRow: React.FC<{ event: SSEEvent }> = ({ event }) => (
  <div style={{ padding: '6px 10px', margin: '4px 0', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#ef4444' }}>
      ✗ {event.tool as string}: {event.error as string}
    </span>
  </div>
);

const VerdictBox: React.FC<{ content: string }> = ({ content }) => (
  <div style={{
    margin: '12px 0', padding: '14px 16px', borderRadius: 10,
    background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 16 }}>🎯</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Agent Verdict
      </span>
    </div>
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#e2e8f0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
      {content}
    </div>
  </div>
);

const ErrorBanner: React.FC<{ message: string }> = ({ message }) => (
  <div style={{
    margin: '8px 0', padding: '10px 14px', borderRadius: 8,
    background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
    color: '#ef4444', fontFamily: 'var(--font-mono)', fontSize: 11,
  }}>
    ⚠ {message}
  </div>
);

// ─── Main Component ─────────────────────────────────────────────────────────

export const AgentView: React.FC<{
  selectedEntrypoint?: string;
  /** Opens the Decision Trail view; called with the run_id if the stream reported one. */
  onViewDecisionTrail?: (runId?: string | null, entrypoint?: string) => void;
}> = ({
  selectedEntrypoint = 'DevIntern',
  onViewDecisionTrail,
}) => {
  const [identity, setIdentity] = useState(selectedEntrypoint);
  const [autoApply, setAutoApply] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [showMemoryPanel, setShowMemoryPanel] = useState(true);
  const [memoryData, setMemoryData] = useState<MemoryData | null>(null);
  const [loadingMemory, setLoadingMemory] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idCounter = useRef(0);

  // Keep identity in sync with parent-selected entrypoint
  useEffect(() => { setIdentity(selectedEntrypoint); }, [selectedEntrypoint]);

  // Load FalkorDB cognitive memory for the active identity
  const fetchMemory = useCallback(async (idName: string) => {
    setLoadingMemory(true);
    try {
      const res = await fetch(`/api/swarm/memory/${encodeURIComponent(idName)}`);
      if (res.ok) {
        const data = await res.json();
        setMemoryData(data);
      }
    } catch {
      // Memory fetch failed or backend down
    } finally {
      setLoadingMemory(false);
    }
  }, []);

  useEffect(() => {
    fetchMemory(identity);
  }, [identity, fetchMemory]);

  // Auto-scroll
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  const addEntry = useCallback((event: SSEEvent) => {
    setLog(prev => [...prev, { id: idCounter.current++, event, ts: Date.now(), expanded: false }]);
  }, []);

  const toggleExpand = useCallback((id: number) => {
    setLog(prev => prev.map(e => e.id === id ? { ...e, expanded: !e.expanded } : e));
  }, []);

  const handleRun = useCallback(async () => {
    if (running) {
      abortRef.current?.abort();
      setRunning(false);
      return;
    }
    setLog([]);
    setVerdict(null);
    setRunId(null);
    setRunning(true);
    const t0 = Date.now();

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const url = `/api/agent/stream?identity=${encodeURIComponent(identity)}&auto_apply=${autoApply}`;
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        addEntry({ type: 'error', message: `HTTP ${res.status}: ${res.statusText}` });
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt: SSEEvent = JSON.parse(line.slice(6));
              if (evt.type === 'verdict') setVerdict(evt.content as string);
              if (typeof evt.run_id === 'string' && evt.run_id) setRunId(evt.run_id);
              if (evt.type === 'done') setElapsedMs(Date.now() - t0);
              addEntry(evt);
            } catch { /* ignore parse error */ }
          }
        }
      }
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== 'AbortError') {
        addEntry({ type: 'error', message: String(err) });
      }
    } finally {
      setRunning(false);
      setElapsedMs(Date.now() - t0);
      // Refresh memory nodes after agent completes run
      fetchMemory(identity);
    }
  }, [running, identity, autoApply, addEntry, fetchMemory]);

  const IDENTITIES = [
    'DevIntern', 'DataScientist', 'BackendEngineer', 'MLEngineer',
    'FrontendDev', 'Analyst', 'SecurityAuditor', 'SysAdmin',
  ];

  const turnCount = log.filter(e => e.event.type === 'thinking').length;
  const toolCount = log.filter(e => e.event.type === 'tool_call').length;

  return (
    <div className="agent-root" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-base)' }}>
      {/* ── Header bar ─── */}
      <div style={{
        flexShrink: 0, padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 14px', background: 'var(--bg-surface)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>🤖 ARGUS Agent</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#475569' }}>Groq LLaMA 3.3 70B + FalkorDB Graph Memory</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginLeft: 'auto' }}>
          {/* Identity picker */}
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#64748b' }}>Identity:</label>
          <select
            value={identity}
            onChange={e => setIdentity(e.target.value)}
            disabled={running}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, color: '#f1f5f9', fontFamily: 'var(--font-mono)', fontSize: 11,
              padding: '4px 8px', cursor: running ? 'not-allowed' : 'pointer',
            }}
          >
            {IDENTITIES.map(id => <option key={id} value={id}>{id}</option>)}
          </select>

          {/* Auto-apply toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: running ? 'not-allowed' : 'pointer' }}>
            <div
              onClick={() => !running && setAutoApply(a => !a)}
              style={{
                width: 32, height: 16, borderRadius: 8, position: 'relative',
                background: autoApply ? 'rgba(248,113,113,0.7)' : 'rgba(255,255,255,0.1)',
                border: autoApply ? '1px solid rgba(248,113,113,0.5)' : '1px solid rgba(255,255,255,0.15)',
                transition: 'all 0.2s', cursor: running ? 'not-allowed' : 'pointer',
              }}
            >
              <div style={{
                position: 'absolute', top: 2, left: autoApply ? 16 : 2, width: 10, height: 10,
                borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
              }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: autoApply ? '#f87171' : '#64748b' }}>
              {autoApply ? 'Auto-apply ON' : 'Auto-apply off'}
            </span>
          </label>

          {/* Toggle Cognitive Memory Panel */}
          <button
            onClick={() => setShowMemoryPanel(prev => !prev)}
            style={{
              padding: '5px 10px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 10.5,
              background: showMemoryPanel ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.05)',
              border: showMemoryPanel ? '1px solid rgba(56,189,248,0.35)' : '1px solid rgba(255,255,255,0.1)',
              color: showMemoryPanel ? '#38bdf8' : '#64748b', cursor: 'pointer',
            }}
          >
            🧠 {showMemoryPanel ? 'Hide Memory' : 'Graph Memory'}
          </button>

          {/* Run/Stop button */}
          <button
            onClick={handleRun}
            style={{
              padding: '6px 16px', borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 700,
              background: running ? 'rgba(248,113,113,0.2)' : 'rgba(34,197,94,0.2)',
              border: running ? '1px solid rgba(248,113,113,0.5)' : '1px solid rgba(34,197,94,0.5)',
              color: running ? '#f87171' : '#22c55e', cursor: 'pointer',
            }}
          >
            {running ? '⏹ Stop' : '▶ Run Agent'}
          </button>
        </div>
      </div>

      {/* ── Stats bar ─── */}
      {log.length > 0 && (
        <div style={{
          flexShrink: 0, padding: '6px 20px', display: 'flex', gap: 20,
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          background: 'rgba(0,0,0,0.2)', fontFamily: 'var(--font-mono)', fontSize: 10,
        }}>
          <span style={{ color: '#475569' }}>Identity: <span style={{ color: '#38bdf8' }}>{identity}</span></span>
          <span style={{ color: '#475569' }}>Turns: <span style={{ color: '#f1f5f9' }}>{turnCount}</span></span>
          <span style={{ color: '#475569' }}>Tool calls: <span style={{ color: '#f1f5f9' }}>{toolCount}</span></span>
          {elapsedMs > 0 && (
            <span style={{ color: '#475569' }}>Elapsed: <span style={{ color: '#34d399' }}>{(elapsedMs / 1000).toFixed(1)}s</span></span>
          )}
          {verdict && <span style={{ color: '#22c55e' }}>✓ Verdict ready</span>}
          {!running && onViewDecisionTrail && (verdict || runId) && (
            <button
              onClick={() => onViewDecisionTrail(runId, identity)}
              title={runId ? `run_id ${runId}` : 'Latest trail for this identity'}
              style={{
                marginLeft: 'auto', padding: '1px 8px', borderRadius: 6, cursor: 'pointer',
                background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)',
                color: '#fbbf24', fontFamily: 'var(--font-mono)', fontSize: 10,
              }}
            >
              ⇣ View decision trail
            </button>
          )}
          {running && <span style={{ color: '#fbbf24' }}>● Running…</span>}
        </div>
      )}

      {/* ── Body: 2-Column (Agent Log + Cognitive Memory) ─── */}
      <div className="agent-body" style={{ overflow: 'hidden' }}>
        {/* Left: Stream Log */}
        <div className="agent-log" style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', minHeight: 0 }}>
          {log.length === 0 && !running && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, opacity: 0.6 }}>
              <span style={{ fontSize: 48 }}>🤖</span>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: '#f1f5f9', marginBottom: 6 }}>ARGUS LLM Agent Console</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#64748b', maxWidth: 440, lineHeight: 1.6 }}>
                  Orchestrates Groq LLaMA 3.3 70B over FalkorDB. The agent performs graph lookups, recalls past incidents, calculates blast radius, and auto-generates Terraform HCL patches.
                </div>
              </div>
            </div>
          )}

          {log.map(entry => {
            const { id, event } = entry;
            switch (event.type) {
              case 'start':
                return (
                  <div key={id} style={{ padding: '4px 0', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#475569' }}>
                    ── Agent started · identity={event.identity as string ?? 'all'} · auto_apply={String(event.auto_apply)} ──
                  </div>
                );
              case 'thinking':
                return <ThinkingRow key={id} turn={event.turn as number} />;
              case 'tool_call':
                return <ToolCallRow key={id} event={event} />;
              case 'tool_result':
                return (
                  <ToolResultRow
                    key={id}
                    event={event}
                    expanded={!!entry.expanded}
                    onToggle={() => toggleExpand(id)}
                  />
                );
              case 'tool_error':
                return <ToolErrorRow key={id} event={event} />;
              case 'verdict':
                return <VerdictBox key={id} content={event.content as string} />;
              case 'error':
                return <ErrorBanner key={id} message={event.message as string} />;
              case 'done':
                return (
                  <div key={id} style={{ padding: '4px 0', fontFamily: 'var(--font-mono)', fontSize: 10, color: '#334155' }}>
                    ── Done ──
                  </div>
                );
              default:
                return null;
            }
          })}

          <div ref={logEndRef} />
        </div>

        {/* Right: FalkorDB Cognitive Memory Panel */}
        {showMemoryPanel && (
          <div
            className="agent-memory"
            style={{
              borderLeft: '1px solid rgba(255,255,255,0.06)',
              background: '#090d14',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Memory Header */}
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>🧠</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 700, color: '#38bdf8' }}>
                  FalkorDB Cognitive Memory
                </span>
              </div>
              <button
                onClick={() => fetchMemory(identity)}
                disabled={loadingMemory}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {loadingMemory ? '↻' : '⟳ Refresh'}
              </button>
            </div>

            {/* Memory Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Identity Status Card */}
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: memoryData && memoryData.incident_count > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
                  border: `1px solid ${memoryData && memoryData.incident_count > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#94a3b8' }}>Target:</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: '#f1f5f9' }}>{identity}</span>
                </div>
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12 }}>{memoryData && memoryData.incident_count > 0 ? '🚨' : '🛡️'}</span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: memoryData && memoryData.incident_count > 0 ? '#f87171' : '#34d399',
                    }}
                  >
                    {memoryData && memoryData.incident_count > 0
                      ? `Repeat Offender (${memoryData.incident_count} Incidents)`
                      : 'Zero Recorded Incidents'}
                  </span>
                </div>
              </div>

              {/* Episodic Memory: Incidents */}
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>
                  Episodic Incidents (:Incident nodes)
                </div>
                {memoryData && memoryData.incidents && memoryData.incidents.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {memoryData.incidents.map((inc, i) => (
                      <div
                        key={i}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 6,
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.06)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                        }}
                      >
                        <div style={{ color: '#f87171', fontWeight: 600 }}>Breach Target: {inc.target || 'Vault'}</div>
                        <div style={{ color: '#64748b', fontSize: 9.5, marginTop: 2 }}>Choke Point: {inc.choke_point || 'CIRunnerRole'}</div>
                        <div style={{ color: '#475569', fontSize: 9, marginTop: 2 }}>{new Date(inc.timestamp * 1000 || Date.now()).toLocaleTimeString()}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: '#475569', fontFamily: 'var(--font-mono)', fontStyle: 'italic' }}>
                    No incident records in FalkorDB for this user yet. Run the agent to persist one.
                  </div>
                )}
              </div>

              {/* Procedural Memory: Severed Edges */}
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>
                  Procedural Memory ([:SEVERED] edges)
                </div>
                {memoryData && memoryData.remediations && memoryData.remediations.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {memoryData.remediations.map((rem, i) => (
                      <div
                        key={i}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 6,
                          background: 'rgba(56,189,248,0.05)',
                          border: '1px solid rgba(56,189,248,0.2)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                        }}
                      >
                        <div style={{ color: '#38bdf8', fontWeight: 600 }}>✂ Severed Choke: {rem.node || rem.choke_point || 'CIRunnerRole'}</div>
                        <div style={{ color: '#94a3b8', fontSize: 9.5, marginTop: 2 }}>Agent skips this node in all future BFS traversals</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: '#475569', fontFamily: 'var(--font-mono)', fontStyle: 'italic' }}>
                    No severed choke points yet. Auto-apply a fix to record a [:SEVERED] edge.
                  </div>
                )}
              </div>

              {/* Live FalkorDB Engine Info */}
              <div
                style={{
                  marginTop: 'auto',
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9.5,
                  color: '#64748b',
                }}
              >
                Engine: <span style={{ color: '#34d399' }}>{memoryData?.engine || 'FalkorDB'}</span>
                <div style={{ marginTop: 2 }}>Memory Schema: <code>(:Incident)-[:SEVERED]</code></div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── CSS for spinner ─── */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
