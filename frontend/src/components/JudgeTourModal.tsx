import React, { useState } from 'react';
import { ActiveTab } from './Navbar';

interface JudgeTourModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChangeTab: (tab: ActiveTab) => void;
}

interface TourStep {
  step: number;
  title: string;
  badge: string;
  badgeColor: string;
  subtitle: string;
  description: string;
  killerFeature: string;
  targetTab: ActiveTab;
  tabLabel: string;
  codeSnippet?: string;
}

const STEPS: TourStep[] = [
  {
    step: 1,
    title: 'The Real-World Problem',
    badge: 'STAGE 1: THE BLIND SPOT',
    badgeColor: '#f87171',
    subtitle: 'IAM Combinatorial Explosion & Toxic Combinations',
    description:
      'Cloud infrastructures accumulate thousands of cross-account roles, Lambda permissions, and EC2 instance profiles. While each individual policy looks completely benign, transitive multi-hop chains allow low-privilege users (e.g. DevIntern) to silently escalate to Crown Jewels.',
    killerFeature: 'Seeded IAM infrastructure graph · Multi-Hop Role Assumption · No Direct Admin Policies',
    targetTab: 'graph',
    tabLabel: 'Explore Graph Topology',
    codeSnippet: 'MATCH (u:User {name:"DevIntern"})-[*1..5]->(c:Resource {is_crown_jewel:true}) RETURN count(paths)',
  },
  {
    step: 2,
    title: 'Why Graph Traversal',
    badge: 'STAGE 2: GRAPH VS VECTOR RETRIEVAL',
    badgeColor: '#fbbf24',
    subtitle: 'Vector Embeddings Are Blind to Transitive Graph Paths',
    description:
      'Standard Vector RAG embeds chunked IAM policies. When asked "Can DevIntern access CustomerVault?", no single chunk links the user to the vault, so retrieval can answer "SAFE" — a false negative. FalkorDB follows the 4-hop chain edge by edge, and the query time is measured on each run.',
    killerFeature: 'Side-by-side comparison: graph side measured live, vector side shown as a labelled simulation.',
    targetTab: 'benchmark',
    tabLabel: 'Open Benchmark (in More)',
    codeSnippet: 'Vector RAG: "No policy grants DevIntern vault access" [WRONG]\nFalkorDB: DevIntern → CIRunnerRole → BuildEC2 → BackendAppRole → ProdCustomerVault [EXPOSED]',
  },
  {
    step: 3,
    title: 'Autonomous AI Red Team Agent',
    badge: 'STAGE 3: GRAPH AS WORKING BRAIN',
    badgeColor: '#38bdf8',
    subtitle: 'Hop-by-Hop BFS Reasoning with Groq LLaMA 3.3 70B',
    description:
      'Rather than relying on static 1-shot Cypher queries, our AI Red Team agent autonomously walks the graph. At each hop, it queries neighbor topology, computes Crown Jewel reachability bonuses, logs its reasoning thoughts, and commits procedural decisions.',
    killerFeature: 'Live SSE Streaming · Dynamic Lookahead Scoring (+200 Crown Jewel Bonus) · In-flight Memory Node Creation',
    targetTab: 'swarm',
    tabLabel: 'Open Agent',
    codeSnippet: 'RedTeamAgent.expand() evaluates (neighbor, relations) using dynamic lookahead + FalkorDB graph memory',
  },
  {
    step: 4,
    title: 'Decision Trail: Why the Agent Chose Each Hop',
    badge: 'STAGE 4: EXPLAINABLE DECISIONS',
    badgeColor: '#fbbf24',
    subtitle: 'Every Choice, Its Alternatives, and the Memory Behind It',
    description:
      'Each agent decision is stored in FalkorDB as a (:Decision) node linked to the run. The Decision Trail view shows the step, the action, the reason, the chosen node, the alternatives it scored, and which :Incident or :Remediation nodes from earlier sessions informed the choice.',
    killerFeature: 'Red/Blue team timelines · Scored alternatives · Cross-session memory chips · The Cypher query behind the trail',
    targetTab: 'trail',
    tabLabel: 'Open Decision Trail',
    codeSnippet: 'MATCH (i:Incident)-[:HAS_DECISION]->(d:Decision)-[:CHOSE]->(n) RETURN d.step, d.action, n.name ORDER BY d.step',
  },
  {
    step: 5,
    title: 'Cognitive Memory & Auto-Remediation',
    badge: 'STAGE 5: LIVING EPISODIC MEMORY',
    badgeColor: '#34d399',
    subtitle: 'FalkorDB Learns: Remediated Paths Are Severed Forever',
    description:
      'When the Blue Team remediates a choke point (e.g. severing CIRunnerRole), it creates a (:Remediation)-[:SEVERED]->(n) graph structure and commits an (:Incident) node. When the Red Team is re-run, it recalls prior incidents from FalkorDB and skips severed edges.',
    killerFeature: 'Automated Terraform HCL Patch Generation · Blast Radius Delta Calculation · Repeat-Attack Immunity',
    targetTab: 'triage',
    tabLabel: 'View Security Triage & Choke Points',
    codeSnippet: 'MATCH (:Remediation)-[:SEVERED]->(n) WITH n MATCH (src)-[r]->(n) RETURN src.name, n.name',
  },
  {
    step: 6,
    title: 'Direct Cypher Access',
    badge: 'STAGE 6: FALKORDB PLAYGROUND',
    badgeColor: '#a855f7',
    subtitle: 'Run Cypher Traversals Against the Live Graph',
    description:
      'Test raw Cypher queries directly against the FalkorDB engine: attack paths, blast radii, and the stored decision trace. Each query reports its measured execution time.',
    killerFeature: 'Direct Cypher Console · algo.betweenness execution · Real-time execution runtime metrics (run_time_ms)',
    targetTab: 'playground',
    tabLabel: 'Open Cypher Playground',
    codeSnippet: 'MATCH p=shortestPath((u:User {name:"DevIntern"})-[*1..6]->(target:Resource {is_crown_jewel:true})) RETURN p',
  },
];

export const JudgeTourModal: React.FC<JudgeTourModalProps> = ({ isOpen, onClose, onChangeTab }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  if (!isOpen) return null;

  const current = STEPS[currentStepIndex];

  const handleNext = () => {
    if (currentStepIndex < STEPS.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  };

  const handleJumpToFeature = () => {
    onChangeTab(current.targetTab);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 680,
          background: 'linear-gradient(180deg, #131722 0%, #0d1017 100%)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 16,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(56, 189, 248, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'fade-up 200ms ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🏆</span>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>
                ARGUS — Hackathon Judge Guided Walkthrough
              </div>
              <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                Step {current.step} of {STEPS.length} · 2-Minute Proof of Value
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
              fontSize: 18,
              padding: '4px 8px',
              borderRadius: 6,
            }}
          >
            ✕
          </button>
        </div>

        {/* Progress Bar */}
        <div style={{ display: 'flex', height: 3, background: 'rgba(255, 255, 255, 0.05)' }}>
          {STEPS.map((s, idx) => (
            <div
              key={s.step}
              onClick={() => setCurrentStepIndex(idx)}
              style={{
                flex: 1,
                cursor: 'pointer',
                background:
                  idx === currentStepIndex
                    ? '#38bdf8'
                    : idx < currentStepIndex
                    ? '#22c55e'
                    : 'rgba(255, 255, 255, 0.1)',
                transition: 'background 200ms',
              }}
            />
          ))}
        </div>

        {/* Content Body */}
        <div style={{ padding: '24px 24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Badge & Title */}
          <div>
            <span
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: 4,
                background: `${current.badgeColor}22`,
                color: current.badgeColor,
                border: `1px solid ${current.badgeColor}44`,
                letterSpacing: '0.05em',
              }}
            >
              {current.badge}
            </span>
            <h2 style={{ fontSize: 19, fontWeight: 700, color: '#f8fafc', margin: '8px 0 2px' }}>
              {current.title}
            </h2>
            <div style={{ fontSize: 12.5, color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
              {current.subtitle}
            </div>
          </div>

          {/* Description */}
          <p style={{ fontSize: 13, lineHeight: 1.6, color: '#cbd5e1', margin: 0 }}>
            {current.description}
          </p>

          {/* Code / Snippet box if present */}
          {current.codeSnippet && (
            <div
              style={{
                background: 'rgba(0, 0, 0, 0.45)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 8,
                padding: '10px 14px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: '#38bdf8',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5,
              }}
            >
              {current.codeSnippet}
            </div>
          )}

          {/* Killer Feature Highlight Box */}
          <div
            style={{
              background: 'rgba(56, 189, 248, 0.06)',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              borderRadius: 8,
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 16 }}>⚡</span>
            <div style={{ fontSize: 11.5, color: '#bae6fd', fontFamily: 'var(--font-mono)' }}>
              <strong>Judge Focus:</strong> {current.killerFeature}
            </div>
          </div>
        </div>

        {/* Footer Controls */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          {/* Step circles */}
          <div style={{ display: 'flex', gap: 6 }}>
            {STEPS.map((s, idx) => (
              <button
                key={s.step}
                onClick={() => setCurrentStepIndex(idx)}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background:
                    idx === currentStepIndex
                      ? '#38bdf8'
                      : idx < currentStepIndex
                      ? 'rgba(34, 197, 94, 0.25)'
                      : 'rgba(255, 255, 255, 0.08)',
                  color:
                    idx === currentStepIndex
                      ? '#0f172a'
                      : idx < currentStepIndex
                      ? '#22c55e'
                      : '#64748b',
                }}
              >
                {s.step}
              </button>
            ))}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handlePrev}
              disabled={currentStepIndex === 0}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: currentStepIndex === 0 ? '#475569' : '#cbd5e1',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                cursor: currentStepIndex === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              ← Back
            </button>

            <button
              onClick={handleJumpToFeature}
              style={{
                padding: '7px 16px',
                borderRadius: 8,
                background: 'rgba(56, 189, 248, 0.15)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                color: '#38bdf8',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
              }}
            >
              🚀 {current.tabLabel}
            </button>

            <button
              onClick={handleNext}
              style={{
                padding: '7px 16px',
                borderRadius: 8,
                background: currentStepIndex === STEPS.length - 1 ? '#22c55e' : '#38bdf8',
                border: 'none',
                color: '#0f172a',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
              }}
            >
              {currentStepIndex === STEPS.length - 1 ? 'Finish Tour ✓' : 'Next Step →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
