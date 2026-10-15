import React, { useState, useEffect, useCallback } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { GraphCanvas } from './components/GraphCanvas';
import { AgentTerminal } from './components/AgentTerminal';
import { BenchmarkView } from './components/BenchmarkView';
import { RiskScorecardView } from './components/RiskScorecardView';
import { CypherPlaygroundView } from './components/CypherPlaygroundView';
import { GlobalAuditView } from './components/GlobalAuditView';
import { WhatIfSimulatorView } from './components/WhatIfSimulatorView';
import { DashboardView } from './components/DashboardView';
import { ThreatIntelFeed } from './components/ThreatIntelFeed';
import { CopilotView } from './components/CopilotView';
import { AgentSwarmView } from './components/AgentSwarmView';
import { AgentView } from './components/AgentView';
import { TriageView } from './components/TriageView';
import { JudgeTourModal } from './components/JudgeTourModal';
import { McpConfigModal } from './components/McpConfigModal';

import {
  fetchGraphTopology,
  runRedTeamAttack,
  runBlueTeamRemediation,
  applyRemediationPatch,
  reseedGraph,
  fetchBlastRadius,
  GraphTopology,
  GraphNode,
  RedTeamAttackResult,
  BlueTeamRemediationResult,
  BlastRadiusResult,
} from './services/api';

// ─── Node Inspector ────────────────────────────────────────────
const NODE_TYPE_COLOR: Record<string, string> = {
  User: '#38bdf8',
  Role: '#c084fc',
  Policy: '#fbbf24',
  Compute: '#34d399',
  Resource: '#2dd4bf',
};

interface NodeInspectorProps {
  node: GraphNode;
  onClose: () => void;
  onAttackFromNode: (name: string) => void;
  onIsolateBlastRadius: (nodeId: string) => void;
  isIsolated: boolean;
}

const NodeInspector: React.FC<NodeInspectorProps> = ({
  node,
  onClose,
  onAttackFromNode,
  onIsolateBlastRadius,
  isIsolated,
}) => {
  const [blast, setBlast] = useState<BlastRadiusResult | null>(null);
  const [loadingBlast, setLoadingBlast] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingBlast(true);
    fetchBlastRadius(node.id || node.name).then(res => {
      if (active) {
        setBlast(res);
        setLoadingBlast(false);
      }
    }).catch(() => {
      if (active) setLoadingBlast(false);
    });
    return () => { active = false; };
  }, [node]);

  const color = node.is_crown_jewel ? '#fbbf24' : (NODE_TYPE_COLOR[node.label] ?? '#64748b');
  const rows = [
    { label: 'Type', value: node.label },
    { label: 'Identifier', value: node.id },
    ...(node.sensitivity ? [{ label: 'Sensitivity', value: node.sensitivity }] : []),
    ...(node.department ? [{ label: 'Department', value: node.department }] : []),
    ...(node.is_crown_jewel ? [{ label: 'Crown Jewel', value: '✓ YES', highlight: true }] : []),
  ];

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 24,
        left: 24,
        zIndex: 20,
        width: 290,
        background: 'rgba(8, 14, 28, 0.94)',
        backdropFilter: 'blur(24px)',
        border: `1px solid ${color}40`,
        borderRadius: 16,
        padding: 16,
        boxShadow: `0 12px 36px rgba(0,0,0,0.6), 0 0 24px ${color}15`,
        animation: 'slide-in-right 300ms ease both',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: color, boxShadow: `0 0 10px ${color}`, flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: '#f1f5f9' }}>{node.name}</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, padding: 2 }}>✕</button>
      </div>

      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 4 }}>
          <span style={{ color: '#64748b' }}>{r.label}</span>
          <span style={{ color: (r as any).highlight ? '#fbbf24' : '#cbd5e1', fontWeight: (r as any).highlight ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{r.value}</span>
        </div>
      ))}

      {/* Dynamic Blast Radius Gauge */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#94a3b8', textTransform: 'uppercase' }}>Blast Radius:</span>
          {loadingBlast ? (
            <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'var(--font-mono)' }}>Calculating…</span>
          ) : blast ? (
            <span
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                color: blast.risk_level === 'CRITICAL' ? '#f87171' : blast.risk_level === 'HIGH' ? '#fbbf24' : '#34d399',
              }}
            >
              {blast.risk_level} ({blast.reachable_nodes_count} assets)
            </span>
          ) : null}
        </div>
        {blast && blast.crown_jewels_count > 0 && (
          <div style={{ fontSize: 10.5, color: '#f87171', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            🚨 Threat: Reaches {blast.crown_jewel_names.join(', ')}
          </div>
        )}
      </div>

      {/* Interactive Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <button
          onClick={() => onAttackFromNode(node.name)}
          style={{
            flex: 1, padding: '7px 8px', borderRadius: 8,
            background: 'rgba(244,63,94,0.18)', border: '1px solid rgba(244,63,94,0.35)',
            color: '#f87171', fontSize: 10.5, fontFamily: 'var(--font-mono)', cursor: 'pointer', fontWeight: 700,
          }}
        >
          ⚡ Attack from Here
        </button>
        <button
          onClick={() => onIsolateBlastRadius(node.id || node.name)}
          style={{
            padding: '7px 10px', borderRadius: 8,
            background: isIsolated ? 'rgba(56,189,248,0.25)' : 'rgba(255,255,255,0.05)',
            border: isIsolated ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
            color: isIsolated ? '#38bdf8' : '#cbd5e1', fontSize: 10.5,
            fontFamily: 'var(--font-mono)', cursor: 'pointer',
          }}
        >
          {isIsolated ? 'Reset Scope' : '🌐 Scope'}
        </button>
      </div>
    </div>
  );
};

// ─── Status Bar ────────────────────────────────────────────────
const StatusBar: React.FC<{
  topology: GraphTopology | null;
  attackResult: RedTeamAttackResult | null;
  isRemediated: boolean;
}> = ({ topology, attackResult, isRemediated }) => (
  <div
    style={{
      flexShrink: 0,
      height: 28,
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 20,
      borderTop: '1px solid rgba(255,255,255,0.04)',
      background: 'var(--bg-surface)',
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      color: '#475569',
    }}
  >
    <span><span style={{ color: '#10b981' }}>●</span> FalkorDB <span style={{ color: '#34d399' }}>LIVE</span></span>
    {topology && (
      <>
        <span>⬡ {topology.count_nodes} nodes</span>
        <span>⇌ {topology.count_links} edges</span>
      </>
    )}
    {attackResult && (
      <>
        <span style={{ color: '#f87171' }}>⚡ Attack: {attackResult.total_hops} hops</span>
        <span style={{ color: '#f87171' }}>{attackResult.execution_time_ms}ms</span>
      </>
    )}
    {isRemediated && (
      <span style={{ color: '#34d399' }}>⊘ Patch applied · Crown Jewels protected</span>
    )}
    <div style={{ flex: 1 }} />
    <span>FalkorDB Rule #3 — Graph &gt; Vector RAG for transitive IAM analysis</span>
  </div>
);

// ─── App ───────────────────────────────────────────────────────
export const App: React.FC = () => {
  // Active tab — adding 'home' as the new default
  const [activeTab, setActiveTab] = useState<ActiveTab>('home' as ActiveTab);
  const [topology, setTopology] = useState<GraphTopology | null>(null);
  const [selectedEntrypoint, setSelectedEntrypoint] = useState<string>('DevIntern');
  const [attackResult, setAttackResult] = useState<RedTeamAttackResult | null>(null);
  const [remediationResult, setRemediationResult] = useState<BlueTeamRemediationResult | null>(null);
  const [severedEdge, setSeveredEdge] = useState<{ src: string; dst: string } | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [isolatedNodeIds, setIsolatedNodeIds] = useState<Set<string> | null>(null);

  const [isAttacking, setIsAttacking] = useState(false);
  const [isRemediating, setIsRemediating] = useState(false);
  const [isApplyingPatch, setIsApplyingPatch] = useState(false);
  const [isRemediated, setIsRemediated] = useState(false);
  const [isFalkorDown, setIsFalkorDown] = useState(false);

  const [currentHopIndex, setCurrentHopIndex] = useState<number>(0);
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [isMcpOpen, setIsMcpOpen] = useState(false);

  const loadTopology = async () => {
    try {
      const data = await fetchGraphTopology();
      setTopology(data);
      setIsFalkorDown(false);
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 503 || String(err).includes('503')) {
        setIsFalkorDown(true);
      }
    }
  };

  useEffect(() => { loadTopology(); }, []);

  const handleRunAttackWith = useCallback(async (entrypoint: string) => {
    setActiveTab('graph' as ActiveTab);
    setIsAttacking(true);
    setSelectedEntrypoint(entrypoint);
    setAttackResult(null);
    setRemediationResult(null);
    setSeveredEdge(null);
    setIsRemediated(false);
    setSelectedNode(null);
    setCurrentHopIndex(0);
    try {
      const res = await runRedTeamAttack(entrypoint);
      setAttackResult(res);
      if (res.steps && res.steps.length > 0) {
        setCurrentHopIndex(res.steps.length - 1);
      }
    } finally {
      setIsAttacking(false);
    }
  }, []);

  const handleRunAttack = useCallback(async () => {
    await handleRunAttackWith(selectedEntrypoint);
  }, [selectedEntrypoint, handleRunAttackWith]);

  // "Run Full Demo" — navigate to graph tab and trigger attack
  const handleStartDemo = useCallback(async () => {
    setActiveTab('graph' as ActiveTab);
    await handleRunAttackWith(selectedEntrypoint);
  }, [selectedEntrypoint, handleRunAttackWith]);

  const handleRunRemediation = async () => {
    if (!attackResult) return;
    setIsRemediating(true);
    try {
      const res = await runBlueTeamRemediation(attackResult);
      setRemediationResult(res);
    } finally {
      setIsRemediating(false);
    }
  };

  const handleApplyPatch = async () => {
    if (!remediationResult || !remediationResult.choke_point) return;
    setIsApplyingPatch(true);
    const { source_name, target_name } = remediationResult.choke_point;
    try {
      await applyRemediationPatch(source_name, target_name);
      setSeveredEdge({ src: source_name, dst: target_name });
      setIsRemediated(true);
      await loadTopology();
    } finally {
      setIsApplyingPatch(false);
    }
  };

  const handleResetGraph = async () => {
    setAttackResult(null);
    setRemediationResult(null);
    setSeveredEdge(null);
    setIsRemediated(false);
    setSelectedNode(null);
    setIsolatedNodeIds(null);
    setCurrentHopIndex(0);
    await reseedGraph();
    await loadTopology();
  };

  const handleIsolateBlastRadius = async (nodeId: string) => {
    if (isolatedNodeIds) {
      setIsolatedNodeIds(null);
      return;
    }
    try {
      const res = await fetchBlastRadius(nodeId);
      if (res && res.reachable_node_ids) {
        setIsolatedNodeIds(new Set(res.reachable_node_ids));
      }
    } catch { /* silent */ }
  };

  const activePathNodeIds = attackResult
    ? attackResult.path_nodes.flatMap(n => [n.id, n.name])
    : [];

  // Extract all User nodes for Navbar entrypoint dropdown
  const availableIdentities = topology
    ? topology.nodes.filter(n => n.label === 'User')
    : [];

  const handleChangeTab = useCallback((tab: string) => {
    setActiveTab(tab as ActiveTab);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden', background: 'var(--bg-base)' }}>
      <Navbar
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        selectedEntrypoint={selectedEntrypoint}
        onSelectEntrypoint={setSelectedEntrypoint}
        onRunAttack={handleRunAttack}
        onResetGraph={handleResetGraph}
        isAttacting={isAttacking}
        isRemediated={isRemediated}
        totalNodes={topology?.count_nodes ?? 174}
        availableIdentities={availableIdentities}
        onOpenJudgeTour={() => setIsTourOpen(true)}
        onOpenMcpModal={() => setIsMcpOpen(true)}
      />

      {/* Live Threat Intel Ticker */}
      <ThreatIntelFeed />

      {/* FalkorDB-down banner */}
      {isFalkorDown && (
        <div style={{
          flexShrink: 0, zIndex: 50, padding: '7px 20px',
          background: 'rgba(248,113,113,0.15)', borderBottom: '1px solid rgba(248,113,113,0.4)',
          display: 'flex', alignItems: 'center', gap: 12,
          fontFamily: 'var(--font-mono)', fontSize: 11,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f87171', flexShrink: 0,
            boxShadow: '0 0 8px #f87171', animation: 'pulse 1.2s ease-in-out infinite' }} />
          <span style={{ color: '#fca5a5', fontWeight: 700 }}>FalkorDB OFFLINE</span>
          <span style={{ color: '#94a3b8' }}>Start Docker and run <code style={{ color: '#f1f5f9' }}>docker compose up -d</code> to restore graph connectivity.</span>
          <button
            onClick={loadTopology}
            style={{ marginLeft: 'auto', padding: '3px 12px', borderRadius: 6,
              background: 'rgba(248,113,113,0.2)', border: '1px solid rgba(248,113,113,0.4)',
              color: '#f87171', cursor: 'pointer', fontSize: 10, fontFamily: 'var(--font-mono)' }}
          >
            ↺ Retry
          </button>
        </div>
      )}

      {/* ── Main content area (push down 28px for ticker) ─────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, marginTop: 28 }}>

        {/* HOME / DASHBOARD */}
        {(activeTab as string) === 'home' && (
          <DashboardView
            onStartDemo={handleStartDemo}
            onChangeTab={handleChangeTab}
            isAttacking={isAttacking}
          />
        )}

        {activeTab === 'graph' && (
          <>
            {/* Graph Canvas — fills remaining space */}
            <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
              <GraphCanvas
                topology={topology}
                activePathNodeIds={activePathNodeIds}
                currentHopIndex={currentHopIndex}
                isolatedNodeIds={isolatedNodeIds}
                severedEdge={severedEdge}
                onSelectNode={setSelectedNode}
              />

              {/* Node inspector overlay */}
              {selectedNode && (
                <NodeInspector
                  node={selectedNode}
                  onClose={() => setSelectedNode(null)}
                  onAttackFromNode={handleRunAttackWith}
                  onIsolateBlastRadius={handleIsolateBlastRadius}
                  isIsolated={isolatedNodeIds !== null}
                />
              )}

              {/* Attack flash overlay */}
              {isAttacking && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30, pointerEvents: 'none' }}>
                  <div className="glass-attack" style={{ borderRadius: 16, padding: '24px 32px', textAlign: 'center', border: '1px solid rgba(244,63,94,0.3)', animation: 'fade-up 350ms ease both' }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>⚡</div>
                    <div style={{ color: '#f87171', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14 }}>Red Team Agent Running</div>
                    <div style={{ color: '#475569', fontFamily: 'var(--font-mono)', fontSize: 11, marginTop: 4 }}>
                      Executing shortestPath() from {selectedEntrypoint}…
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Agent Terminal — fixed width */}
            <div style={{ width: 420, flexShrink: 0, height: '100%', borderLeft: '1px solid rgba(255,255,255,0.05)' }}>
              <AgentTerminal
                attackResult={attackResult}
                remediationResult={remediationResult}
                currentHopIndex={currentHopIndex}
                onSelectHop={setCurrentHopIndex}
                onRunRemediation={handleRunRemediation}
                onApplyPatch={handleApplyPatch}
                isRemediating={isRemediating}
                isApplyingPatch={isApplyingPatch}
                isRemediated={isRemediated}
                entrypoint={selectedEntrypoint}
                onStreamingAttackComplete={(result) => {
                  setAttackResult(result);
                }}
                onStreamingRemediationComplete={(result) => {
                  setRemediationResult(result);
                }}
              />
            </div>
          </>
        )}

        {activeTab === 'triage' && <TriageView />}
        {activeTab === 'copilot' && <CopilotView />}
        {activeTab === 'swarm' && <AgentView selectedEntrypoint={selectedEntrypoint} />}

        {activeTab === 'audit' && (
          <GlobalAuditView
            onSelectUserToAttack={handleRunAttackWith}
            onSelectUserBlastRadius={(uName) => {
              handleIsolateBlastRadius(uName);
              setActiveTab('graph' as ActiveTab);
            }}
          />
        )}

        {activeTab === 'whatif' && <WhatIfSimulatorView />}
        {activeTab === 'benchmark' && <BenchmarkView entrypoint={selectedEntrypoint} />}
        {activeTab === 'scorecard' && <RiskScorecardView />}
        {activeTab === 'playground' && <CypherPlaygroundView />}
      </div>

      <StatusBar topology={topology} attackResult={attackResult} isRemediated={isRemediated} />

      <JudgeTourModal
        isOpen={isTourOpen}
        onClose={() => setIsTourOpen(false)}
        onChangeTab={setActiveTab}
      />

      <McpConfigModal
        isOpen={isMcpOpen}
        onClose={() => setIsMcpOpen(false)}
      />
    </div>
  );
};
