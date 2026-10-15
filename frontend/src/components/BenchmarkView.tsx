import React, { useState } from 'react';
import { fetchBenchmarkCompare } from '../services/api';

interface BenchmarkViewProps { entrypoint: string; }

interface BenchmarkResult {
  falkordb_time_ms: number;
  vector_rag_time_ms: number;
  speedup: number;
  falkordb_path_length: number;
  falkordb_cypher: string;
}

export const BenchmarkView: React.FC<BenchmarkViewProps> = ({ entrypoint }) => {
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const run = async () => {
    setIsLoading(true);
    try {
      const res = await fetchBenchmarkCompare(entrypoint);
      setResult(res);
    } catch { /* ignore */ }
    setIsLoading(false);
  };

  const maxBar = result ? Math.max(result.falkordb_time_ms, result.vector_rag_time_ms) : 1;

  return (
    <div className="flex-1 h-full overflow-y-auto grid-bg">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="animate-fade-up space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-slate-100 font-mono flex items-center gap-2">
              <span className="text-amber-400">⚡</span>
              FalkorDB vs Vector RAG Benchmark
            </h1>
            <span className="badge badge-critical ml-2">FalkorDB Rule #3</span>
          </div>
          <p className="text-sm text-slate-500 max-w-2xl">
            Native Cypher graph traversal with <code className="text-amber-400/80 text-[11px]">shortestPath()</code> outperforms Vector RAG for multi-hop IAM chain discovery by orders of magnitude.
          </p>
        </div>

        {/* Why this matters */}
        <div className="animate-fade-up animate-fade-up-1 glass rounded-2xl p-5 space-y-3">
          <h2 className="text-[12px] uppercase tracking-widest text-slate-500 font-mono">Why FalkorDB Wins for IAM Graph Analysis</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: '⬡', title: 'Native Graph Traversal', desc: 'shortestPath() directly follows relationship edges — no embedding overhead, no retrieval guesswork.' },
              { icon: '⚡', title: 'Sub-millisecond Latency', desc: 'Graph queries on FalkorDB return in <1ms for 161-node IAM topologies. Vector RAG requires embedding + ANN search.' },
              { icon: '⊛', title: 'Multi-hop Precision', desc: 'Transitive privilege paths of 5+ hops are exact on a graph. Vector cosine similarity degrades with path length.' },
            ].map(c => (
              <div key={c.title} className="rounded-xl p-4 space-y-1.5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                <div className="text-xl">{c.icon}</div>
                <div className="text-slate-200 font-semibold text-[12px] font-mono">{c.title}</div>
                <div className="text-slate-500 text-[11px] leading-relaxed">{c.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Run benchmark */}
        <div className="animate-fade-up animate-fade-up-2 flex items-center gap-3">
          <button onClick={run} disabled={isLoading} className="btn btn-attack">
            {isLoading ? (
              <><span className="w-3 h-3 border border-red-300/40 border-t-red-300 rounded-full animate-spin" /> Benchmarking…</>
            ) : (
              <>⚡ Run Benchmark ({entrypoint})</>
            )}
          </button>
        </div>

        {/* Results */}
        {result && (
          <div className="animate-fade-up space-y-6">
            {/* Speedup hero */}
            <div
              className="rounded-2xl p-6 flex flex-col items-center justify-center gap-2 text-center"
              style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)' }}
            >
              <div className="text-5xl font-black text-amber-400 font-mono" style={{ textShadow: '0 0 40px rgba(251,191,36,0.5)' }}>
                {result.speedup}×
              </div>
              <div className="text-slate-300 font-semibold">Faster than Vector RAG</div>
              <div className="text-slate-500 text-[11px] font-mono">
                {result.falkordb_time_ms}ms (FalkorDB) vs {result.vector_rag_time_ms}ms (Vector RAG)
              </div>
            </div>

            {/* Bar comparison */}
            <div className="glass rounded-2xl p-5 space-y-4">
              <h2 className="text-[11px] uppercase tracking-widest text-slate-500 font-mono">Latency Comparison</h2>

              {[
                { label: 'FalkorDB shortestPath()', ms: result.falkordb_time_ms, color: '#10b981', glow: 'rgba(16,185,129,0.3)', badge: 'badge-ok', tag: 'Winner' },
                { label: 'Vector RAG (cosine sim)', ms: result.vector_rag_time_ms, color: '#f43f5e', glow: 'rgba(244,63,94,0.3)', badge: 'badge-critical', tag: 'Loser' },
              ].map(row => (
                <div key={row.label} className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-300">{row.label}</span>
                      <span className={`badge ${row.badge}`}>{row.tag}</span>
                    </div>
                    <span className="font-bold text-slate-200">{row.ms}ms</span>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden bg-white/5">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${(row.ms / maxBar) * 100}%`,
                        background: row.color,
                        boxShadow: `0 0 12px ${row.glow}`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Cypher used */}
            <div className="space-y-2">
              <h2 className="text-[11px] uppercase tracking-widest text-slate-500 font-mono">Cypher Query Executed</h2>
              <pre className="code-block whitespace-pre-wrap">{result.falkordb_cypher}</pre>
            </div>

            <div className="glass rounded-xl p-4 text-[11px] font-mono text-slate-500 space-y-1">
              <div>· Path length: <span className="text-cyan-400">{result.falkordb_path_length} hops</span></div>
              <div>· Method: <span className="text-amber-400">Native Cypher allShortestPaths()</span> traversal on FalkorDB adjacency list</div>
              <div>· Vector RAG simulated: embedding lookup + cosine ANN search over node descriptions (mock)</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
