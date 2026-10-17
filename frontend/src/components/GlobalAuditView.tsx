import React, { useState, useEffect } from 'react';
import { fetchGlobalAudit, GlobalAuditResult } from '../services/api';

interface GlobalAuditViewProps {
  onSelectUserToAttack: (userName: string) => void;
  onSelectUserBlastRadius: (userName: string) => void;
}

export const GlobalAuditView: React.FC<GlobalAuditViewProps> = ({
  onSelectUserToAttack,
  onSelectUserBlastRadius,
}) => {
  const [audit, setAudit] = useState<GlobalAuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterRisk, setFilterRisk] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const loadAudit = async () => {
    setLoading(true);
    try {
      const data = await fetchGlobalAudit();
      setAudit(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAudit();
  }, []);

  const filtered = audit?.identities.filter(i => {
    if (filterRisk !== 'ALL' && i.risk_level !== filterRisk) return false;
    if (searchQuery && !i.name.toLowerCase().includes(searchQuery.toLowerCase()) && !i.department.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  }) || [];

  return (
    <div
      className="page-pad"
      style={{
        flex: 1,
        height: '100%',
        overflowY: 'auto',
        padding: '24px 32px',
        background: 'transparent',
        color: '#e2e8f0',
        fontFamily: 'var(--font-sans, sans-serif)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div style={{ minWidth: 0, flex: '1 1 280px' }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 22 }}>🛰️</span>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
              Organization-Wide IAM Swarm Audit
            </h1>
            <span style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(56,189,248,0.15)', color: '#38bdf8', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
              FalkorDB Multi-Traversal
            </span>
          </div>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 12 }}>
            Autonomous Red Team sweep across all 45+ enterprise identities computing transitive paths to Crown Jewels.
          </p>
        </div>
        <button
          onClick={loadAudit}
          disabled={loading}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.05)',
            color: '#f1f5f9',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Auditing…' : '↺ Re-run Swarm Audit'}
        </button>
      </div>

      {/* Summary KPI Cards */}
      {audit && (
        <div className="stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>
              Total Identities Assessed
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#f8fafc' }}>
              {audit.total_assessed}
            </div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
              100% of IAM User Base
            </div>
          </div>

          <div style={{ background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#f87171', textTransform: 'uppercase', marginBottom: 6 }}>
              🚨 Critical Vulnerabilities
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#f87171' }}>
              {audit.critical_count}
            </div>
            <div style={{ fontSize: 10, color: '#fca5a5', marginTop: 4 }}>
              Direct Transitive Crown Jewel Reach
            </div>
          </div>

          <div style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#fbbf24', textTransform: 'uppercase', marginBottom: 6 }}>
              ⚠️ Medium / Elevated Blast
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#fbbf24' }}>
              {audit.medium_count}
            </div>
            <div style={{ fontSize: 10, color: '#fef08a', marginTop: 4 }}>
              Access to Internal Cloud Computes
            </div>
          </div>

          <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#34d399', textTransform: 'uppercase', marginBottom: 6 }}>
              🛡️ Least-Privilege Compliant
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#34d399' }}>
              {audit.low_count}
            </div>
            <div style={{ fontSize: 10, color: '#6ee7b7', marginTop: 4 }}>
              Zero Escalation Paths (Sandboxed)
            </div>
          </div>
        </div>
      )}

      {/* Filters & Search */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search by identity name or department…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            flex: '1 1 220px',
            minWidth: 0,
            maxWidth: 360,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            padding: '8px 14px',
            color: '#f8fafc',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            outline: 'none',
          }}
        />

        {['ALL', 'CRITICAL', 'MEDIUM', 'LOW'].map(lvl => (
          <button
            key={lvl}
            onClick={() => setFilterRisk(lvl)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: filterRisk === lvl ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
              background: filterRisk === lvl ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.02)',
              color: filterRisk === lvl ? '#38bdf8' : '#94a3b8',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              fontWeight: filterRisk === lvl ? 700 : 400,
            }}
          >
            {lvl}
          </button>
        ))}

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--font-mono)' }}>
          Showing {filtered.length} of {audit?.total_assessed || 0} identities
        </span>
      </div>

      {/* Identity Table */}
      <div
        style={{
          background: 'rgba(8, 14, 28, 0.85)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 12,
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
      >
        <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'left', color: '#64748b' }}>
              <th style={{ padding: '12px 16px' }}>Identity</th>
              <th style={{ padding: '12px 16px' }}>Department</th>
              <th style={{ padding: '12px 16px' }}>Risk Posture</th>
              <th style={{ padding: '12px 16px' }}>Blast Radius</th>
              <th style={{ padding: '12px 16px' }}>Target Asset / Hops</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => {
              const isCrit = item.risk_level === 'CRITICAL';
              const isMed = item.risk_level === 'MEDIUM';

              return (
                <tr
                  key={item.id}
                  style={{
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    background: isCrit ? 'rgba(244,63,94,0.03)' : 'transparent',
                    transition: 'background 150ms',
                  }}
                >
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: isCrit ? '#f87171' : '#f1f5f9' }}>
                    {isCrit ? '🚨 ' : '👤 '}
                    {item.name}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#94a3b8' }}>
                    {item.department}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        padding: '3px 8px',
                        borderRadius: 6,
                        fontSize: 10,
                        fontWeight: 700,
                        background: isCrit ? 'rgba(244,63,94,0.15)' : isMed ? 'rgba(251,191,36,0.15)' : 'rgba(16,185,129,0.15)',
                        color: isCrit ? '#f87171' : isMed ? '#fbbf24' : '#34d399',
                        border: `1px solid ${isCrit ? 'rgba(244,63,94,0.3)' : isMed ? 'rgba(251,191,36,0.3)' : 'rgba(16,185,129,0.3)'}`,
                      }}
                    >
                      {item.risk_level} ({item.risk_score})
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>
                    {item.blast_radius_resources} reachable assets
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {item.hops > 0 ? (
                      <span style={{ color: '#f87171' }}>
                        {item.target_jewel} ({item.hops} hops)
                      </span>
                    ) : (
                      <span style={{ color: '#475569' }}>None (0 hops)</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => onSelectUserBlastRadius(item.name)}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: 'rgba(56,189,248,0.1)',
                          border: '1px solid rgba(56,189,248,0.25)',
                          color: '#38bdf8',
                          fontSize: 10,
                          cursor: 'pointer',
                        }}
                      >
                        🌐 Blast Radius
                      </button>
                      <button
                        onClick={() => onSelectUserToAttack(item.name)}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: isCrit ? 'rgba(244,63,94,0.15)' : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${isCrit ? 'rgba(244,63,94,0.35)' : 'rgba(255,255,255,0.1)'}`,
                          color: isCrit ? '#f87171' : '#cbd5e1',
                          fontSize: 10,
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        ⚡ Simulate
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
