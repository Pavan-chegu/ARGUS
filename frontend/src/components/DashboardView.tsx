/**
 * DashboardView — The hero "home" screen.
 * Shows live system stats, FalkorDB vs Vector RAG comparison, 
 * and a "Start Demo" button that runs the full red→blue cycle.
 */
import React, { useState, useEffect } from 'react';
import { fetchGraphOverview, fetchTriageSummary, TriageSummary } from '../services/api';

interface DashboardViewProps {
  onStartDemo: () => void;
  onChangeTab: (tab: string) => void;
  isAttacking?: boolean;
}

interface OverviewStats {
  total_nodes: number;
  total_edges: number;
  users: string[];
  crown_jewels: string[];
  health?: Record<string, any>;
}

const StatCard: React.FC<{
  value: string | number;
  label: string;
  sublabel?: string;
  color?: string;
  glowColor?: string;
  icon?: string;
}> = ({ value, label, sublabel, color = '#38bdf8', glowColor, icon }) => (
  <div
    style={{
      background: 'rgba(8,14,28,0.9)',
      border: `1px solid ${color}20`,
      borderRadius: 16,
      padding: '20px 24px',
      position: 'relative',
      overflow: 'hidden',
    }}
  >
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 2,
      background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
    }} />
    {icon && (
      <div style={{ fontSize: 22, marginBottom: 8 }}>{icon}</div>
    )}
    <div style={{
      fontSize: 32, fontWeight: 800,
      fontFamily: 'var(--font-mono)',
      color,
      textShadow: glowColor ? `0 0 20px ${glowColor}` : undefined,
      letterSpacing: '-0.02em',
      lineHeight: 1,
      marginBottom: 6,
    }}>
      {value}
    </div>
    <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {label}
    </div>
    {sublabel && (
      <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>{sublabel}</div>
    )}
  </div>
);

const CompareRow: React.FC<{
  label: string;
  vectorValue: string;
  falkorValue: string;
  vectorBad?: boolean;
}> = ({ label, vectorValue, falkorValue, vectorBad = true }) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 0,
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  }}>
    <div style={{ padding: '10px 16px', fontSize: 11, color: '#64748b', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center' }}>
      {label}
    </div>
    <div style={{
      padding: '10px 16px', fontSize: 11, fontFamily: 'var(--font-mono)',
      color: vectorBad ? '#f87171' : '#34d399',
      borderLeft: '1px solid rgba(255,255,255,0.04)',
      display: 'flex', alignItems: 'center', gap: 5,
    }}>
      {vectorBad ? '✗' : '✓'} {vectorValue}
    </div>
    <div style={{
      padding: '10px 16px', fontSize: 11, fontFamily: 'var(--font-mono)',
      color: '#34d399',
      borderLeft: '1px solid rgba(255,255,255,0.04)',
      display: 'flex', alignItems: 'center', gap: 5,
    }}>
      ✓ {falkorValue}
    </div>
  </div>
);

export const DashboardView: React.FC<DashboardViewProps> = ({ onStartDemo, onChangeTab, isAttacking }) => {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [triage, setTriage] = useState<TriageSummary | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const [uptimeSeconds, setUptimeSeconds] = useState(0);

  useEffect(() => {
    fetchGraphOverview().then(d => setStats(d)).catch(() => {});
    fetchTriageSummary().then(d => setTriage(d)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(() => setUptimeSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const uptimeStr = `${String(Math.floor(uptimeSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((uptimeSeconds % 3600) / 60)).padStart(2, '0')}:${String(uptimeSeconds % 60).padStart(2, '0')}`;

  const handleDemo = async () => {
    setDemoRunning(true);
    onStartDemo();
    setTimeout(() => setDemoRunning(false), 2000);
  };

  return (
    <div
      className="page-pad"
      style={{
        flex: 1,
        height: '100%',
        overflowY: 'auto',
        padding: '28px 36px',
        background: 'transparent',
        color: '#e2e8f0',
        fontFamily: 'var(--font-sans)',
        position: 'relative',
      }}
    >
      {/* Subtle grid bg */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
      }} />

      <div style={{ position: 'relative', maxWidth: 1100 }}>
        {/* Hero */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12,
              background: 'linear-gradient(135deg, #dc2626, #ea580c)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, boxShadow: '0 0 24px rgba(244,63,94,0.4)',
            }}>
              ⬡
            </div>
            <div>
              <h1 className="text-gradient-brand text-gradient-animated" style={{
                margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em',
              }}>
                ARGUS CloudMesh
              </h1>
              <p style={{ margin: 0, fontSize: 12, color: '#475569', fontFamily: 'var(--font-mono)' }}>
                Autonomous IAM Attack Pathfinder — Powered by FalkorDB GraphBLAS
              </p>
            </div>
          </div>

          <p style={{
            margin: 0, fontSize: 14, color: '#64748b', maxWidth: 700,
            lineHeight: 1.7,
          }}>
            Uses a <strong style={{ color: '#38bdf8' }}>live property graph</strong> in FalkorDB to discover multi-hop IAM privilege escalation chains by direct traversal.
            Multi-hop chains are hard to recover from per-policy text retrieval; on a graph every hop is an explicit edge.
          </p>
        </div>

        {/* CTA */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 36, flexWrap: 'wrap' }}>
          <button
            onClick={handleDemo}
            disabled={demoRunning || isAttacking}
            style={{
              padding: '12px 24px', borderRadius: 12,
              background: 'linear-gradient(135deg, #be123c, #e11d48)',
              border: '1px solid rgba(244,63,94,0.4)',
              color: 'white', fontWeight: 800, fontSize: 13,
              fontFamily: 'var(--font-mono)', cursor: (demoRunning || isAttacking) ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 24px rgba(244,63,94,0.35)',
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'all 200ms',
              opacity: (demoRunning || isAttacking) ? 0.7 : 1,
            }}
          >
            {demoRunning || isAttacking ? (
              <>
                <span style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                Running Live Demo…
              </>
            ) : (
              <>⚡ Run Full Demo (Red → Blue → Patch)</>
            )}
          </button>

          <button
            onClick={() => onChangeTab('copilot')}
            style={{
              padding: '12px 20px', borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.15), rgba(56, 189, 248, 0.15))',
              border: '1px solid rgba(6, 182, 212, 0.4)',
              color: '#38bdf8', fontWeight: 700, fontSize: 13,
              fontFamily: 'var(--font-mono)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              boxShadow: '0 4px 16px rgba(6, 182, 212, 0.2)',
            }}
          >
            🧠 Graph RAG Copilot
          </button>

          <button
            onClick={() => onChangeTab('graph')}
            style={{
              padding: '12px 20px', borderRadius: 12,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#94a3b8', fontWeight: 600, fontSize: 13,
              fontFamily: 'var(--font-mono)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            ⬡ Open Attack Graph
          </button>

          <button
            onClick={() => onChangeTab('audit')}
            style={{
              padding: '12px 20px', borderRadius: 12,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#94a3b8', fontWeight: 600, fontSize: 13,
              fontFamily: 'var(--font-mono)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            🛰️ Global Threat Audit
          </button>
        </div>

        {/* Stats grid */}
        <div className="stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 36 }}>
          <StatCard
            value={stats?.total_nodes ?? '…'}
            label="IAM Nodes"
            sublabel="Users, Roles, Policies, Resources"
            color="#38bdf8"
            icon="⬡"
          />
          <StatCard
            value={stats?.total_edges ?? '…'}
            label="Permission Edges"
            sublabel="Trust relationships mapped"
            color="#c084fc"
            icon="⇌"
          />
          <StatCard
            value={stats?.crown_jewels ? `${stats.crown_jewels.length}` : '…'}
            label="Crown Jewels"
            sublabel="Critical protected assets"
            color="#fbbf24"
            glowColor="rgba(251,191,36,0.4)"
            icon="💎"
          />
          <StatCard
            value={triage
              ? ((triage.severity_counts?.['CRITICAL'] ?? 0) + (triage.severity_counts?.['HIGH'] ?? 0))
              : '…'}
            label="Critical Findings"
            sublabel={triage?.headline ?? 'Loading triage…'}
            color="#f87171"
            glowColor="rgba(248,113,113,0.3)"
            icon="⚠"
          />
          <StatCard
            value={triage && typeof triage.execution_time_ms === 'number' ? `${triage.execution_time_ms.toFixed(1)}ms` : '…'}
            label="Triage Scan Time"
            sublabel="Measured on this load (/api/triage/summary)"
            color="#34d399"
            glowColor="rgba(52,211,153,0.3)"
            icon="⚡"
          />
        </div>

        {/* Live status bar */}
        <div style={{
          display: 'flex', gap: 16, padding: '10px 16px',
          background: 'rgba(8,14,28,0.8)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 10, marginBottom: 36,
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            {(() => {
              const mode = stats?.health?.mode;
              const label = !stats ? 'CHECKING…' : mode === 'live' ? 'ONLINE' : mode ? `FALLBACK (${String(mode)})` : 'UNKNOWN';
              const c = mode === 'live' ? '#34d399' : stats ? '#fbbf24' : '#64748b';
              return (
                <>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}` }} />
                  <span style={{ color: '#475569' }}>FalkorDB Engine</span>
                  <span style={{ color: c, fontWeight: 700 }}>{label}</span>
                </>
              );
            })()}
          </div>
          <div style={{ width: 1, background: 'rgba(255,255,255,0.06)' }} />
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#475569' }}>
            Session uptime: <span style={{ color: '#64748b' }}>{uptimeStr}</span>
          </div>
          <div style={{ width: 1, background: 'rgba(255,255,255,0.06)' }} />
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#475569' }}>
            Crown jewels: {stats?.crown_jewels?.join(', ') ?? 'loading…'}
          </div>
        </div>

        {/* FalkorDB vs Vector RAG comparison */}
        <div style={{ marginBottom: 36 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
            Graph vs Vector Retrieval
          </h2>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: '#64748b' }}>
            Qualitative comparison. Vector-side behaviour is not measured here; see Benchmark (simulated baseline) for details.
          </p>

          <div className="scroll-x" style={{
            background: 'rgba(8,14,28,0.9)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 14, overflowY: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ padding: '12px 16px', fontSize: 10, fontFamily: 'var(--font-mono)', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Capability
              </div>
              <div style={{
                padding: '12px 16px', fontSize: 10, fontFamily: 'var(--font-mono)',
                color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.1em',
                borderLeft: '1px solid rgba(255,255,255,0.04)',
                background: 'rgba(244,63,94,0.03)',
              }}>
                Vector RAG (Embeddings)
              </div>
              <div style={{
                padding: '12px 16px', fontSize: 10, fontFamily: 'var(--font-mono)',
                color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.1em',
                borderLeft: '1px solid rgba(255,255,255,0.04)',
                background: 'rgba(16,185,129,0.04)',
              }}>
                FalkorDB Cypher Graph
              </div>
            </div>

            <CompareRow label="Multi-hop traversal" vectorValue="Cannot — cosine similarity fails at depth 2+" falkorValue="Native shortestPath() — unlimited hops" />
            <CompareRow label="Query latency" vectorValue="Not measured (embedding + ANN search)" falkorValue="Measured live per query (see Benchmark)" />
            <CompareRow label="Path grounding" vectorValue="Can miss or infer links between chunks" falkorValue="Each reported hop is an existing edge" />
            <CompareRow label="Multi-hop path recovery" vectorValue="Limited to what top-k chunks contain" falkorValue="Exact path within the traversal depth" />
            <CompareRow label="Auto-remediation" vectorValue="Cannot — no structural awareness" falkorValue="Min-cut choke point + Terraform HCL" />
            <CompareRow label="Blast radius compute" vectorValue="N/A — no graph structure" falkorValue="Reachable node set in O(E+V)" vectorBad={true} />
          </div>
        </div>

        {/* How it works */}
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
            How It Works
          </h2>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: '#64748b' }}>
            A 3-phase autonomous agent loop powered by FalkorDB graph traversal.
          </p>

          <div className="stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            {[
              {
                step: '01',
                color: '#f43f5e',
                icon: '⚡',
                title: 'Red Team Agent',
                desc: 'Executes Cypher shortestPath() to find multi-hop IAM privilege escalation chains from any identity to Crown Jewel assets. Runs as a single Cypher query on FalkorDB.',
                tab: 'graph',
              },
              {
                step: '02',
                color: '#34d399',
                icon: '⊕',
                title: 'Blue Team Remediator',
                desc: 'Analyzes the attack path, computes the graph-theoretic min-cut choke point, and synthesizes an exact Terraform HCL patch to sever the edge that breaks the discovered escalation path.',
                tab: 'graph',
              },
              {
                step: '03',
                color: '#38bdf8',
                icon: '🛡️',
                title: 'Patch & Verify',
                desc: 'Applies the remediation directly in FalkorDB by deleting the choke point edge, then re-runs the attack simulation to check whether an escalation path remains. Full audit trail maintained.',
                tab: 'graph',
              },
            ].map(item => (
              <div
                key={item.step}
                onClick={() => onChangeTab(item.tab as any)}
                style={{
                  background: 'rgba(8,14,28,0.9)',
                  border: `1px solid ${item.color}15`,
                  borderRadius: 14, padding: '18px 20px',
                  cursor: 'pointer',
                  transition: 'all 200ms',
                  position: 'relative', overflow: 'hidden',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = `${item.color}35`; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = `${item.color}15`; }}
              >
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                  background: `linear-gradient(90deg, transparent, ${item.color}, transparent)`,
                }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: `${item.color}15`, border: `1px solid ${item.color}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14,
                  }}>{item.icon}</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9,
                    color: item.color, fontWeight: 700, letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                  }}>Phase {item.step}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 6 }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.6 }}>
                  {item.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
};
