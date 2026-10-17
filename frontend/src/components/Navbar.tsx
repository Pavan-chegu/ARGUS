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
  const detail = live ? ` FalkorDB · ${h.nodes ?? '?'} nodes · ${h.memory?.Incident ?? 0} incidents` : '';
  const full = live ? `● LIVE${detail}` : h.mode === 'down' ? '● Backend offline' : '● FALLBACK (not FalkorDB)';
  return (
    // Collapses to "● LIVE" on narrower screens; the full text stays available as a tooltip.
    <span className="nav-badge" title={`${full}${h.engine ? ` (${h.engine})` : ''}`} style={{ color }}>
      {live ? <>● LIVE<span className="nav-badge-detail">{detail}</span></> : full}
    </span>
  );
};

export type ActiveTab = 'home' | 'triage' | 'graph' | 'swarm' | 'trail' | 'copilot' | 'audit' | 'whatif' | 'benchmark' | 'scorecard' | 'playground';

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

// Primary tabs follow the main demo story: overview → attack → agent → why → findings → raw query.
const PRIMARY_TABS: { id: ActiveTab; icon: string; label: string }[] = [
  { id: 'home',       icon: '◈', label: 'Dashboard'      },
  { id: 'graph',      icon: '⬡', label: 'Investigate'    },
  { id: 'swarm',      icon: '🤖', label: 'Agent'          },
  { id: 'trail',      icon: '⇣', label: 'Decision Trail' },
  { id: 'triage',     icon: '⚠', label: 'Triage'         },
  { id: 'playground', icon: '💻', label: 'Cypher'         },
];

// Secondary tools live in the "More" dropdown.
const MORE_TABS: { id: ActiveTab; icon: string; label: string; desc: string }[] = [
  { id: 'copilot',    icon: '🧠', label: 'Ask Copilot',  desc: 'Natural-language questions over the graph' },
  { id: 'benchmark',  icon: '⚡', label: 'Benchmark',    desc: 'Graph traversal vs simulated vector RAG' },
  { id: 'audit',      icon: '🛰️', label: 'Global Audit', desc: 'Org-wide IAM blast radii'      },
  { id: 'whatif',     icon: '🔮', label: 'What-If Sim',  desc: 'Simulate policy modifications' },
  { id: 'scorecard',  icon: '📊', label: 'Scorecard',    desc: 'Executive compliance scorecard'},
];

export const Navbar: React.FC<NavbarProps> = ({
  activeTab, onChangeTab, selectedEntrypoint, onSelectEntrypoint,
  onRunAttack, onResetGraph, isAttacting, isRemediated, totalNodes,
  availableIdentities, onOpenJudgeTour, onOpenMcpModal,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDropdownOpen(false); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  // Keep the active tab visible when the strip is scrollable. Only the strip scrolls
  // (scrollIntoView would also try to scroll the page shell).
  useEffect(() => {
    const strip = tabsRef.current;
    const tab = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !tab) return;
    const left = tab.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft) strip.scrollLeft = left - 8;
    else if (left + tab.offsetWidth > strip.scrollLeft + strip.clientWidth)
      strip.scrollLeft = left + tab.offsetWidth - strip.clientWidth + 8;
  }, [activeTab]);

  // Fade the strip's edges only while it actually overflows, as a "more tabs this way" cue.
  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setTabsOverflow(strip.scrollWidth > strip.clientWidth + 1));
    ro.observe(strip);
    return () => ro.disconnect();
  }, []);

  // A vertical mouse wheel scrolls the tab strip sideways when it overflows.
  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const onWheel = (e: WheelEvent) => {
      if (strip.scrollWidth <= strip.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      strip.scrollLeft += e.deltaY;
    };
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);

  const isMoreTabActive = MORE_TABS.some(t => t.id === activeTab);
  const activeMoreTab = MORE_TABS.find(t => t.id === activeTab);

  return (
    <header className="nav">
      {/* Logo */}
      <div className="nav-brand">
        <div
          aria-hidden="true"
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
        <div className="nav-brand-text" style={{ lineHeight: 1 }}>
          <div className="text-gradient-brand" style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' }}>ARGUS</div>
          <div style={{ fontSize: 9, color: '#64748b', fontFamily: 'var(--font-mono)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>CloudMesh</div>
        </div>
      </div>

      <div className="nav-divider" />

      {/* Primary Tabs (scrollable) + More dropdown (outside the scroller so the menu isn't clipped) */}
      <div className="nav-primary">
        <nav ref={tabsRef} className="nav-tabs" aria-label="Main" data-overflow={tabsOverflow || undefined}>
          {PRIMARY_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => onChangeTab(t.id)}
              className="nav-tab"
              aria-current={activeTab === t.id ? 'page' : undefined}
            >
              <span className="nav-tab-icon" aria-hidden="true">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        <div ref={dropdownRef} className="nav-more">
          <button
            onClick={() => setDropdownOpen(prev => !prev)}
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
            className="nav-tab"
            style={{
              fontWeight: isMoreTabActive ? 600 : 400,
              color: isMoreTabActive ? '#38bdf8' : undefined,
              background: isMoreTabActive ? 'rgba(56,189,248,0.1)' : dropdownOpen ? 'rgba(255,255,255,0.06)' : undefined,
              borderColor: isMoreTabActive ? 'rgba(56,189,248,0.3)' : undefined,
            }}
          >
            <span aria-hidden="true">{isMoreTabActive ? activeMoreTab?.icon : '⚙️'}</span>
            <span>{isMoreTabActive ? activeMoreTab?.label : 'More'}</span>
            <span aria-hidden="true" style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
          </button>

          {dropdownOpen && (
            <div className="nav-menu" role="menu">
              {MORE_TABS.map(tab => (
                <button
                  key={tab.id}
                  role="menuitem"
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
                    <span aria-hidden="true" style={{ fontSize: 13 }}>{tab.icon}</span>
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
                  <div style={{ fontSize: 9.5, color: '#94a3b8', fontFamily: 'var(--font-mono)', paddingLeft: 19 }}>
                    {tab.desc}
                  </div>
                </button>
              ))}
              {/* On small phones the Judge Tour / MCP chips are hidden; they live here instead. */}
              {[
                onOpenJudgeTour && { key: 'tour', icon: '🏆', label: 'Judge Tour', desc: 'Guided walkthrough of the demo', run: onOpenJudgeTour },
                onOpenMcpModal && { key: 'mcp', icon: '🔌', label: 'MCP', desc: 'Connect Claude Desktop or Cursor', run: onOpenMcpModal },
              ].filter(Boolean).map((x: any) => (
                <button
                  key={x.key}
                  role="menuitem"
                  className="nav-menu-compact"
                  onClick={() => { x.run(); setDropdownOpen(false); }}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6, background: 'transparent',
                    border: 'none', cursor: 'pointer', flexDirection: 'column', gap: 2 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span aria-hidden="true" style={{ fontSize: 13 }}>{x.icon}</span>
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#f1f5f9' }}>{x.label}</span>
                  </div>
                  <div style={{ fontSize: 9.5, color: '#94a3b8', fontFamily: 'var(--font-mono)', paddingLeft: 19 }}>{x.desc}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="nav-spacer" />

      <div className="nav-actions">
        {/* 🏆 Judge Demo Button */}
        {onOpenJudgeTour && (
          <button
            onClick={onOpenJudgeTour}
            className="nav-chip nav-chip-tour"
            aria-label="Judge Tour"
            title="Judge Tour"
            style={{
              background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.18), rgba(245, 158, 11, 0.28))',
              border: '1px solid rgba(234, 179, 8, 0.45)',
              color: '#fef08a',
              fontWeight: 700,
              boxShadow: '0 0 12px rgba(234, 179, 8, 0.2)',
            }}
          >
            <span aria-hidden="true">🏆</span>
            <span className="nav-label">Judge Tour</span>
          </button>
        )}

        {/* 🔌 MCP Button */}
        {onOpenMcpModal && (
          <button
            onClick={onOpenMcpModal}
            className="nav-chip nav-chip-mcp"
            aria-label="MCP: connect Claude Desktop or Cursor"
            title="Connect Claude Desktop or Cursor via FastMCP"
            style={{
              background: 'rgba(168, 85, 247, 0.12)',
              border: '1px solid rgba(168, 85, 247, 0.3)',
              color: '#d8b4fe',
            }}
          >
            <span aria-hidden="true">🔌</span>
            <span className="nav-label">MCP</span>
          </button>
        )}

        {/* Entrypoint picker */}
        <div className="nav-entry">
          <span className="nav-entry-caption" aria-hidden="true">ENTRY →</span>
          <select
            value={selectedEntrypoint}
            onChange={e => onSelectEntrypoint(e.target.value)}
            aria-label="Entry identity"
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
          className="btn btn-attack nav-attack"
          aria-label={isAttacting ? 'Traversing' : isRemediated ? 'Re-simulate attack' : 'Launch attack'}
        >
          {isAttacting ? (
            <>
              <span style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
              Traversing…
            </>
          ) : (
            <>
              <span aria-hidden="true">{isRemediated ? '⟳' : '⚡'}</span>
              <span className="nav-long">{isRemediated ? 'Re-simulate' : 'Launch Attack'}</span>
              <span className="nav-short">{isRemediated ? 'Re-run' : 'Attack'}</span>
            </>
          )}
        </button>

        <EngineBadge />

        {/* Reset */}
        <button onClick={onResetGraph} className="btn btn-ghost nav-reset" aria-label="Reset graph" title="Reset graph" style={{ flexShrink: 0 }}>
          <span aria-hidden="true">↺</span>
          <span className="nav-label">Reset</span>
        </button>
      </div>
    </header>
  );
};
