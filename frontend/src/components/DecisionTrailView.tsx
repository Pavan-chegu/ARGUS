/**
 * DecisionTrailView — renders the recorded decision trail of the red/blue team agents.
 *
 * Data comes from the trace router:
 *   GET /api/trace/latest?entrypoint=…
 *   GET /api/trace/run/{run_id}
 *   GET /api/trace/incident/{incident_id}
 *
 * Each decision shows what the agent chose, the alternatives it scored, and which
 * memory nodes (:Incident / :Remediation) from earlier sessions informed it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DecisionTrace,
  TraceDecision,
  TraceMemoryRef,
  SwarmEntrypoint,
  fetchLatestTrace,
  fetchTraceByRun,
  fetchTraceByIncident,
  fetchSwarmEntrypoints,
} from '../services/api';

interface DecisionTrailViewProps {
  /** Entrypoint selected in the navbar; used as the default picker value. */
  selectedEntrypoint?: string;
  /** When set (e.g. from "View decision trail" on an attack result), load this run. */
  runId?: string | null;
  /** Bumped by the parent to force a reload of the same runId. */
  requestNonce?: number;
}

type LoadSource =
  | { kind: 'latest'; entrypoint: string }
  | { kind: 'run'; id: string }
  | { kind: 'incident'; id: string };

const FALLBACK_ENTRYPOINTS: SwarmEntrypoint[] = [
  { name: 'DevIntern' }, { name: 'Contractor' }, { name: 'SupportUser' },
];

const TEAM_STYLE = {
  red: { color: '#f87171', bg: 'rgba(244,63,94,0.06)', border: 'rgba(244,63,94,0.25)', label: 'Red Team', icon: '⚡' },
  blue: { color: '#38bdf8', bg: 'rgba(56,189,248,0.06)', border: 'rgba(56,189,248,0.25)', label: 'Blue Team', icon: '⊕' },
  other: { color: '#c084fc', bg: 'rgba(192,132,252,0.06)', border: 'rgba(192,132,252,0.25)', label: 'Other agents', icon: '◈' },
} as const;

type TeamKey = keyof typeof TEAM_STYLE;

function teamOf(agentId: string): TeamKey {
  const a = (agentId || '').toLowerCase();
  if (a.includes('red')) return 'red';
  if (a.includes('blue')) return 'blue';
  return 'other';
}

function formatTs(ts: number | string): string {
  if (ts === null || ts === undefined || ts === '') return '';
  let d: Date;
  if (typeof ts === 'number') {
    d = new Date(ts < 1e12 ? ts * 1000 : ts);
  } else {
    const n = Number(ts);
    d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(ts);
  }
  return isNaN(d.getTime()) ? String(ts) : d.toLocaleTimeString();
}

function fmtScore(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// ─── Memory chip ────────────────────────────────────────────────────────────
const MemoryChip: React.FC<{ mem: TraceMemoryRef }> = ({ mem }) => {
  const isIncident = (mem.label || '').toLowerCase() === 'incident';
  const color = isIncident ? '#fbbf24' : '#34d399';
  return (
    <span
      title={mem.summary || mem.id}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%',
        padding: '3px 9px', borderRadius: 999,
        background: `${color}14`, border: `1px solid ${color}45`,
        fontSize: 10, fontFamily: 'var(--font-mono)', color,
      }}
    >
      <span>{isIncident ? '🧠' : '✂'}</span>
      <span style={{ fontWeight: 700 }}>:{mem.label || 'Memory'}</span>
      <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {mem.summary || mem.id}
      </span>
    </span>
  );
};

// ─── Considered alternatives ────────────────────────────────────────────────
const ConsideredList: React.FC<{ decision: TraceDecision; color: string }> = ({ decision, color }) => {
  const items = [...(decision.considered || [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (items.length === 0) return null;
  const max = Math.max(1, ...items.map(i => Math.abs(i.score ?? 0)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 9.5, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Considered ({items.length})
      </div>
      {items.map((c, i) => {
        const isChosen = decision.chosen != null && c.name === decision.chosen;
        return (
          <div key={`${c.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5 }}>
            <span style={{
              width: 150, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: isChosen ? '#f1f5f9' : '#94a3b8', fontWeight: isChosen ? 700 : 400,
            }}>
              {isChosen ? '▸ ' : ''}{c.name}
            </span>
            <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${Math.max(2, (Math.abs(c.score ?? 0) / max) * 100)}%`, height: '100%', borderRadius: 3,
                background: isChosen ? color : 'rgba(148,163,184,0.45)',
              }} />
            </div>
            <span style={{ width: 52, textAlign: 'right', color: isChosen ? color : '#64748b' }}>{fmtScore(c.score)}</span>
          </div>
        );
      })}
    </div>
  );
};

// ─── Timeline item ──────────────────────────────────────────────────────────
const DecisionItem: React.FC<{ decision: TraceDecision; team: TeamKey; isLast: boolean }> = ({ decision, team, isLast }) => {
  const t = TEAM_STYLE[team];
  const memories = decision.informed_by || [];
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {/* Rail */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div style={{
          width: 26, height: 26, borderRadius: '50%',
          background: `${t.color}20`, border: `1px solid ${t.color}60`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, color: t.color, fontWeight: 700,
        }}>
          {decision.step}
        </div>
        {!isLast && <div style={{ flex: 1, width: 1, background: `${t.color}30`, minHeight: 16 }} />}
      </div>

      {/* Card */}
      <div style={{
        flex: 1, minWidth: 0, marginBottom: 12, padding: '10px 12px', borderRadius: 10,
        background: 'rgba(255,255,255,0.02)', border: `1px solid ${memories.length > 0 ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.06)'}`,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9' }}>{decision.action || 'decision'}</span>
          {decision.chosen && (
            <span style={{
              padding: '2px 8px', borderRadius: 6, fontSize: 10.5,
              background: `${t.color}18`, border: `1px solid ${t.color}40`, color: t.color, fontWeight: 600,
            }}>
              → {decision.chosen}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: '#64748b' }}>score {fmtScore(decision.score)}</span>
          {decision.ts !== undefined && <span style={{ fontSize: 10, color: '#334155' }}>{formatTs(decision.ts)}</span>}
        </div>

        {decision.reason && (
          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.55 }}>{decision.reason}</div>
        )}

        <ConsideredList decision={decision} color={t.color} />

        {memories.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 9.5, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Informed by memory from earlier sessions
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {memories.map((m, i) => <MemoryChip key={`${m.id}-${i}`} mem={m} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Team column ────────────────────────────────────────────────────────────
const TeamColumn: React.FC<{ team: TeamKey; decisions: TraceDecision[] }> = ({ team, decisions }) => {
  const t = TEAM_STYLE[team];
  const agentIds = Array.from(new Set(decisions.map(d => d.agent_id).filter(Boolean)));
  return (
    <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 12, borderRadius: 10,
        background: t.bg, border: `1px solid ${t.border}`,
      }}>
        <span>{t.icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: t.color }}>{t.label}</span>
        <span style={{ fontSize: 10, color: '#64748b' }}>{agentIds.join(', ')}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: '#64748b' }}>{decisions.length} decision{decisions.length === 1 ? '' : 's'}</span>
      </div>
      {decisions.length === 0 ? (
        <div style={{ padding: 16, fontSize: 11, color: '#475569', fontStyle: 'italic' }}>No decisions recorded for this agent.</div>
      ) : decisions.map((d, i) => (
        <DecisionItem key={d.id || `${team}-${i}`} decision={d} team={team} isLast={i === decisions.length - 1} />
      ))}
    </div>
  );
};

// ─── Main view ──────────────────────────────────────────────────────────────
export const DecisionTrailView: React.FC<DecisionTrailViewProps> = ({
  selectedEntrypoint = 'DevIntern',
  runId = null,
  requestNonce = 0,
}) => {
  const [entrypoints, setEntrypoints] = useState<SwarmEntrypoint[]>(FALLBACK_ENTRYPOINTS);
  const [entrypoint, setEntrypoint] = useState<string>(selectedEntrypoint);
  const [idInput, setIdInput] = useState('');
  const [trace, setTrace] = useState<DecisionTrace | null>(null);
  const [source, setSource] = useState<LoadSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [showCypher, setShowCypher] = useState(false);

  useEffect(() => {
    fetchSwarmEntrypoints()
      .then(list => { if (list.length > 0) setEntrypoints(list); })
      .catch(() => { /* keep fallback list */ });
  }, []);

  const load = useCallback(async (src: LoadSource) => {
    setSource(src);
    setLoading(true);
    setError(null);
    try {
      const data = src.kind === 'latest'
        ? await fetchLatestTrace(src.entrypoint)
        : src.kind === 'run'
          ? await fetchTraceByRun(src.id)
          : await fetchTraceByIncident(src.id);
      if (src.kind === 'latest' && data.decisions.length === 0) {
        setTrace(null);
        setError({ message: 'No decision trail recorded yet', notFound: true });
        return;
      }
      setTrace(data);
    } catch (e: any) {
      setTrace(null);
      setError({ message: e?.message ?? 'Failed to load decision trail', notFound: e?.status === 404 });
    } finally {
      setLoading(false);
    }
  }, []);

  // Load a specific run when the parent hands one over; otherwise the latest for the entrypoint.
  useEffect(() => {
    if (runId) {
      setIdInput(runId);
      load({ kind: 'run', id: runId });
    } else {
      load({ kind: 'latest', entrypoint: selectedEntrypoint });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, requestNonce]);

  useEffect(() => { setEntrypoint(selectedEntrypoint); }, [selectedEntrypoint]);

  const grouped = useMemo(() => {
    const g: Record<TeamKey, TraceDecision[]> = { red: [], blue: [], other: [] };
    for (const d of trace?.decisions ?? []) g[teamOf(d.agent_id)].push(d);
    (Object.keys(g) as TeamKey[]).forEach(k => g[k].sort((a, b) => (a.step ?? 0) - (b.step ?? 0)));
    return g;
  }, [trace]);

  const memoryRefCount = useMemo(
    () => (trace?.decisions ?? []).reduce((n, d) => n + (d.informed_by?.length ?? 0), 0),
    [trace],
  );

  const sourceLabel = source
    ? source.kind === 'latest' ? `latest run for ${source.entrypoint}` : `${source.kind} ${source.id}`
    : '';

  const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
    color: '#cbd5e1', fontSize: 11, fontFamily: 'var(--font-mono)', padding: '5px 10px', outline: 'none',
    maxWidth: '100%', minWidth: 0,
  };
  const btnStyle = (accent: string): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 8, fontSize: 11, fontFamily: 'var(--font-mono)', cursor: loading ? 'not-allowed' : 'pointer',
    background: `${accent}18`, border: `1px solid ${accent}50`, color: accent, fontWeight: 600, whiteSpace: 'nowrap',
  });

  return (
    <div className="triage" style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-mono)' }}>
      {/* Header */}
      <div className="triage-head" style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 18, color: '#f1f5f9', fontWeight: 800 }}>Decision Trail</h2>
          <span style={{ fontSize: 12, color: '#475569' }}>
            Why each agent picked each hop, and which past incidents or remediations shaped that choice.
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#475569', fontSize: 10 }}>ENTRY →</span>
          <select value={entrypoint} onChange={e => setEntrypoint(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
            {!entrypoints.some(ep => ep.name === entrypoint) && <option value={entrypoint}>{entrypoint}</option>}
            {entrypoints.map(ep => (
              <option key={ep.name} value={ep.name}>
                {ep.name}{ep.department ? ` (${ep.department})` : ''}
              </option>
            ))}
          </select>
          <button disabled={loading} onClick={() => load({ kind: 'latest', entrypoint })} style={btnStyle('#38bdf8')}>
            ↓ Load latest trail
          </button>

          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.06)', margin: '0 4px' }} />

          <input
            value={idInput}
            onChange={e => setIdInput(e.target.value)}
            placeholder="run_id or incident id"
            style={{ ...inputStyle, width: 220 }}
          />
          <button disabled={loading || !idInput.trim()} onClick={() => load({ kind: 'run', id: idInput.trim() })} style={btnStyle('#94a3b8')}>
            By run
          </button>
          <button disabled={loading || !idInput.trim()} onClick={() => load({ kind: 'incident', id: idInput.trim() })} style={btnStyle('#fbbf24')}>
            By incident
          </button>
        </div>

        {/* Summary row */}
        {trace && (
          <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 10.5, color: '#475569', flexWrap: 'wrap' }}>
            <span>run_id: <span style={{ color: '#cbd5e1' }}>{trace.run_id ?? '—'}</span></span>
            <span>incident: <span style={{ color: '#cbd5e1' }}>{trace.incident_id ?? '—'}</span></span>
            <span>decisions: <span style={{ color: '#f1f5f9' }}>{trace.decisions.length}</span></span>
            <span>memory references: <span style={{ color: memoryRefCount > 0 ? '#fbbf24' : '#f1f5f9' }}>{memoryRefCount}</span></span>
            <span style={{ color: '#334155' }}>source: {sourceLabel}</span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="triage-list" style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
        {loading && (
          <div style={{ padding: 48, textAlign: 'center', color: '#475569', fontSize: 13 }}>Loading decision trail…</div>
        )}

        {!loading && error && (
          <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
            {error.notFound ? (
              <>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>No decision trail recorded for {sourceLabel || 'this selection'} yet.</span>
                <span style={{ fontSize: 11, color: '#475569', maxWidth: 480, lineHeight: 1.6 }}>
                  Run an attack from Investigate or the Agent tab, then load the latest trail. If the trace API is not deployed on this backend, this view stays empty.
                </span>
              </>
            ) : (
              <span style={{ color: '#f87171', fontSize: 13 }}>⚠ {error.message}</span>
            )}
            {source && (
              <button onClick={() => load(source)} style={btnStyle('#94a3b8')}>↺ Retry</button>
            )}
          </div>
        )}

        {!loading && !error && trace && (
          <>
            {/* Cypher panel */}
            <div style={{ marginBottom: 16, borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.35)' }}>
              <button
                onClick={() => setShowCypher(v => !v)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                  background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'var(--font-mono)', fontSize: 11, color: '#38bdf8',
                }}
              >
                <span style={{ fontSize: 9 }}>{showCypher ? '▼' : '▶'}</span>
                <span style={{ fontWeight: 700 }}>Graph query behind this trail</span>
                <span style={{ color: '#475569' }}>(Cypher)</span>
              </button>
              {showCypher && (
                <pre style={{
                  margin: 0, padding: '0 12px 12px', fontSize: 10.5, color: '#38bdf8',
                  fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', lineHeight: 1.55, overflowX: 'auto',
                }}>
                  {trace.cypher || '-- backend did not return a query string'}
                </pre>
              )}
            </div>

            {trace.decisions.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center', color: '#475569', fontSize: 13 }}>
                This run has no recorded decisions.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <TeamColumn team="red" decisions={grouped.red} />
                <TeamColumn team="blue" decisions={grouped.blue} />
                {grouped.other.length > 0 && <TeamColumn team="other" decisions={grouped.other} />}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
