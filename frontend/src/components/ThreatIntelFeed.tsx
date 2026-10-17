/**
 * ThreatIntelFeed — A live, auto-scrolling ticker of synthetic threat events.
 * Simulates a real SOC (Security Operations Center) live feed.
 * Generates new events every few seconds to show the system is "alive".
 */
import React, { useState, useEffect, useRef } from 'react';

interface ThreatEvent {
  id: string;
  ts: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
  type: string;
  message: string;
  identity?: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#f43f5e',
  HIGH: '#fbbf24',
  MEDIUM: '#38bdf8',
  INFO: '#64748b',
};

const EVENT_TEMPLATES: Omit<ThreatEvent, 'id' | 'ts'>[] = [
  { severity: 'CRITICAL', type: 'PRIV_ESC',    message: 'Multi-hop escalation path detected: DevIntern → CIRunnerRole → ProdCustomerVault', identity: 'DevIntern' },
  { severity: 'HIGH',     type: 'BLAST_RADIUS', message: 'Contractor identity reaches 9 critical assets via assumed-role traversal', identity: 'Contractor' },
  { severity: 'HIGH',     type: 'CROWN_JEWEL',  message: 'SupportUser has 6-hop transitive access to CrownJewelDB via role chaining', identity: 'SupportUser' },
  { severity: 'MEDIUM',   type: 'ANOMALY',      message: 'Unusual cross-department permission: Analytics role can assume DevOps execution role', identity: 'DataScientist' },
  { severity: 'INFO',     type: 'GRAPH_SCAN',   message: 'FalkorDB graph traversal completed over the seeded IAM topology' },
  { severity: 'CRITICAL', type: 'PRIV_ESC',    message: 'Privilege escalation: Contractor → BuildEC2 → BackendAppRole → ProdKMSKey (4 hops)', identity: 'Contractor' },
  { severity: 'INFO',     type: 'REMEDIATION', message: 'Blue Team patch applied: ATTACHED_TO edge severed between CIRunnerRole and BuildEC2' },
  { severity: 'HIGH',     type: 'STALE_PERMS', message: 'Stale over-privileged attachment: DataPipelineRole retains admin-level S3 policy' },
  { severity: 'MEDIUM',   type: 'SHADOW_ADMIN', message: 'Shadow admin detected: SupportRole can assume EC2FullAccess via inherited policy chain' },
  { severity: 'INFO',     type: 'VERIFY',      message: 'Post-patch verification: Zero escalation paths remain from DevIntern to Crown Jewels' },
  { severity: 'HIGH',     type: 'WILDCARD',    message: 'Wildcard IAM action "*" attached to BackendAppRole — potential for lateral movement' },
  { severity: 'MEDIUM',   type: 'CROSS_DEPT',  message: 'Cross-department trust: Engineering role trusted by Finance compute instance' },
];

function randomEvent(): ThreatEvent {
  const template = EVENT_TEMPLATES[Math.floor(Math.random() * EVENT_TEMPLATES.length)];
  return {
    ...template,
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    ts: new Date().toLocaleTimeString('en-US', { hour12: false }),
  };
}

export const ThreatIntelFeed: React.FC = () => {
  const [events, setEvents] = useState<ThreatEvent[]>(() => [
    randomEvent(), randomEvent(), randomEvent(),
  ]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Generate a new event every 3.5–7 seconds
    const tick = () => {
      setEvents(prev => [randomEvent(), ...prev].slice(0, 30));
    };
    const interval = setInterval(tick, 3500 + Math.random() * 3500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="ticker"
      style={{
        position: 'relative', // in normal flow below the navbar, whatever height the navbar wraps to
        flexShrink: 0,
        height: 28,
        background: 'rgba(4, 7, 16, 0.96)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        overflow: 'hidden',
        zIndex: 40,
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {/* Sample-feed badge: events below are illustrative templates */}
      <div style={{
        flexShrink: 0,
        padding: '0 10px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        borderRight: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(244,63,94,0.08)',
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: '#f43f5e',
          boxShadow: '0 0 6px #f43f5e',
          animation: 'pulse-feed 1.2s ease-in-out infinite',
        }} />
        <span title="Illustrative sample events, not read from the graph" style={{ color: '#f87171', fontWeight: 700, letterSpacing: '0.1em' }}>SAMPLE FEED (SIMULATED)</span>
      </div>

      {/* Scrolling events */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          data-marquee
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            animation: 'ticker-scroll 60s linear infinite',
            whiteSpace: 'nowrap',
          }}
        >
          {[...events, ...events].map((evt, i) => (
            <div key={`${evt.id}_${i}`} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <span style={{
                padding: '0 10px',
                color: SEVERITY_COLORS[evt.severity],
                fontWeight: 700,
              }}>
                [{evt.severity}]
              </span>
              <span style={{ color: '#64748b', marginRight: 4 }}>{evt.ts}</span>
              <span style={{ color: '#94a3b8' }}>{evt.message}</span>
              <span style={{ color: '#1e293b', padding: '0 16px' }}>◆</span>
            </div>
          ))}
        </div>
      </div>

      {/* Event count */}
      <div style={{
        flexShrink: 0,
        padding: '0 10px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        borderLeft: '1px solid rgba(255,255,255,0.05)',
        color: '#334155',
      }}>
        {events.length} events
      </div>

    </div>
  );
};
