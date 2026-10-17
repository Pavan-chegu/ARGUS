import React, { useState } from 'react';
import { fetchBenchmarkCompare, BenchmarkCompareResult, BenchmarkSide } from '../services/api';

interface BenchmarkViewProps { entrypoint: string; }

const SideCard: React.FC<{ side: BenchmarkSide; color: string; title: string }> = ({ side, color, title }) => (
  <div className="rounded-2xl p-5 space-y-3" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${color}30` }}>
    <div className="flex items-center justify-between gap-2">
      <div className="text-[11px] uppercase tracking-widest font-mono" style={{ color }}>{title}</div>
      {side.simulated ? (
        <span className="badge badge-critical" title="This side is a labelled simulation, not a measurement">SIMULATED</span>
      ) : (
        <span className="badge badge-ok" title="Measured live against the active graph engine">MEASURED</span>
      )}
    </div>
    <div className="text-slate-200 font-semibold text-[12px] font-mono">{side.name}</div>
    <div className="text-slate-500 text-[11px] font-mono">{side.query_type}</div>
    <div className="text-[11px] font-mono space-y-1 pt-1">
      <div className="text-slate-400">Result: <span className="text-slate-200">{side.result}</span></div>
      <div className="text-slate-400">Hops discovered: <span className="text-slate-200">{side.hops_discovered}</span></div>
      <div className="text-slate-400">Multi-hop traversal: <span className="text-slate-200">{side.traversal_capable ? 'yes' : 'no'}</span></div>
      <div className="text-slate-400">
        Latency:{' '}
        <span className="text-slate-200">
          {typeof side.latency_ms === 'number' ? `${side.latency_ms} ms` : 'not measured'}
        </span>
      </div>
      <div className="text-slate-400">Accuracy: <span className="text-slate-200">{side.accuracy}</span></div>
      {side.hallucination && (
        <div className="text-slate-400">Failure mode: <span className="text-slate-200">{side.hallucination}</span></div>
      )}
    </div>
  </div>
);

export const BenchmarkView: React.FC<BenchmarkViewProps> = ({ entrypoint }) => {
  const [result, setResult] = useState<BenchmarkCompareResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchBenchmarkCompare(entrypoint);
      if (!res || !res.falkordb || !res.vector_rag) throw new Error('Unexpected benchmark response');
      setResult(res);
    } catch (e: any) {
      setError(e?.message ?? 'Benchmark request failed');
    }
    setIsLoading(false);
  };

  return (
    <div className="flex-1 h-full overflow-y-auto grid-bg">
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="animate-fade-up space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-slate-100 font-mono flex items-center gap-2">
              <span className="text-amber-400">⚡</span>
              Graph Traversal vs Vector RAG
            </h1>
          </div>
          <p className="text-sm text-slate-500 max-w-2xl">
            The graph side runs <code className="text-amber-400/80 text-[11px]">shortestPath()</code> live on the active engine (median of 20 runs).
            The vector side is a labelled simulation of retrieval over per-policy text chunks; its latency is not measured.
          </p>
        </div>

        {/* Why this matters */}
        <div className="animate-fade-up animate-fade-up-1 glass rounded-2xl p-5 space-y-3">
          <h2 className="text-[12px] uppercase tracking-widest text-slate-500 font-mono">Why a Graph Fits IAM Path Analysis</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: '⬡', title: 'Native Graph Traversal', desc: 'shortestPath() directly follows relationship edges — no embedding step and no top-k retrieval cut-off.' },
              { icon: '⏱', title: 'Measured Latency', desc: 'Graph query time is measured on each run and shown below. No vector latency is claimed.' },
              { icon: '⊛', title: 'Multi-hop Precision', desc: 'Transitive privilege paths are exact on a graph: every reported hop is an existing edge.' },
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
              <><span className="w-3 h-3 border border-red-300/40 border-t-red-300 rounded-full animate-spin" /> Running…</>
            ) : (
              <>⚡ Run Comparison ({entrypoint})</>
            )}
          </button>
          {error && <span className="text-[11px] font-mono text-red-400">⚠ {error}</span>}
        </div>

        {/* Results */}
        {result && (
          <div className="animate-fade-up space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SideCard side={result.vector_rag} color="#f43f5e" title="Vector RAG" />
              <SideCard side={result.falkordb} color="#10b981" title="Graph (FalkorDB)" />
            </div>

            {result.conclusion && (
              <div className="glass rounded-xl p-4 text-[11px] font-mono text-slate-400">
                {result.conclusion}
              </div>
            )}

            {result.speedup_factor != null && (
              <div className="text-[11px] font-mono text-slate-500">
                Speedup factor reported by backend: {result.speedup_factor}×
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
