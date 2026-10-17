import React, { useState } from 'react';
import { runWhatIfSimulation, WhatIfResult } from '../services/api';

const SOURCES = [
  'umar.garcia',
  'alice.silva',
  'hana.rossi',
  'DataScientist',
  'QAEngineer',
  'payments-worker-lambda',
  'SupportUser',
  'CloudAdmin',
];

// CAN_ASSUME may only point into a Role, so targets are Role nodes only.
const TARGETS = [
  'CIRunnerRole',
  'BackendAppRole',
  'AdminRole',
  'DynamoDBReaderRole',
  'ReadOnlyRole',
  'SupportOpsRole',
];

export const WhatIfSimulatorView: React.FC = () => {
  const [source, setSource] = useState(SOURCES[0]);
  const [target, setTarget] = useState(TARGETS[0]);
  const [relationship] = useState('CAN_ASSUME');
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleTestGrant = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await runWhatIfSimulation(source, target);
      setResult(res);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="page-pad"
      style={{
        flex: 1,
        height: '100%',
        overflowY: 'auto',
        padding: '28px 36px',
        background: '#040711',
        color: '#e2e8f0',
        fontFamily: 'var(--font-sans, sans-serif)',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🧪</span>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
            What-If Policy Grant Simulator
          </h1>
          <span style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
            In-Memory Predictive Sandbox
          </span>
        </div>
        <p style={{ margin: 0, color: '#94a3b8', fontSize: 12 }}>
          Simulates granting hypothetical cloud permissions to verify whether indirect escalation paths open to Crown Jewels before applying changes to production.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 24, alignItems: 'start' }}>
        {/* Controls Card */}
        <div
          style={{
            background: 'rgba(8, 14, 28, 0.85)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Hypothetical Permission Parameters
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
              1. Principal Identity (Source):
            </label>
            <select
              value={source}
              onChange={e => setSource(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(0,0,0,0.5)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#f8fafc',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                outline: 'none',
              }}
            >
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
              2. Hypothetical Relationship:
            </label>
            <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#38bdf8' }}>
              -[:{relationship}]-&gt;
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
              3. Target Role / Resource to Grant:
            </label>
            <select
              value={target}
              onChange={e => setTarget(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(0,0,0,0.5)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#f8fafc',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                outline: 'none',
              }}
            >
              {TARGETS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <button
            onClick={handleTestGrant}
            disabled={loading}
            style={{
              marginTop: 8,
              padding: '12px 16px',
              borderRadius: 10,
              border: '1px solid rgba(56,189,248,0.4)',
              background: 'linear-gradient(135deg, rgba(56,189,248,0.2) 0%, rgba(168,85,247,0.2) 100%)',
              color: '#38bdf8',
              fontWeight: 700,
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 4px 16px rgba(56,189,248,0.15)',
            }}
          >
            {loading ? 'Evaluating in FalkorDB…' : '🧪 Run Predictive Traversal'}
          </button>
        </div>

        {/* Results Card */}
        <div
          style={{
            background: 'rgba(8, 14, 28, 0.85)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            padding: 24,
            minHeight: 280,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
            FalkorDB GraphBLAS Predictive Analysis
          </div>

          {!result ? (
            <div style={{ margin: 'auto', textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>⚡</div>
              <div style={{ fontSize: 12, maxWidth: 300, lineHeight: 1.5 }}>
                Select a source and target, then click "Run Predictive Traversal" to test for shadow privilege escalation.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Verdict Banner */}
              <div
                style={{
                  padding: '14px 18px',
                  borderRadius: 10,
                  background: result.opens_attack_path ? 'rgba(244,63,94,0.12)' : 'rgba(16,185,129,0.12)',
                  border: `1px solid ${result.opens_attack_path ? 'rgba(244,63,94,0.3)' : 'rgba(16,185,129,0.3)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 24 }}>{result.opens_attack_path ? '🚨' : '🛡️'}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: result.opens_attack_path ? '#f87171' : '#34d399' }}>
                    {result.verdict}
                  </div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#94a3b8', marginTop: 2 }}>
                    Evaluated in {result.execution_time_ms} ms via in-memory FalkorDB shortestPath
                  </div>
                </div>
              </div>

              {/* Path Details if opened */}
              {result.opens_attack_path && (
                <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 10, color: '#f87171', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', marginBottom: 8 }}>
                    Newly Unlocked Attack Vector ({result.new_path_hops} hops):
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                    {result.path_chain.map((node, i) => (
                      <React.Fragment key={node}>
                        <span
                          style={{
                            padding: '4px 8px',
                            borderRadius: 6,
                            background: i === 0 ? 'rgba(56,189,248,0.2)' : i === result.path_chain.length - 1 ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.08)',
                            color: i === 0 ? '#38bdf8' : i === result.path_chain.length - 1 ? '#fbbf24' : '#f1f5f9',
                            fontWeight: 600,
                          }}
                        >
                          {node}
                        </span>
                        {i < result.path_chain.length - 1 && (
                          <span style={{ color: '#f43f5e' }}>→</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 12, lineHeight: 1.5 }}>
                    <strong>CISO Warning:</strong> Approving this IAM policy change creates a shadow privilege bridge allowing <code>{result.source_name}</code> to compromise crown jewel asset <code>{result.target_compromised}</code>.
                  </div>
                </div>
              )}

              {/* Rule #3 Compliance Proof Note */}
              <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'var(--font-mono)', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
                💡 <strong>Why FalkorDB:</strong> Traditional Vector Search RAG cannot evaluate hypothetical graph topologies because embeddings are static text snapshots. FalkorDB evaluates each what-if branch as a live graph traversal; the measured time is shown with the result.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
