import React, { useEffect, useState, useCallback } from 'react';
import { fetchTriage, fetchChokepoints, TriageFinding, TriageResult } from '../services/api';

const SEV_COLOR: Record<string, string> = {
  CRITICAL: '#f87171',
  HIGH: '#fbbf24',
  MEDIUM: '#60a5fa',
  LOW: '#34d399',
};

const SEV_BG: Record<string, string> = {
  CRITICAL: 'rgba(248,113,113,0.12)',
  HIGH: 'rgba(251,191,36,0.1)',
  MEDIUM: 'rgba(96,165,250,0.1)',
  LOW: 'rgba(52,211,153,0.08)',
};

const REL_ICON: Record<string, string> = {
  CAN_ASSUME: '🎭',
  HAS_POLICY: '📋',
  MEMBER_OF: '👥',
  ATTACHED_TO: '🔗',
  CAN_ACCESS: '🔑',
};

function SeverityBadge({ sev }: { sev: string }) {
  return (
    <span style={{
      fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
      padding: '2px 8px', borderRadius: 999,
      color: SEV_COLOR[sev], background: SEV_BG[sev],
      border: `1px solid ${SEV_COLOR[sev]}40`,
    }}>
      {sev}
    </span>
  );
}

function ImpactBar({ score }: { score: number }) {
  const color = score >= 75 ? '#f87171' : score >= 50 ? '#fbbf24' : score >= 25 ? '#60a5fa' : '#34d399';
  return (
    <div className="impact-bar" style={{ width: 60, flexShrink: 0, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 3 }} />
    </div>
  );
}

function SummaryCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{
      flex: 1, minWidth: 100,
      padding: '14px 16px', borderRadius: 12,
      background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}30`,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{ fontSize: 24, fontFamily: 'var(--font-mono)', fontWeight: 800, color }}>{count}</span>
      <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{label}</span>
    </div>
  );
}

type SeverityFilter = 'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export const TriageView: React.FC = () => {
  const [result, setResult] = useState<TriageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SeverityFilter>('ALL');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chokepoints, setChokepoints] = useState<{ node: string; betweenness_score: number }[]>([]);
  const [showChokepoints, setShowChokepoints] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, c] = await Promise.all([fetchTriage(200), fetchChokepoints(8)]);
      setResult(t);
      setChokepoints(c.chokepoints);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load triage data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = result?.findings.filter(f => {
    if (filter !== 'ALL' && f.severity !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return f.src.toLowerCase().includes(q) || f.dst.toLowerCase().includes(q) || f.rel_type.toLowerCase().includes(q);
    }
    return true;
  }) ?? [];

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
      <span>Scanning permission graph…</span>
    </div>
  );

  if (error) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
      <span style={{ color: '#f87171', fontFamily: 'var(--font-mono)', fontSize: 13 }}>⚠ {error}</span>
      <button onClick={load} style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#cbd5e1', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Retry</button>
    </div>
  );

  const sc = result?.severity_counts ?? {};

  return (
    <div className="triage" style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-mono)' }}>
      {/* Header */}
      <div className="triage-head" style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px 12px', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: '#f1f5f9', fontWeight: 800 }}>Findings Triage</h2>
          <span style={{ fontSize: 12, color: '#475569' }}>{result?.headline}</span>
          <div style={{ flex: 1 }} />
          <button onClick={() => setShowChokepoints(v => !v)}
            style={{ padding: '5px 12px', borderRadius: 8, background: showChokepoints ? 'rgba(192,132,252,0.15)' : 'rgba(255,255,255,0.05)', border: `1px solid ${showChokepoints ? '#c084fc' : 'rgba(255,255,255,0.08)'}`, color: showChokepoints ? '#c084fc' : '#94a3b8', fontSize: 11, cursor: 'pointer' }}>
            ⬡ Chokepoints
          </button>
          <button onClick={load} style={{ padding: '5px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>↺ Refresh</button>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <SummaryCard label="Critical" count={sc.CRITICAL ?? 0} color="#f87171" />
          <SummaryCard label="High" count={sc.HIGH ?? 0} color="#fbbf24" />
          <SummaryCard label="Medium" count={sc.MEDIUM ?? 0} color="#60a5fa" />
          <SummaryCard label="Low" count={sc.LOW ?? 0} color="#34d399" />
          <SummaryCard label="Total findings" count={result?.total_findings ?? 0} color="#94a3b8" />
        </div>

        {/* Chokepoints panel */}
        {showChokepoints && chokepoints.length > 0 && (
          <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 10, background: 'rgba(192,132,252,0.06)', border: '1px solid rgba(192,132,252,0.2)' }}>
            <div style={{ fontSize: 11, color: '#c084fc', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase' }}>Top chokepoints by betweenness centrality</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {chokepoints.map(cp => (
                <div key={cp.node} style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(192,132,252,0.1)', border: '1px solid rgba(192,132,252,0.25)', fontSize: 11, color: '#e2d4f8' }}>
                  {cp.node} <span style={{ color: '#7c3aed' }}>· {cp.betweenness_score.toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {(['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as SeverityFilter[]).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              style={{
                padding: '4px 12px', borderRadius: 999, fontSize: 11, cursor: 'pointer',
                background: filter === s ? (SEV_BG[s] ?? 'rgba(255,255,255,0.08)') : 'transparent',
                border: `1px solid ${filter === s ? (SEV_COLOR[s] ?? 'rgba(255,255,255,0.15)') : 'rgba(255,255,255,0.08)'}`,
                color: filter === s ? (SEV_COLOR[s] ?? '#f1f5f9') : '#475569',
              }}>
              {s}
            </button>
          ))}
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filter by name or type…"
            style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#cbd5e1', fontSize: 11, outline: 'none', width: 200, maxWidth: '100%' }}
          />
        </div>
      </div>

      {/* Findings list */}
      <div className="triage-list" style={{ flex: 1, overflowY: 'auto', padding: '8px 24px 24px' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#475569', fontSize: 13 }}>No findings match the current filter.</div>
        ) : filtered.map((f, i) => {
          const isOpen = expanded === f.finding_id;
          return (
            <div key={f.finding_id}
              onClick={() => setExpanded(isOpen ? null : f.finding_id)}
              style={{
                marginBottom: 6, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                background: isOpen ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isOpen ? SEV_COLOR[f.severity] + '40' : 'rgba(255,255,255,0.05)'}`,
                transition: 'all 150ms ease',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 28, color: '#475569', fontSize: 10, textAlign: 'right', flexShrink: 0 }}>#{i + 1}</span>
                <span style={{ fontSize: 14 }}>{REL_ICON[f.rel_type] ?? '🔒'}</span>
                <span className="triage-path" style={{ fontSize: 12, color: '#cbd5e1', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{f.src}</span>
                  <span style={{ color: '#475569' }}> —{f.rel_type}→ </span>
                  <span style={{ color: f.dst_is_crown_jewel ? '#fbbf24' : '#f1f5f9', fontWeight: f.dst_is_crown_jewel ? 700 : 400 }}>{f.dst}</span>
                  {f.dst_is_crown_jewel && <span style={{ fontSize: 12, marginLeft: 4 }}>⭐</span>}
                </span>
                <ImpactBar score={f.impact_score} />
                <span style={{ fontSize: 11, color: '#475569', width: 30, textAlign: 'right' }}>{f.impact_score}</span>
                <SeverityBadge sev={f.severity} />
              </div>

              {isOpen && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '6px 24px', fontSize: 11 }}>
                  {[
                    ['Source', `${f.src} (${f.src_label})`],
                    ['Destination', `${f.dst} (${f.dst_label})`],
                    ['Permission', f.rel_type],
                    ['Crown Jewel path', f.src_reaches_crown_jewel ? '✓ Yes' : 'No'],
                    ['Blast radius', `${f.blast_radius} assets`],
                    ['Betweenness', f.betweenness.toFixed(2)],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: '#475569' }}>{k}</span>
                      <span style={{ color: '#cbd5e1', fontWeight: 500 }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ gridColumn: '1/-1', marginTop: 6, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', color: '#94a3b8', lineHeight: 1.5 }}>
                    💡 {f.recommendation}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
