import React, { useState } from 'react';
import { runCypherPlayground } from '../services/api';

const PRESET_QUERIES = [
  {
    name: 'Find all attack paths to Crown Jewels',
    query: `MATCH p = allShortestPaths(
  (u:User)-[:HAS_ROLE|:GRANTS|:CAN_ACCESS*1..8]->(r:Resource)
)
WHERE r.sensitivity = 'CrownJewel'
RETURN p LIMIT 10`,
  },
  {
    name: 'Most over-privileged identities',
    query: `MATCH (u:User)-[:HAS_ROLE*1..3]->(r:Resource)
WHERE r.sensitivity IN ['CrownJewel', 'Secret']
RETURN u.name AS identity, count(r) AS access_count
ORDER BY access_count DESC LIMIT 10`,
  },
  {
    name: 'Crown Jewel blast radius',
    query: `MATCH (r:Resource {sensitivity: 'CrownJewel'})
OPTIONAL MATCH (u:User)-[:HAS_ROLE|:GRANTS|:CAN_ACCESS*1..5]->(r)
RETURN r.name AS resource, count(DISTINCT u) AS exposure
ORDER BY exposure DESC`,
  },
  {
    name: 'Shortest path: DevIntern → Prod DB',
    query: `MATCH (u:User {name: 'DevIntern'}), (r:Resource {name: 'ProdDatabase'})
MATCH p = shortestPath((u)-[:HAS_ROLE|:GRANTS|:CAN_ACCESS*1..8]->(r))
RETURN p`,
  },
];

export const CypherPlaygroundView: React.FC = () => {
  const [query, setQuery] = useState(PRESET_QUERIES[0].query);
  const [result, setResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [execTime, setExecTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);
    const t0 = performance.now();
    try {
      const res = await runCypherPlayground(query);
      setExecTime(Math.round((performance.now() - t0) * 100) / 100);
      if (res.error) { setError(res.error); } else { setResult(res); }
    } catch (e: any) {
      setError(e.message ?? 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run();
  };

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden grid-bg">
      <div className="flex h-full overflow-hidden">
        {/* Left: editor */}
        <div className="flex flex-col w-[55%] border-r border-white/5">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 h-11 border-b border-white/5 flex-shrink-0 gap-3">
            <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
              {PRESET_QUERIES.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setQuery(p.query)}
                  className="btn btn-ghost text-[10px] whitespace-nowrap flex-shrink-0 h-7 px-3"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Editor area */}
          <div className="flex-1 relative">
            <textarea
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              className="absolute inset-0 w-full h-full resize-none bg-transparent text-amber-300 font-mono text-[12.5px] p-5 focus:outline-none leading-relaxed"
              style={{ caretColor: '#f43f5e', tabSize: 2 }}
              placeholder="MATCH (n) RETURN n LIMIT 25"
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 h-11 border-t border-white/5 flex-shrink-0">
            <div className="flex items-center gap-2 text-[10px] font-mono text-slate-600">
              <span>⌘↵ to run</span>
              {execTime !== null && (
                <span className="badge badge-ok ml-2">⚡ {execTime}ms</span>
              )}
            </div>
            <button
              onClick={run}
              disabled={isLoading || !query.trim()}
              className="btn btn-attack"
            >
              {isLoading ? (
                <><span className="w-3 h-3 border border-red-300/40 border-t-red-300 rounded-full animate-spin" /> Running…</>
              ) : (
                <>▶ Execute Cypher</>
              )}
            </button>
          </div>
        </div>

        {/* Right: results */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 h-11 border-b border-white/5 flex-shrink-0">
            <span className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">Query Results</span>
            {result && (
              <span className="text-[10px] font-mono text-slate-500">
                {result.results?.length ?? 0} rows · FalkorDB
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 font-mono text-[11.5px]">
            {error && (
              <div className="glass-attack rounded-xl p-4 text-red-400 whitespace-pre-wrap">{error}</div>
            )}

            {!result && !error && !isLoading && (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-700">
                <span className="text-4xl opacity-20">⌘</span>
                <p>Execute a Cypher query to see results</p>
                <p className="text-[10px] text-slate-800">Connected to FalkorDB graph engine</p>
              </div>
            )}

            {result && result.results && (
              <div className="animate-fade-up space-y-1">
                {result.results.map((row: any, i: number) => (
                  <div
                    key={i}
                    className="rounded-lg px-3 py-2 hover:bg-white/[0.03] transition-colors"
                    style={{ animationDelay: `${i * 20}ms` }}
                  >
                    <pre className="text-slate-300 whitespace-pre-wrap">
                      {JSON.stringify(row, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
