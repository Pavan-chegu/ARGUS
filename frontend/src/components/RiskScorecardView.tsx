import React, { useState } from 'react';
import { fetchRiskScorecard } from '../services/api';

interface RiskEntry {
  identity_name: string;
  identity_type: string;
  crown_jewel: string | null;      // crown jewel this identity can reach, if any
  accessible_total: number;
  risk_score: number;
  risk_tier: string;
  shortest_path_length: number | null;
}

// /api/graph/risk-scorecard rows → table rows. The API sends target_jewel as "None"
// and 0 hops for identities that reach no crown jewel.
const toEntry = (x: any): RiskEntry => ({
  identity_name: x.name,
  identity_type: x.department,
  crown_jewel: x.target_jewel && x.target_jewel !== 'None' ? x.target_jewel : null,
  accessible_total: x.blast_radius_resources ?? 0,
  risk_score: x.risk_score ?? 0,
  risk_tier: x.risk_level ?? 'LOW',
  shortest_path_length: x.max_escalation_hops > 0 ? x.max_escalation_hops : null,
});

const TIER_CONFIG: Record<string, { badge: string; bar: string }> = {
  CRITICAL: { badge: 'badge-critical', bar: '#f43f5e' },
  HIGH:     { badge: 'badge-high',     bar: '#f59e0b' },
  MEDIUM:   { badge: 'badge-info',     bar: '#3b82f6' },
  LOW:      { badge: 'badge-ok',       bar: '#10b981' },
};

export const RiskScorecardView: React.FC = () => {
  const [data, setData] = useState<RiskEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchRiskScorecard();
      setData((res.identities || []).map(toEntry));
    } catch {
      setError('Failed to load scorecard. Is the backend running?');
    } finally {
      setIsLoading(false);
    }
  };

  const maxScore = data ? Math.max(...data.map(d => d.risk_score), 1) : 1;

  return (
    <div className="flex-1 h-full overflow-y-auto grid-bg">
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="animate-fade-up space-y-1">
          <h1 className="text-lg font-bold text-slate-100 font-mono flex items-center gap-2">
            <span className="text-red-400">⊛</span>
            Blast Radius Risk Scorecard
          </h1>
          <p className="text-sm text-slate-500">
            Identities ranked by transitive blast radius to Crown Jewel resources.
            Calculated via FalkorDB <code className="text-amber-400/80 text-[11px]">shortestPath</code> traversals.
          </p>
        </div>

        {/* Actions */}
        <div className="animate-fade-up animate-fade-up-1 flex items-center gap-3">
          <button onClick={load} disabled={isLoading} className="btn btn-attack">
            {isLoading ? (
              <><span className="w-3 h-3 border border-red-300/40 border-t-red-300 rounded-full animate-spin" /> Computing…</>
            ) : (
              <>⊛ Compute Scorecard</>
            )}
          </button>
          {data && (
            <span className="text-slate-500 text-[11px] font-mono">
              {data.length} identities ranked
            </span>
          )}
        </div>

        {error && (
          <div className="glass-attack rounded-xl p-4 text-red-400 text-sm font-mono">{error}</div>
        )}

        {/* Table */}
        {data && (
          <div className="animate-fade-up animate-fade-up-2 glass rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] font-mono">
                <thead>
                  <tr className="border-b border-white/5">
                    {['Rank', 'Identity', 'Type', 'Risk Tier', 'Risk Score', 'Crown Jewel Reached', 'Total Accessible', 'Path Hops'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-[10px] text-slate-500 uppercase tracking-wider font-semibold whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, i) => {
                    const tier = TIER_CONFIG[row.risk_tier] ?? TIER_CONFIG['LOW'];
                    const barPct = (row.risk_score / maxScore) * 100;
                    return (
                      <tr
                        key={row.identity_name}
                        className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                        style={{ animationDelay: `${i * 30}ms` }}
                      >
                        <td className="px-4 py-3 text-slate-600">#{i + 1}</td>
                        <td className="px-4 py-3 text-slate-200 font-semibold whitespace-nowrap">{row.identity_name}</td>
                        <td className="px-4 py-3">
                          <span className="badge badge-info">{row.identity_type}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`badge ${tier.badge}`}>{row.risk_tier}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-200 font-bold w-8">{row.risk_score}</span>
                            <div className="flex-1 min-w-[60px] h-1.5 bg-white/5 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-700"
                                style={{ width: `${barPct}%`, background: tier.bar, boxShadow: `0 0 6px ${tier.bar}` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-amber-400 font-bold whitespace-nowrap">{row.crown_jewel ?? <span className="text-slate-600 font-normal">—</span>}</td>
                        <td className="px-4 py-3 text-slate-400">{row.accessible_total}</td>
                        <td className="px-4 py-3 text-cyan-400">{row.shortest_path_length ?? <span className="text-slate-600">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!data && !isLoading && (
          <div className="glass rounded-2xl h-64 flex flex-col items-center justify-center gap-4 text-slate-600">
            <span className="text-5xl opacity-20">⊛</span>
            <p className="font-mono text-sm">Click "Compute Scorecard" to rank all identities by blast radius</p>
          </div>
        )}
      </div>
    </div>
  );
};
