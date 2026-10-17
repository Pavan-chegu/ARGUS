import React, { useState, useEffect, useRef } from 'react';

interface RAGStep {
  step: 'intent' | 'cypher' | 'retrieval' | 'generation' | 'complete';
  title: string;
  detail?: string;
  data?: any;
  status: 'pending' | 'active' | 'done';
  timestamp: number;
}

interface RAGExchange {
  id: string;
  question: string;
  timestamp: string;
  steps: RAGStep[];
  answer?: string;
  intent?: string;
  cypher?: string;
  retrievalMs?: number;
  generationMs?: number;
  totalMs?: number;
  context?: any;
  isStreaming: boolean;
}

const DEFAULT_QUESTIONS = [
  "Which identities can reach my Crown Jewels?",
  "Show me the attack path from DevIntern",
  "What are the riskiest identities in my organization?",
  "Which policies have the highest blast radius exposure?",
  "How do I remediate the most critical privilege escalation?",
  "What assets are most exposed in the graph?",
];

// Helper to format basic markdown into safe JSX
function renderFormattedMarkdown(text: string) {
  if (!text) return null;

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  lines.forEach((line, idx) => {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`code-${idx}`}
            style={{
              background: 'rgba(0, 0, 0, 0.65)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 8,
              padding: '12px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: '#38bdf8',
              overflowX: 'auto',
              margin: '8px 0',
            }}
          >
            <code>{codeBuffer.join('\n')}</code>
          </pre>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      return;
    }

    if (line.startsWith('### ')) {
      elements.push(
        <h3
          key={`h3-${idx}`}
          style={{
            color: '#f8fafc',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.04em',
            margin: '14px 0 6px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ color: '#f43f5e', fontSize: 10 }}>▶</span>
          {line.replace('### ', '')}
        </h3>
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <h2
          key={`h2-${idx}`}
          style={{
            color: '#fbbf24',
            fontFamily: 'var(--font-mono)',
            fontSize: 14,
            fontWeight: 700,
            margin: '16px 0 8px 0',
            borderBottom: '1px solid rgba(251, 191, 36, 0.2)',
            paddingBottom: 4,
          }}
        >
          {line.replace('## ', '')}
        </h2>
      );
    } else if (line.startsWith('* ') || line.startsWith('- ')) {
      const content = line.substring(2);
      elements.push(
        <li
          key={`li-${idx}`}
          style={{
            marginLeft: 18,
            marginBottom: 4,
            color: '#cbd5e1',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {formatInline(content)}
        </li>
      );
    } else if (line.trim().length === 0) {
      elements.push(<div key={`br-${idx}`} style={{ height: 6 }} />);
    } else {
      elements.push(
        <p
          key={`p-${idx}`}
          style={{
            margin: '4px 0',
            color: '#cbd5e1',
            fontSize: 12,
            lineHeight: 1.65,
          }}
        >
          {formatInline(line)}
        </p>
      );
    }
  });

  return elements;
}

function formatInline(text: string): React.ReactNode {
  // Format **bold** and `code`
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} style={{ color: '#f1f5f9', fontWeight: 600 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            padding: '1px 6px',
            borderRadius: 4,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: '#06b6d4',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export const CopilotView: React.FC = () => {
  const [questions, setQuestions] = useState<string[]>(DEFAULT_QUESTIONS);
  const [inputQuestion, setInputQuestion] = useState('');
  const [exchanges, setExchanges] = useState<RAGExchange[]>([]);
  const [activeExchangeId, setActiveExchangeId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedContexts, setExpandedContexts] = useState<Record<string, boolean>>({});

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch live questions from backend
  useEffect(() => {
    fetch('/api/rag/questions')
      .then(res => res.json())
      .then(data => {
        if (data.questions && data.questions.length > 0) {
          setQuestions(data.questions);
        }
      })
      .catch(() => {
        // Fallback to defaults
      });
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [exchanges, activeExchangeId]);

  const handleAsk = async (questionText: string) => {
    const q = questionText.trim();
    if (!q || isSubmitting) return;

    const exchangeId = `rag-${Date.now()}`;
    const initialSteps: RAGStep[] = [
      { step: 'intent', title: 'Intent Classification', status: 'active', timestamp: Date.now() },
      { step: 'cypher', title: 'Cypher Query Synthesis', status: 'pending', timestamp: Date.now() },
      { step: 'retrieval', title: 'FalkorDB Graph Traversal', status: 'pending', timestamp: Date.now() },
      { step: 'generation', title: 'Context-Augmented Generation', status: 'pending', timestamp: Date.now() },
    ];

    const newExchange: RAGExchange = {
      id: exchangeId,
      question: q,
      timestamp: new Date().toLocaleTimeString(),
      steps: initialSteps,
      isStreaming: true,
    };

    setExchanges(prev => [...prev, newExchange]);
    setActiveExchangeId(exchangeId);
    setInputQuestion('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/rag/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });

      if (!response.body) {
        throw new Error('ReadableStream not supported');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const eventBlock of events) {
          if (!eventBlock.trim()) continue;

          let eventType = '';
          let eventData: any = null;

          const lines = eventBlock.split('\n');
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.replace('event: ', '').trim();
            } else if (line.startsWith('data: ')) {
              try {
                eventData = JSON.parse(line.replace('data: ', '').trim());
              } catch {
                // Ignore parse errors
              }
            }
          }

          if (!eventType || !eventData) continue;

          // Process the RAG pipeline events
          setExchanges(prev =>
            prev.map(ex => {
              if (ex.id !== exchangeId) return ex;

              const updatedSteps = [...ex.steps];

              if (eventType === 'intent_detected') {
                updatedSteps[0] = {
                  step: 'intent',
                  title: `Intent: ${eventData.label || eventData.intent}`,
                  detail: eventData.message,
                  data: eventData,
                  status: 'done',
                  timestamp: Date.now(),
                };
                updatedSteps[1] = { ...updatedSteps[1], status: 'active' };
                return {
                  ...ex,
                  intent: eventData.intent,
                  steps: updatedSteps,
                };
              }

              if (eventType === 'cypher_generated') {
                updatedSteps[1] = {
                  step: 'cypher',
                  title: 'Cypher Query Formulated',
                  detail: eventData.cypher,
                  data: eventData,
                  status: 'done',
                  timestamp: Date.now(),
                };
                updatedSteps[2] = { ...updatedSteps[2], status: 'active' };
                return {
                  ...ex,
                  cypher: eventData.cypher,
                  steps: updatedSteps,
                };
              }

              if (eventType === 'retrieving') {
                updatedSteps[2] = {
                  step: 'retrieval',
                  title: 'Traversing FalkorDB Adjacency Graph…',
                  detail: eventData.message,
                  status: 'active',
                  timestamp: Date.now(),
                };
                return { ...ex, steps: updatedSteps };
              }

              if (eventType === 'context_ready') {
                updatedSteps[2] = {
                  step: 'retrieval',
                  title: `Graph Context Retrieved (${eventData.retrieval_ms}ms)`,
                  detail: eventData.message,
                  data: eventData.raw_context,
                  status: 'done',
                  timestamp: Date.now(),
                };
                updatedSteps[3] = { ...updatedSteps[3], status: 'active' };
                return {
                  ...ex,
                  retrievalMs: eventData.retrieval_ms,
                  context: eventData.raw_context,
                  steps: updatedSteps,
                };
              }

              if (eventType === 'generating') {
                updatedSteps[3] = {
                  step: 'generation',
                  title: 'Synthesizing Natural Language Security Analysis…',
                  detail: eventData.message,
                  status: 'active',
                  timestamp: Date.now(),
                };
                return { ...ex, steps: updatedSteps };
              }

              if (eventType === 'complete') {
                updatedSteps[3] = {
                  step: 'generation',
                  title: `Synthesis Complete (${eventData.generation_ms}ms)`,
                  detail: `Pipeline finished in ${eventData.total_ms}ms`,
                  status: 'done',
                  timestamp: Date.now(),
                };
                return {
                  ...ex,
                  answer: eventData.answer,
                  intent: eventData.intent,
                  cypher: eventData.cypher_used,
                  retrievalMs: eventData.retrieval_ms,
                  generationMs: eventData.generation_ms,
                  totalMs: eventData.total_ms,
                  context: eventData.context,
                  steps: updatedSteps,
                  isStreaming: false,
                };
              }

              return ex;
            })
          );
        }
      }
    } catch (err) {
      console.error('RAG Stream Error:', err);
      setExchanges(prev =>
        prev.map(ex =>
          ex.id === exchangeId
            ? { ...ex, isStreaming: false, answer: `❌ RAG Pipeline Error: ${(err as Error).message}` }
            : ex
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleContext = (id: string) => {
    setExpandedContexts(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div
      className="copilot"
      style={{
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        background: 'transparent',
      }}
    >
      {/* ── Left Sidebar: RAG Architecture & Suggested Questions ── */}
      <aside
        className="copilot-sidebar"
        style={{
          borderRight: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          gap: 16,
          overflowY: 'auto',
        }}
      >
        {/* Header Badge */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 10px #10b981',
              }}
            />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: '#10b981',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              FalkorDB Graph RAG Active
            </span>
          </div>
          <h2
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 16,
              fontWeight: 800,
              color: '#f8fafc',
              letterSpacing: '-0.02em',
            }}
          >
            Graph RAG Copilot
          </h2>
          <p
            style={{
              fontSize: 11,
              color: '#64748b',
              lineHeight: 1.5,
              marginTop: 4,
            }}
          >
            Natural language questions translated to Cypher graph traversals, so each answer is grounded in graph query results.
          </p>
        </div>

        {/* Why Graph RAG vs Vector RAG Card */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 12,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 700,
              color: '#38bdf8',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            ⚖️ Architecture Comparison
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                background: 'rgba(244, 63, 94, 0.08)',
                border: '1px solid rgba(244, 63, 94, 0.2)',
                borderRadius: 8,
                padding: '6px 8px',
                fontSize: 10,
                color: '#fca5a5',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2 }}>❌ Traditional Vector RAG</div>
              <div>• Top-k cosine similarity misses multi-hop relationships</div>
              <div>• Cannot verify privilege chains</div>
              <div>• May infer links that are not in the data</div>
            </div>

            <div
              style={{
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                borderRadius: 8,
                padding: '6px 8px',
                fontSize: 10,
                color: '#6ee7b7',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2 }}>✓ FalkorDB Graph RAG</div>
              <div>• Exact `shortestPath()` multi-hop traversal</div>
              <div>• Deterministic query results; every hop is an edge</div>
              <div>• Query latency reported per run</div>
            </div>
          </div>
        </div>

        {/* Suggested Queries */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 700,
              color: '#94a3b8',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Suggested Questions</span>
            <span style={{ fontSize: 9, color: '#475569' }}>CLICK TO ASK</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {questions.map((q, idx) => (
              <button
                key={idx}
                disabled={isSubmitting}
                onClick={() => handleAsk(q)}
                style={{
                  textAlign: 'left',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  color: '#cbd5e1',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  lineHeight: 1.4,
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  transition: 'all 150ms ease',
                  opacity: isSubmitting ? 0.6 : 1,
                }}
                onMouseEnter={e => {
                  if (!isSubmitting) {
                    e.currentTarget.style.background = 'rgba(56, 189, 248, 0.08)';
                    e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.3)';
                    e.currentTarget.style.color = '#38bdf8';
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                  e.currentTarget.style.color = '#cbd5e1';
                }}
              >
                <span style={{ color: '#f43f5e', marginRight: 6 }}>›</span>
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Engine Specs Pill */}
        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: '#64748b',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Retrieval Engine:</span>
            <span style={{ color: '#06b6d4' }}>FalkorDB Graph</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Traversal Model:</span>
            <span style={{ color: '#cbd5e1' }}>Adjacency Matrix</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Augmentation:</span>
            <span style={{ color: '#10b981' }}>Graph Topologies</span>
          </div>
        </div>
      </aside>

      {/* ── Main Chat & Pipeline Stream Area ── */}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Messages / Conversation Stream */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 32px',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          {exchanges.length === 0 ? (
            /* Empty State Hero */
            <div
              style={{
                margin: 'auto',
                maxWidth: 640,
                textAlign: 'center',
                padding: '40px 24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(244, 63, 94, 0.2))',
                  border: '1px solid rgba(6, 182, 212, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 26,
                  boxShadow: '0 0 30px rgba(6, 182, 212, 0.2)',
                }}
              >
                🧠
              </div>

              <div>
                <h1
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 22,
                    fontWeight: 800,
                    color: '#f8fafc',
                    letterSpacing: '-0.02em',
                  }}
                >
                  FalkorDB Graph RAG Copilot
                </h1>
                <p
                  style={{
                    color: '#94a3b8',
                    fontSize: 13,
                    lineHeight: 1.6,
                    marginTop: 8,
                    maxWidth: 520,
                  }}
                >
                  Ask any question about your IAM graph architecture. Watch the live 4-step pipeline:
                  <strong> Question → Cypher Synthesis → FalkorDB Traversal → Context-Augmented Answer</strong>.
                </p>
              </div>

              {/* Quick Launch Cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
                  gap: 10,
                  width: '100%',
                  marginTop: 8,
                }}
              >
                {[
                  {
                    icon: '🎯',
                    title: 'Crown Jewel Access',
                    q: 'Which identities can reach my Crown Jewels?',
                    desc: 'Find all unprivileged users with paths to sensitive data',
                  },
                  {
                    icon: '🔥',
                    title: 'Attack Path Trace',
                    q: 'Show me the attack path from DevIntern',
                    desc: 'Trace multi-hop privilege escalation step-by-step',
                  },
                  {
                    icon: '🚨',
                    title: 'Riskiest Identities',
                    q: 'What are the riskiest identities in my organization?',
                    desc: 'Rank identities by blast radius and target access',
                  },
                  {
                    icon: '🛡️',
                    title: 'Remediation Advice',
                    q: 'How do I remediate the most critical privilege escalation?',
                    desc: 'Calculate the optimal choke point to sever',
                  },
                ].map((card, i) => (
                  <button
                    key={i}
                    onClick={() => handleAsk(card.q)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: 12,
                      padding: 14,
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 200ms ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                      e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.3)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 16 }}>{card.icon}</span>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#f1f5f9',
                        }}
                      >
                        {card.title}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>{card.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            exchanges.map((ex) => (
              <div
                key={ex.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: 16,
                  padding: 20,
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                }}
              >
                {/* ── User Question Banner ── */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                    paddingBottom: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: 'linear-gradient(135deg, #38bdf8, #0284c7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                        color: 'white',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      Q
                    </div>
                    <div>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 14,
                          fontWeight: 700,
                          color: '#f8fafc',
                        }}
                      >
                        {ex.question}
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          color: '#64748b',
                          marginTop: 2,
                        }}
                      >
                        {ex.timestamp} • FalkorDB Graph Pipeline
                      </div>
                    </div>
                  </div>

                  {/* Latency Pill */}
                  {ex.totalMs && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'rgba(16, 185, 129, 0.1)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        borderRadius: 99,
                        padding: '4px 10px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: '#34d399',
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      <span>⚡</span>
                      <span>Total: {ex.totalMs}ms</span>
                      <span style={{ color: '#64748b' }}>|</span>
                      <span>Graph: {ex.retrievalMs}ms</span>
                    </div>
                  )}
                </div>

                {/* ── Visual RAG Pipeline Stepper ── */}
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    borderRadius: 12,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: '#94a3b8',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>✦</span>
                    <span>Visible RAG Pipeline Execution</span>
                  </div>

                  {/* 4-Step Pipeline Flow */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                      gap: 8,
                    }}
                  >
                    {ex.steps.map((st, i) => {
                      const isActive = st.status === 'active';
                      const isDone = st.status === 'done';

                      return (
                        <div
                          key={i}
                          style={{
                            background: isDone
                              ? 'rgba(16, 185, 129, 0.05)'
                              : isActive
                              ? 'rgba(56, 189, 248, 0.08)'
                              : 'rgba(255, 255, 255, 0.02)',
                            border: `1px solid ${
                              isDone
                                ? 'rgba(16, 185, 129, 0.25)'
                                : isActive
                                ? 'rgba(56, 189, 248, 0.4)'
                                : 'rgba(255, 255, 255, 0.05)'
                            }`,
                            borderRadius: 8,
                            padding: '8px 10px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            position: 'relative',
                            transition: 'all 200ms ease',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <span
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: 9,
                                color: isDone ? '#34d399' : isActive ? '#38bdf8' : '#64748b',
                                fontWeight: 700,
                              }}
                            >
                              STEP {i + 1}
                            </span>
                            <span style={{ fontSize: 11 }}>
                              {isDone ? '✓' : isActive ? '⏳' : '○'}
                            </span>
                          </div>
                          <div
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 11,
                              fontWeight: 600,
                              color: isDone ? '#f1f5f9' : isActive ? '#38bdf8' : '#94a3b8',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {st.title}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Generated Cypher Query (Step 2 Preview) */}
                  {ex.cypher && (
                    <div
                      style={{
                        background: 'rgba(8, 14, 28, 0.8)',
                        border: '1px solid rgba(56, 189, 248, 0.2)',
                        borderRadius: 8,
                        padding: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          color: '#38bdf8',
                        }}
                      >
                        <span style={{ fontWeight: 700 }}>Generated Cypher (FalkorDB Retrieval):</span>
                        <button
                          onClick={() => navigator.clipboard.writeText(ex.cypher || '')}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#64748b',
                            fontSize: 10,
                            cursor: 'pointer',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          Copy
                        </button>
                      </div>
                      <code
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          color: '#f8fafc',
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}
                      >
                        {ex.cypher}
                      </code>
                    </div>
                  )}

                  {/* Raw Context Inspector Toggle (Step 3 Preview) */}
                  {ex.context && (
                    <div>
                      <button
                        onClick={() => toggleContext(ex.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#94a3b8',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: 0,
                        }}
                      >
                        <span>{expandedContexts[ex.id] ? '▼ Hide' : '▶ Inspect'}</span>
                        <span>Retrieved Graph Context ({Object.keys(ex.context).length} keys)</span>
                      </button>

                      {expandedContexts[ex.id] && (
                        <pre
                          style={{
                            background: 'rgba(0, 0, 0, 0.7)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: 8,
                            padding: '10px 12px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            color: '#a5f3fc',
                            maxHeight: 220,
                            overflowY: 'auto',
                            marginTop: 6,
                          }}
                        >
                          {JSON.stringify(ex.context, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Generated Answer Section (Step 4) ── */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        background: 'linear-gradient(135deg, #10b981, #059669)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        color: 'white',
                      }}
                    >
                      A
                    </div>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#34d399',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      Graph RAG Synthesis
                    </span>
                  </div>

                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      borderRadius: 12,
                      padding: 16,
                    }}
                  >
                    {ex.answer ? (
                      <div>{renderFormattedMarkdown(ex.answer)}</div>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          color: '#94a3b8',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                        }}
                      >
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            border: '2px solid rgba(56, 189, 248, 0.3)',
                            borderTopColor: '#38bdf8',
                            borderRadius: '50%',
                            display: 'inline-block',
                            animation: 'spin 0.8s linear infinite',
                          }}
                        />
                        <span>Executing Graph RAG pipeline in FalkorDB…</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* ── Bottom Input Bar ── */}
        <div
          style={{
            padding: '16px 32px 20px 32px',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
          }}
        >
          <form
            onSubmit={e => {
              e.preventDefault();
              handleAsk(inputQuestion);
            }}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <div style={{ flex: '1 1 220px', minWidth: 0, position: 'relative' }}>
              <input
                ref={inputRef}
                type="text"
                value={inputQuestion}
                onChange={e => setInputQuestion(e.target.value)}
                placeholder="Ask about attack paths, Crown Jewels, blast radius, or remediation..."
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  background: 'rgba(0, 0, 0, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: 12,
                  padding: '12px 18px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: '#f8fafc',
                  outline: 'none',
                  transition: 'border-color 150ms ease',
                }}
                onFocus={e => (e.target.style.borderColor = 'rgba(56, 189, 248, 0.5)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(255, 255, 255, 0.12)')}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !inputQuestion.trim()}
              style={{
                background: isSubmitting
                  ? 'rgba(255, 255, 255, 0.05)'
                  : 'linear-gradient(135deg, #0284c7, #06b6d4)',
                border: 'none',
                borderRadius: 12,
                padding: '12px 24px',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                color: 'white',
                cursor: isSubmitting || !inputQuestion.trim() ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: isSubmitting ? 'none' : '0 0 16px rgba(6, 182, 212, 0.3)',
                opacity: isSubmitting || !inputQuestion.trim() ? 0.5 : 1,
                transition: 'all 150ms ease',
              }}
            >
              {isSubmitting ? (
                <>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      border: '2px solid rgba(255, 255, 255, 0.3)',
                      borderTopColor: 'white',
                      borderRadius: '50%',
                      display: 'inline-block',
                      animation: 'spin 0.8s linear infinite',
                    }}
                  />
                  <span>Traversing…</span>
                </>
              ) : (
                <>
                  <span>Ask RAG</span>
                  <span>▶</span>
                </>
              )}
            </button>
          </form>

          {/* Quick Filter Tags */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
              marginTop: 10,
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: '#64748b',
            }}
          >
            <span>TRY:</span>
            {[
              "Which identities can reach Crown Jewels?",
              "Attack path from DevIntern",
              "How to remediate?",
            ].map((shortcut, i) => (
              <button
                key={i}
                disabled={isSubmitting}
                onClick={() => handleAsk(shortcut)}
                style={{
                  background: 'none',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 6,
                  padding: '2px 8px',
                  color: '#94a3b8',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {shortcut}
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};
