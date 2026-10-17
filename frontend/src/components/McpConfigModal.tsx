import React, { useState } from 'react';

interface McpConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const McpConfigModal: React.FC<McpConfigModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const configJson = JSON.stringify(
    {
      mcpServers: {
        'argus-falkordb': {
          command: 'python',
          args: ['-m', 'backend.mcp_server'],
          env: {
            FALKOR_HOST: 'localhost',
            FALKOR_PORT: '6379',
          },
        },
      },
    },
    null,
    2
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(configJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        className="modal-sheet"
        style={{
          width: '100%',
          maxWidth: 620,
          background: 'linear-gradient(180deg, #131722 0%, #0d1017 100%)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 16,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 30px rgba(168, 85, 247, 0.12)',
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
            <span style={{ fontSize: 20 }}>🔌</span>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>
                Model Context Protocol (FastMCP) Integration
              </div>
              <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                Connect Claude Desktop, Cursor, or external AI agents to FalkorDB
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

        {/* Content */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 12.5, lineHeight: 1.6, color: '#cbd5e1', margin: 0 }}>
            ARGUS runs an internal <strong>FastMCP</strong> server at <code>/mcp</code> exposing real-time FalkorDB Cypher inspection, attack simulation, betweenness calculation, and automated remediation tools.
          </p>

          <div
            style={{
              background: 'rgba(168, 85, 247, 0.08)',
              border: '1px solid rgba(168, 85, 247, 0.25)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 11.5,
              color: '#d8b4fe',
              fontFamily: 'var(--font-mono)',
            }}
          >
            💡 <strong>Claude Desktop Config:</strong> Add the following snippet to your <code>claude_desktop_config.json</code>:
          </div>

          <div style={{ position: 'relative' }}>
            <pre
              style={{
                margin: 0,
                background: '#0a0d14',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 8,
                padding: '14px 16px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                color: '#38bdf8',
                overflowX: 'auto',
                lineHeight: 1.5,
              }}
            >
              {configJson}
            </pre>
            <button
              onClick={handleCopy}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                padding: '5px 12px',
                borderRadius: 6,
                background: copied ? '#22c55e' : 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                color: copied ? '#0f172a' : '#f1f5f9',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 150ms',
              }}
            >
              {copied ? '✓ Copied!' : '📋 Copy JSON'}
            </button>
          </div>

          {/* SSE Direct Endpoint Note */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
              Or connect via Server-Sent Events (SSE) Transport:
            </div>
            <code
              style={{
                background: 'rgba(0, 0, 0, 0.4)',
                padding: '6px 10px',
                borderRadius: 6,
                fontSize: 11,
                color: '#34d399',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              http://localhost:8001/mcp
            </code>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            justifyContent: 'flex-end',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px',
              borderRadius: 8,
              background: '#38bdf8',
              border: 'none',
              color: '#0f172a',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
