import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RedTeamAttackResult, BlueTeamRemediationResult } from '../services/api';

interface AgentTerminalProps {
  attackResult: RedTeamAttackResult | null;
  remediationResult: BlueTeamRemediationResult | null;
  currentHopIndex?: number;
  onSelectHop?: (index: number) => void;
  onRunRemediation: () => void;
  onApplyPatch: () => void;
  isRemediating: boolean;
  isApplyingPatch: boolean;
  isRemediated: boolean;
  entrypoint?: string;
  // New props for streaming mode
  onStreamingAttackComplete?: (result: RedTeamAttackResult) => void;
  onStreamingRemediationComplete?: (result: BlueTeamRemediationResult) => void;
  isStreamingMode?: boolean;
  /** Opens the Decision Trail view for a run (shown when the result carries a run_id). */
  onViewDecisionTrail?: (runId: string) => void;
}

type LogLine = {
  id: string;
  type: 'thinking' | 'step' | 'system' | 'success' | 'error' | 'separator';
  text: string;
  timestamp: string;
  stepData?: any;
};

type KillChainPhase = {
  id: string;
  name: string;
  mitre: string;
  icon: string;
  color: string;
  status: 'idle' | 'active' | 'done' | 'blocked';
};

const KILL_CHAIN: KillChainPhase[] = [
  { id: 'recon',     name: 'Reconnaissance',     mitre: 'TA0043', icon: '🔍', color: '#94a3b8', status: 'idle' },
  { id: 'initial',   name: 'Initial Access',      mitre: 'TA0001', icon: '🚪', color: '#38bdf8', status: 'idle' },
  { id: 'escalate',  name: 'Privilege Escalation',mitre: 'TA0004', icon: '⬆️', color: '#fbbf24', status: 'idle' },
  { id: 'lateral',   name: 'Lateral Movement',    mitre: 'TA0008', icon: '↔️', color: '#fb923c', status: 'idle' },
  { id: 'objective', name: 'Objective Reached',   mitre: 'TA0009', icon: '🎯', color: '#f43f5e', status: 'idle' },
];

const PHASE_TO_CHAIN: Record<string, string> = {
  'Initial Access': 'initial',
  'Privilege Escalation': 'escalate',
  'Lateral Movement': 'lateral',
  'Objective Reached': 'objective',
};

function nowHHMMSS() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

const AgentLog: React.FC<{ lines: LogLine[] }> = ({ lines }) => {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines.length]);

  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.6 }}>
      {lines.map(line => {
        if (line.type === 'separator') {
          return (
            <div key={line.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', margin: '8px 0' }} />
          );
        }
        const color =
          line.type === 'thinking' ? '#94a3b8' :
          line.type === 'step' ? '#fbbf24' :
          line.type === 'success' ? '#34d399' :
          line.type === 'error' ? '#f87171' :
          line.type === 'system' ? '#38bdf8' :
          '#e2e8f0';

        return (
          <div
            key={line.id}
            style={{
              display: 'flex',
              gap: 8,
              padding: '1px 0',
              color,
              animation: 'fade-up 200ms ease both',
            }}
          >
            <span style={{ color: '#334155', flexShrink: 0, fontSize: 10 }}>{line.timestamp}</span>
            <span style={{ flex: 1, wordBreak: 'break-word' }}>{line.text}</span>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
};

const KillChainBar: React.FC<{ phases: KillChainPhase[] }> = ({ phases }) => (
  <div style={{ display: 'flex', gap: 2, padding: '8px 0' }}>
    {phases.map((phase, i) => (
      <div key={phase.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center', position: 'relative' }}>
        <div
          style={{
            width: '100%',
            height: 3,
            borderRadius: 99,
            background:
              phase.status === 'done' ? phase.color :
              phase.status === 'active' ? `${phase.color}80` :
              phase.status === 'blocked' ? '#34d399' :
              'rgba(255,255,255,0.06)',
            transition: 'background 500ms ease',
            boxShadow: phase.status === 'active' ? `0 0 8px ${phase.color}` :
                       phase.status === 'done' ? `0 0 4px ${phase.color}60` : 'none',
          }}
        />
        <div
          style={{
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            color:
              phase.status === 'done' ? phase.color :
              phase.status === 'active' ? phase.color :
              phase.status === 'blocked' ? '#34d399' :
              '#334155',
            textAlign: 'center',
            transition: 'color 400ms',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          }}
        >
          {phase.status === 'blocked' ? '🛡️' : phase.icon} {phase.name.split(' ')[0]}
        </div>
      </div>
    ))}
  </div>
);

export const AgentTerminal: React.FC<AgentTerminalProps> = ({
  attackResult,
  remediationResult,
  currentHopIndex = 0,
  onSelectHop,
  onRunRemediation,
  onApplyPatch,
  isRemediating,
  isApplyingPatch,
  isRemediated,
  entrypoint = 'DevIntern',
  onStreamingAttackComplete,
  onStreamingRemediationComplete,
  isStreamingMode = false,
  onViewDecisionTrail,
}) => {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [killChain, setKillChain] = useState<KillChainPhase[]>(KILL_CHAIN);
  const [isStreamingAttack, setIsStreamingAttack] = useState(false);
  const [isStreamingBlue, setIsStreamingBlue] = useState(false);
  const [streamAttackResult, setStreamAttackResult] = useState<RedTeamAttackResult | null>(null);
  const [streamBlueResult, setStreamBlueResult] = useState<BlueTeamRemediationResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [tab, setTab] = useState<'stream' | 'hops' | 'patch'>('stream');
  const esRef = useRef<EventSource | null>(null);
  const logIdRef = useRef(0);

  const addLog = useCallback((type: LogLine['type'], text: string, stepData?: any) => {
    const id = `log_${logIdRef.current++}`;
    setLogs(prev => [...prev.slice(-200), { id, type, text, timestamp: nowHHMMSS(), stepData }]);
  }, []);

  // Reset on new external attackResult
  useEffect(() => {
    if (attackResult && !isStreamingAttack) {
      setLogs([]);
      setKillChain(KILL_CHAIN.map(p => ({ ...p, status: 'idle' })));
      setStreamAttackResult(attackResult);
      setStreamBlueResult(null);
      setVerifyResult(null);
      setTab('stream');

      // Populate logs from existing result (non-streaming path)
      addLog('system', `[ARGUS] Loaded attack result for entrypoint '${attackResult.entrypoint}'`);
      addLog('system', `Cypher shortestPath executed in ${attackResult.execution_time_ms}ms`);
      if (attackResult.status === 'failed') {
        addLog('success', `✔ No escalation path found — Identity is LEAST-PRIVILEGE COMPLIANT`);
      } else {
        attackResult.steps?.forEach((step, i) => {
          const phaseId = step.crown_jewel_reached ? 'objective' : (PHASE_TO_CHAIN[step.phase] || 'escalate');
          addLog('step', `[${step.phase}] ${step.action}`);
          setKillChain(prev => prev.map(p =>
            p.id === phaseId ? { ...p, status: 'done' } :
            (p.id === 'recon' ? { ...p, status: 'done' } : p)
          ));
        });
        addLog('thinking', `⚡ Crown Jewel '${attackResult.target_compromised}' compromised in ${attackResult.total_hops} hops`);
      }
    }
  }, [attackResult]);

  useEffect(() => {
    if (remediationResult && !isStreamingBlue) {
      setStreamBlueResult(remediationResult);
      if (remediationResult.choke_point) {
        addLog('separator', '');
        addLog('system', `[BLUE TEAM] Choke point identified: ${remediationResult.choke_point.source_name} → ${remediationResult.choke_point.target_name}`);
        addLog('success', '✔ Terraform remediation patch synthesized');
        setTab('patch');
      }
    }
  }, [remediationResult]);

  // Streaming Red Team attack
  const runStreamingAttack = useCallback(() => {
    if (esRef.current) { esRef.current.close(); }
    setIsStreamingAttack(true);
    setStreamAttackResult(null);
    setStreamBlueResult(null);
    setVerifyResult(null);
    setLogs([]);
    setKillChain(KILL_CHAIN.map(p => ({ ...p, status: 'idle' })));
    setTab('stream');

    // Mark recon as active immediately
    setKillChain(prev => prev.map(p => p.id === 'recon' ? { ...p, status: 'active' } : p));

    const es = new EventSource(`/api/stream/red-team?entrypoint=${encodeURIComponent(entrypoint)}`);
    esRef.current = es;

    es.addEventListener('thinking', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      addLog('thinking', data.text);
    });

    es.addEventListener('step', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      const step = data.step;
      const phaseId = step.crown_jewel_reached ? 'objective' : (PHASE_TO_CHAIN[step.phase] || 'escalate');
      addLog('step', `[${step.phase}] ${step.action}`);
      setKillChain(prev => prev.map(p => {
        if (p.id === 'recon') return { ...p, status: 'done' };
        if (p.id === phaseId) return { ...p, status: 'active' };
        return p;
      }));
    });

    es.addEventListener('complete', (e: MessageEvent) => {
      const result: RedTeamAttackResult = JSON.parse(e.data);
      setStreamAttackResult(result);
      setIsStreamingAttack(false);
      es.close();
      esRef.current = null;

      if (result.status === 'success') {
        setKillChain(prev => prev.map(p => ({ ...p, status: 'done' })));
        addLog('thinking', `⚡ Attack complete — ${result.target_compromised} compromised in ${result.total_hops} hops`);
      } else {
        addLog('success', `✔ Identity is LEAST-PRIVILEGE COMPLIANT — no escalation path exists`);
        setKillChain(prev => prev.map(p => p.id === 'recon' ? { ...p, status: 'done' } : p));
      }

      onStreamingAttackComplete?.(result);
    });

    es.onerror = () => {
      setIsStreamingAttack(false);
      addLog('error', 'Stream connection error. Falling back to standard mode.');
      es.close();
    };
  }, [entrypoint, addLog, onStreamingAttackComplete]);

  // Streaming Blue Team
  const runStreamingBlue = useCallback(async () => {
    const attackData = streamAttackResult || attackResult;
    if (!attackData) return;
    setIsStreamingBlue(true);
    addLog('separator', '');
    addLog('system', '[BLUE TEAM AGENT] Deploying autonomous remediator...');

    const response = await fetch('/api/stream/blue-team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attack_result: attackData }),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let blueResult: BlueTeamRemediationResult | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const lines = part.split('\n');
        let eventName = '';
        let dataStr = '';
        for (const l of lines) {
          if (l.startsWith('event: ')) eventName = l.slice(7);
          if (l.startsWith('data: ')) dataStr = l.slice(6);
        }
        if (!dataStr) continue;
        try {
          const data = JSON.parse(dataStr);
          if (eventName === 'thinking') {
            addLog('thinking', data.text);
          } else if (eventName === 'complete') {
            blueResult = data;
            setStreamBlueResult(data);
            onStreamingRemediationComplete?.(data);
            if (data.choke_point) {
              addLog('success', `✔ CHOKE POINT: ${data.choke_point.source_name} → ${data.choke_point.target_name}`);
              setKillChain(prev => prev.map(p =>
                p.id === 'objective' ? { ...p, status: 'blocked', color: '#34d399' } : p
              ));
              setTab('patch');
            }
          }
        } catch { /* ignore parse errors */ }
      }
    }
    setIsStreamingBlue(false);
  }, [streamAttackResult, attackResult, addLog, onStreamingRemediationComplete]);

  const handleVerifyBlocked = async () => {
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch(`/api/simulate/attack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entrypoint }),
      });
      const data = await res.json();
      if (data.status === 'failed') {
        setVerifyResult('✔ BLOCKED: No escalation path exists. Crown Jewels fully protected.');
        addLog('success', '🛡️ POST-PATCH VERIFICATION: Attack vector ELIMINATED from FalkorDB graph.');
        setKillChain(prev => prev.map(p => ({ ...p, status: 'blocked' })));
      } else {
        setVerifyResult('⚠ Alternative path found via: ' + data.path_nodes?.map((n: any) => n.name).join(' → '));
        addLog('error', '⚠ Alternative path still reachable — additional remediation may be needed.');
      }
    } catch {
      setVerifyResult('⚠ Verification request failed — could not confirm whether the path is blocked.');
      addLog('error', '⚠ Post-patch verification request failed.');
    } finally {
      setIsVerifying(false);
    }
  };

  const activeResult = streamAttackResult || attackResult;
  const activeBlue = streamBlueResult || remediationResult;
  const isAttacking = isStreamingAttack;
  const canDeployBlue = !!activeResult && activeResult.status === 'success' && !activeBlue && !isStreamingBlue;
  const isActuallyRemediated = isRemediated || (activeBlue?.status === 'success' && isRemediated);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'rgba(4, 7, 16, 0.98)',
        color: '#e2e8f0',
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 14px 8px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(8, 14, 28, 0.95)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span
              style={{
                width: 7, height: 7, borderRadius: '50%',
                background: isAttacking || isStreamingBlue ? '#fbbf24' : '#10b981',
                boxShadow: `0 0 8px ${isAttacking || isStreamingBlue ? '#fbbf24' : '#10b981'}`,
                animation: isAttacking || isStreamingBlue ? 'pulse 1s ease-in-out infinite' : 'none',
              }}
            />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: '#f1f5f9', letterSpacing: '0.07em' }}>
              ARGUS AGENT SWARM
            </span>
            {(isAttacking || isStreamingBlue) && (
              <span style={{
                padding: '2px 6px', borderRadius: 4,
                background: 'rgba(251,191,36,0.15)',
                border: '1px solid rgba(251,191,36,0.3)',
                color: '#fbbf24', fontSize: 9,
                fontFamily: 'var(--font-mono)', fontWeight: 700,
                animation: 'pulse-opacity 1s ease-in-out infinite',
              }}>
                ● LIVE
              </span>
            )}
          </div>
          {activeResult && (
            <span style={{
              padding: '2px 7px', borderRadius: 5,
              background: 'rgba(244,63,94,0.12)',
              border: '1px solid rgba(244,63,94,0.25)',
              color: '#f87171', fontSize: 9,
              fontFamily: 'var(--font-mono)', fontWeight: 600,
            }}>
              ⚡ {activeResult.execution_time_ms}ms
            </span>
          )}
        </div>

        {/* MITRE Kill Chain */}
        <KillChainBar phases={killChain} />

        {/* Tab strip */}
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          {(['stream', 'hops', 'patch'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '3px 10px', borderRadius: 5, border: 'none',
                background: tab === t ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: tab === t ? '#f1f5f9' : '#475569',
                fontFamily: 'var(--font-mono)', fontSize: 10, cursor: 'pointer',
                fontWeight: tab === t ? 700 : 400,
                transition: 'all 150ms',
              }}
            >
              {t === 'stream' ? '▶ Live Feed' : t === 'hops' ? '⬡ Hop Chain' : '🔧 Patch'}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* STREAM TAB */}
        {tab === 'stream' && (
          <>
            {/* Empty state */}
            {logs.length === 0 && !isAttacking && (
              <div style={{ margin: 'auto', textAlign: 'center', color: '#334155', padding: 24 }}>
                <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.3 }}>⬡</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#475569', marginBottom: 6 }}>Agent Swarm Idle</div>
                <div style={{ fontSize: 11, color: '#334155', lineHeight: 1.6 }}>
                  Click <span style={{ color: '#f87171', fontWeight: 700 }}>"⚡ Launch Attack"</span> in the navbar<br />
                  or press the button below to stream live AI reasoning.
                </div>
              </div>
            )}

            {/* Log output */}
            {logs.length > 0 && (
              <div
                style={{
                  background: 'rgba(0,0,0,0.5)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  minHeight: 80,
                }}
              >
                <AgentLog lines={logs} />
                {(isAttacking || isStreamingBlue) && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#fbbf24' }} className="cursor-blink" />
                )}
              </div>
            )}

            {/* Link to the recorded decision trail for this run */}
            {activeResult?.run_id && onViewDecisionTrail && !isAttacking && (
              <button
                onClick={() => onViewDecisionTrail(activeResult.run_id as string)}
                title={`run_id ${activeResult.run_id}`}
                style={{
                  alignSelf: 'flex-start', padding: '5px 10px', borderRadius: 7,
                  background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)',
                  color: '#fbbf24', fontSize: 10.5, fontFamily: 'var(--font-mono)', cursor: 'pointer',
                }}
              >
                ⇣ View decision trail
              </button>
            )}

            {/* Blue Team Deploy button */}
            {canDeployBlue && (
              <button
                onClick={runStreamingBlue}
                style={{
                  padding: '11px 14px', borderRadius: 10,
                  border: '1px solid rgba(16,185,129,0.3)',
                  background: 'linear-gradient(135deg, rgba(16,185,129,0.18), rgba(6,182,212,0.18))',
                  color: '#34d399', fontWeight: 700, fontSize: 12,
                  fontFamily: 'var(--font-mono)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: '0 4px 16px rgba(16,185,129,0.12)',
                  transition: 'all 200ms',
                }}
              >
                ⊕ Deploy Blue Team Remediator ▶
              </button>
            )}

            {/* Fallback — non-streaming deploy button */}
            {!canDeployBlue && activeResult?.status === 'success' && !activeBlue && !isStreamingBlue && (
              <button
                onClick={onRunRemediation}
                disabled={isRemediating}
                style={{
                  padding: '11px 14px', borderRadius: 10,
                  border: '1px solid rgba(16,185,129,0.3)',
                  background: 'linear-gradient(135deg, rgba(16,185,129,0.18), rgba(6,182,212,0.18))',
                  color: '#34d399', fontWeight: 700, fontSize: 12,
                  fontFamily: 'var(--font-mono)', cursor: isRemediating ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {isRemediating ? 'Analyzing…' : '⊕ Deploy Blue Team Remediator ▶'}
              </button>
            )}

            {/* No choke point notice */}
            {activeBlue && !activeBlue.choke_point && (
              <div style={{
                padding: 10, borderRadius: 8,
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                color: '#fca5a5', fontSize: 11,
                fontFamily: 'var(--font-mono)', lineHeight: 1.5,
              }}>
                ⚠️ {activeBlue.message || 'No choke point — graph may already be remediated.'}
              </div>
            )}
          </>
        )}

        {/* HOPS TAB */}
        {tab === 'hops' && (
          <>
            {!activeResult ? (
              <div style={{ margin: 'auto', color: '#334155', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                No attack data yet. Run an attack first.
              </div>
            ) : activeResult.status === 'failed' ? (
              <div style={{
                padding: 14, borderRadius: 10,
                background: 'rgba(16,185,129,0.07)',
                border: '1px solid rgba(16,185,129,0.2)',
                color: '#34d399', fontFamily: 'var(--font-mono)', fontSize: 12,
              }}>
                ✔ Least-Privilege Compliant: {activeResult.message || 'No escalation paths detected.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#475569', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Attack Path — {activeResult.total_hops} hops to Crown Jewel
                </div>

                {/* Cypher */}
                <div style={{
                  background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: 8, padding: '8px 10px', marginBottom: 6,
                }}>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>FalkorDB Cypher Executed:</div>
                  <pre style={{ margin: 0, fontSize: 9.5, color: '#38bdf8', fontFamily: 'var(--font-mono)', overflowX: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {activeResult.cypher_executed}
                  </pre>
                </div>

                {/* Hop nodes */}
                {activeResult.path_nodes?.map((node, i) => {
                  const step = activeResult.steps?.[i];
                  const isLast = i === activeResult.path_nodes.length - 1;
                  const nodeColor = isLast ? '#f43f5e' : i === 0 ? '#38bdf8' : '#fbbf24';
                  return (
                    <div key={i}>
                      <div
                        onClick={() => { onSelectHop?.(i); setTab('stream'); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                          background: currentHopIndex === i ? `${nodeColor}10` : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${currentHopIndex === i ? `${nodeColor}30` : 'rgba(255,255,255,0.04)'}`,
                          transition: 'all 150ms',
                        }}
                      >
                        <div style={{
                          width: 26, height: 26, borderRadius: '50%',
                          background: `${nodeColor}20`, border: `1px solid ${nodeColor}50`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontFamily: 'var(--font-mono)', color: nodeColor, fontWeight: 700, flexShrink: 0,
                        }}>
                          {i + 1}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 600, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {node.name}
                          </div>
                          <div style={{ fontSize: 9.5, color: '#475569', fontFamily: 'var(--font-mono)' }}>
                            {node.label} · {step?.phase}
                          </div>
                        </div>
                        {isLast && (
                          <span style={{ fontSize: 12 }}>💎</span>
                        )}
                      </div>
                      {i < activeResult.path_nodes.length - 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}>
                          <div style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.08)' }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* PATCH TAB */}
        {tab === 'patch' && (
          <>
            {!activeBlue ? (
              <div style={{ margin: 'auto', color: '#334155', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                No remediation data yet. Deploy the Blue Team first.
              </div>
            ) : !activeBlue.choke_point ? (
              <div style={{
                padding: 12, borderRadius: 8,
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                color: '#fca5a5', fontSize: 11, fontFamily: 'var(--font-mono)',
              }}>
                ⚠️ {activeBlue.message || 'No choke point available.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Choke point */}
                <div style={{
                  background: 'rgba(16,185,129,0.04)',
                  border: '1px solid rgba(16,185,129,0.18)',
                  borderRadius: 10, padding: 12,
                }}>
                  <div style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', color: '#34d399', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                    ⊛ Minimal-Cut Choke Point
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
                    <span style={{ padding: '4px 8px', borderRadius: 6, background: 'rgba(56,189,248,0.15)', color: '#38bdf8', fontWeight: 700 }}>
                      {activeBlue.choke_point.source_name}
                    </span>
                    <span style={{ color: '#ef4444', fontWeight: 700 }}>—✕—</span>
                    <span style={{ padding: '4px 8px', borderRadius: 6, background: 'rgba(244,63,94,0.15)', color: '#f87171', fontWeight: 700 }}>
                      {activeBlue.choke_point.target_name}
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, color: '#94a3b8', lineHeight: 1.5 }}>
                    Severing this edge breaks the discovered Crown Jewel path. Use "Verify" after applying the patch to check whether an alternative path remains.
                  </div>
                </div>

                {/* Terraform patch */}
                <div>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>
                    Generated Terraform HCL Patch:
                  </div>
                  <pre style={{
                    margin: 0, padding: 10, borderRadius: 8,
                    background: 'rgba(0,0,0,0.6)',
                    color: '#6ee7b7', fontSize: 9.5,
                    fontFamily: 'var(--font-mono)',
                    overflowX: 'auto', maxHeight: 160,
                    lineHeight: 1.5, whiteSpace: 'pre-wrap',
                    border: '1px solid rgba(255,255,255,0.05)',
                  }}>
                    {activeBlue.terraform_patch || ''}
                  </pre>
                </div>

                {/* Apply / Verify buttons */}
                {!isRemediated ? (
                  <button
                    onClick={onApplyPatch}
                    disabled={isApplyingPatch}
                    style={{
                      padding: '11px 14px', borderRadius: 10,
                      border: '1px solid rgba(239,68,68,0.4)',
                      background: 'linear-gradient(135deg, rgba(239,68,68,0.22), rgba(244,63,94,0.22))',
                      color: '#fca5a5', fontWeight: 700, fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                      cursor: isApplyingPatch ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                  >
                    {isApplyingPatch ? '⌛ Severing Edge in FalkorDB…' : '⊘ Apply Patch & Sever Edge in FalkorDB ▶'}
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{
                      padding: '10px 14px', borderRadius: 8,
                      background: 'rgba(16,185,129,0.1)',
                      border: '1px solid rgba(16,185,129,0.3)',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <span style={{ fontSize: 18, color: '#34d399' }}>✔</span>
                      <div>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: '#34d399' }}>Edge Severed in FalkorDB</div>
                        <div style={{ fontSize: 10, color: '#6ee7b7' }}>Choke point deleted. Transitive path broken.</div>
                      </div>
                    </div>

                    <button
                      onClick={handleVerifyBlocked}
                      disabled={isVerifying}
                      style={{
                        padding: '10px 14px', borderRadius: 8,
                        border: '1px solid rgba(56,189,248,0.3)',
                        background: 'rgba(56,189,248,0.08)',
                        color: '#38bdf8', fontWeight: 600, fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        cursor: isVerifying ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      }}
                    >
                      {isVerifying ? '🔄 Verifying…' : '🛡️ Verify Attack is Blocked (Re-run Exploit)'}
                    </button>

                    {verifyResult && (
                      <div style={{
                        padding: 10, borderRadius: 8,
                        background: verifyResult.startsWith('✔') ? 'rgba(16,185,129,0.08)' : 'rgba(251,191,36,0.08)',
                        border: `1px solid ${verifyResult.startsWith('✔') ? 'rgba(16,185,129,0.25)' : 'rgba(251,191,36,0.25)'}`,
                        fontSize: 10.5, fontFamily: 'var(--font-mono)',
                        color: verifyResult.startsWith('✔') ? '#6ee7b7' : '#fde68a',
                        lineHeight: 1.5,
                      }}>
                        {verifyResult}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer — Action Buttons */}
      <div style={{
        flexShrink: 0, padding: '8px 12px',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(8,14,28,0.9)',
      }}>
        <button
          onClick={runStreamingAttack}
          disabled={isAttacking || isStreamingBlue}
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 10,
            border: '1px solid rgba(244,63,94,0.35)',
            background: isAttacking
              ? 'rgba(244,63,94,0.1)'
              : 'linear-gradient(135deg, rgba(190,18,60,0.9), rgba(225,29,72,0.9))',
            color: isAttacking ? '#f87171' : 'white',
            fontWeight: 700, fontSize: 12,
            fontFamily: 'var(--font-mono)', cursor: isAttacking ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: isAttacking ? 'none' : '0 4px 16px rgba(244,63,94,0.3)',
            transition: 'all 200ms',
          }}
        >
          {isAttacking ? (
            <>
              <span style={{ width: 10, height: 10, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#f87171', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
              Red Team Agent Running…
            </>
          ) : (
            <>⚡ Stream Live Attack</>
          )}
        </button>
      </div>

      <style>{`
        @keyframes pulse-opacity { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes pulse { 0%,100% { box-shadow: 0 0 8px #fbbf24; } 50% { box-shadow: 0 0 18px #fbbf24; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};
