import React, { useEffect, useState, useRef } from 'react';

const EngineBadge: React.FC = () => {
  const [h, setH] = useState<any>(null);
  useEffect(() => {
    const load = () => fetch('/api/graph/overview').then(r => r.json()).then(d => setH(d.health)).catch(() => setH({ mode: 'down' }));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  if (!h) return null;
  const live = h.mode === 'live';
  const color = live ? '#22c55e' : '#ef4444';
  return (
    <span title={h.engine || ''} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '3px 8px', borderRadius: 999,
      border: `1px solid ${color}`, color, flexShrink: 0, whiteSpace: 'nowrap' }}>
      {live ? `● LIVE FalkorDB · ${h.nodes ?? '?'} nodes · ${h.memory?.Incident ?? 0} incidents` : h.mode === 'down' ? '● Backend offline' : '● FALLBACK (not FalkorDB)'}
    </span>
  );
};

export type ActiveTab = 'home' | 'triage' | 'graph' | 'swarm' | 'copilot' | 'audit' | 'whatif' | 'benchmark' | 'scorecard' | 'playground';

interface NavbarProps {
  activeTab: ActiveTab;
  onChangeTab: (tab: ActiveTab) => void;
  selectedEntrypoint: string;
  onSelectEntrypoint: (ep: string) => void;
  onRunAttack: () => void;
  onResetGraph: () => void;
  isAttacting: boolean;
  isRemediated: boolean;
  totalNodes: number;
  availableIdentities?: Array<{ id: string; name: string; department?: string; is_compromised?: boolean }>;
  onOpenJudgeTour?: () => void;
  onOpenMcpModal?: () => void;
}

const PRIMARY_TABS: { id: ActiveTab; icon: string; label: string }[] = [
  { id: 'home',    icon: '◈', label: 'Dashboard'   },
  { id: 'triage',  icon: '⚠', label: 'Triage'      },
  { id: 'graph',   icon: '⬡', label: 'Investigate' },
  { id: 'swarm',   icon: '🤖', label: 'Agent Swarm'},
  { id: 'copilot', icon: '🧠', label: 'Ask Copilot'},
];

const MORE_TABS: { id: ActiveTab; icon: string; label: string; desc: string }[] = [
  { id: 'benchmark',  icon: '⚡', label: 'Benchmark',    desc: 'Vector vs Graph RAG comparison' },
  { id: 'audit',      icon: '🛰️', label: 'Global Audit', desc: 'Org-wide IAM blast radii'      },
  { id: 'whatif',     icon: '🔮', label: 'What-If Sim',  desc: 'Simulate policy modifications' },
  { id: 'scorecard',  icon: '📊', label: 'Scorecard',    desc: 'Executive compliance scorecard'},
  { id: 'playground', icon: '💻', label: 'Playground',   desc: 'Direct FalkorDB Cypher query'  },
];

export const Navbar: React.FC<NavbarProps> = ({
  activeTab, onChangeTab, selectedEntrypoint, onSelectEntrypoint,
  onRunAttack, onResetGraph, isAttacting, isRemediated, totalNodes,
  availableIdentities, onOpenJudgeTour, onOpenMcpModal,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isMoreTabActive = MORE_TABS.some(t => t.id === activeTab);
  const activeMoreTab = MORE_TABS.find(t => t.id === activeTab);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 48,
        minHeight: 48,
        maxHeight: 48,
        padding: '0 12px',
        gap: 8,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'var(--bg-surface)',
        position: 'relative',
        zIndex: 100,
        flexShrink: 0,
        overflow: 'visible',
      }}
    >
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div
          style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'linear-gradient(135deg, #dc2626, #ea580c)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: 13, fontWeight: 700,
            boxShadow: '0 0 16px rgba(244,63,94,0.4)',
          }}
        >
          A
        </div>
        <div style={{ lineHeight: 1 }}>
          <div className="text-gradient-brand" style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' }}>ARGUS</div>
          <div style={{ fontSize: 9, color: '#475569', fontFamily: 'var(--font-mono)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>CloudMesh</div>
        </div>
      </div>

      <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />

      {/* Primary Tabs */}
      <nav style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        {PRIMARY_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => onChangeTab(t.id)}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: activeTab === t.id ? 600 : 400,
              cursor: 'pointer',
              color: activeTab === t.id ? '#f1f5f9' : '#64748b',
              background: activeTab === t.id ? 'rgba(255,255,255,0.08)' : 'transparent',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              whiteSpace: 'nowrap',
              transition: 'background 150ms, color 150ms',
            }}
          >
            <span style={{ opacity: 0.6 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}

        {/* More Tools Dropdown */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setDropdownOpen(prev => !prev)}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: isMoreTabActive ? 600 : 400,
              cursor: 'pointer',
              color: isMoreTabActive ? '#38bdf8' : '#64748b',
              background: isMoreTabActive ? 'rgba(56,189,248,0.1)' : dropdownOpen ? 'rgba(255,255,255,0.06)' : 'transparent',
              border: isMoreTabActive ? '1px solid rgba(56,189,248,0.3)' : '1px solid transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              whiteSpace: 'nowrap',
              transition: 'all 150ms',
            }}
          >
            <span>{isMoreTabActive ? activeMoreTab?.icon : '⚙️'}</span>
            <span>{isMoreTabActive ? activeMoreTab?.label : 'More Tools'}</span>
            <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
          </button>

          {dropdownOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                left: 0,
                width: 220,
                background: '#0d1117',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 10,
                boxShadow: '0 12px 30px rgba(0,0,0,0.8), 0 0 15px rgba(56,189,248,0.1)',
                padding: '6px',
                zIndex: 9999,
                animation: 'fade-up 150ms ease-out',
              }}
            >
              {MORE_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => {
                    onChangeTab(tab.id);
                    setDropdownOpen(false);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: activeTab === tab.id ? 'rgba(56,189,248,0.12)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    transition: 'background 120ms',
                  }}
                  onMouseEnter={e => {
                    if (activeTab !== tab.id) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                  }}
                  onMouseLeave={e => {
                    if (activeTab !== tab.id) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13 }}>{tab.icon}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                        color: activeTab === tab.id ? '#38bdf8' : '#f1f5f9',
                      }}
                    >
                      {tab.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 9.5, color: '#64748b', fontFamily: 'var(--font-mono)', paddingLeft: 19 }}>
                    {tab.desc}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>

      <div style={{ flex: 1 }} />

      {/* 🏆 Judge Demo Button */}
      {onOpenJudgeTour && (
        <button
          onClick={onOpenJudgeTour}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 10px',
            borderRadius: 8,
            background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.18), rgba(245, 158, 11, 0.28))',
            border: '1px solid rgba(234, 179, 8, 0.45)',
            color: '#fef08a',
            fontSize: 11,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
            flexShrink: 0,
            boxShadow: '0 0 12px rgba(234, 179, 8, 0.2)',
            transition: 'all 150ms',
          }}
        >
          <span>🏆</span>
          <span>Judge Tour</span>
        </button>
      )}

      {/* 🔌 MCP Button */}
      {onOpenMcpModal && (
        <button
          onClick={onOpenMcpModal}
          title="Connect Claude Desktop or Cursor via FastMCP"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 8px',
            borderRadius: 8,
            background: 'rgba(168, 85, 247, 0.12)',
            border: '1px solid rgba(168, 85, 247, 0.3)',
            color: '#d8b4fe',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'all 150ms',
          }}
        >
          <span>🔌</span>
          <span>MCP</span>
        </button>
      )}

      {/* Entrypoint picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ color: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }}>ENTRY →</span>
        <select
          value={selectedEntrypoint}
          onChange={e => onSelectEntrypoint(e.target.value)}
          style={{
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            padding: '4px 10px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: '#cbd5e1',
            cursor: 'pointer',
            height: 32,
            outline: 'none',
            maxWidth: 180,
          }}
        >
          {availableIdentities && availableIdentities.length > 0 ? (
            availableIdentities.map(u => (
              <option key={u.id} value={u.name}>
                {u.is_compromised ? '🚨 ' : '👤 '}
                {u.name} {u.department ? `(${u.department})` : ''}
              </option>
            ))
          ) : (
            ['DevIntern', 'Contractor', 'SupportUser', 'CloudAdmin', 'DataScientist'].map(ep => (
              <option key={ep} value={ep}>{ep}</option>
            ))
          )}
        </select>
      </div>

      {/* Run Attack */}
      <button
        onClick={onRunAttack}
        disabled={isAttacting}
        className="btn btn-attack"
        style={{ flexShrink: 0, minWidth: 125 }}
      >
        {isAttacting ? (
          <>
            <span style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
            Traversing…
          </>
        ) : (
          <>{isRemediated ? '⟳ Re-simulate' : '⚡ Launch Attack'}</>
        )}
      </button>

      <EngineBadge />

      {/* Reset */}
      <button onClick={onResetGraph} className="btn btn-ghost" style={{ flexShrink: 0 }}>
        ↺ Reset
      </button>
    </header>
  );
};
