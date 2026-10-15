import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { GraphTopology, GraphNode } from '../services/api';

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  label: string;
  sensitivity?: string;
  is_crown_jewel?: boolean;
  department?: string;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  id: string;
  type: string;
  source: string | D3Node;
  target: string | D3Node;
  properties?: Record<string, any>;
}

interface GraphCanvasProps {
  topology: GraphTopology | null;
  activePathNodeIds: string[];
  currentHopIndex?: number; // if specified, highlight path only up to this hop
  isolatedNodeIds?: Set<string> | null; // for blast radius isolation
  severedEdge: { src: string; dst: string } | null;
  onSelectNode: (node: GraphNode | null) => void;
}

const NODE_COLOR: Record<string, string> = {
  User: '#38bdf8',       // Sky blue
  Role: '#c084fc',       // Purple
  Policy: '#fbbf24',     // Amber
  Compute: '#34d399',    // Emerald
  Resource: '#2dd4bf',   // Teal
};

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  topology,
  activePathNodeIds,
  currentHopIndex,
  isolatedNodeIds,
  severedEdge,
  onSelectNode,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null);

  // Compute active nodes based on activePathNodeIds and optional currentHopIndex
  const activeIdsSet = useMemo(() => {
    if (!activePathNodeIds || activePathNodeIds.length === 0) return new Set<string>();
    const slice = currentHopIndex !== undefined
      ? activePathNodeIds.slice(0, currentHopIndex + 1)
      : activePathNodeIds;
    return new Set(slice.map(s => s.toLowerCase()));
  }, [activePathNodeIds, currentHopIndex]);

  // Transform topology data cleanly
  const { d3Nodes, d3Links } = useMemo(() => {
    if (!topology || !topology.nodes || topology.nodes.length === 0) {
      return { d3Nodes: [], d3Links: [] };
    }
    const nodes: D3Node[] = topology.nodes.map(n => ({ ...n }));
    const nodeLookup = new Map<string, D3Node>();
    nodes.forEach(n => {
      nodeLookup.set(n.id, n);
      nodeLookup.set(n.name, n);
    });

    const links: D3Link[] = [];
    topology.links.forEach(l => {
      const srcId = typeof l.source === 'string' ? l.source : (l.source as any)?.id;
      const dstId = typeof l.target === 'string' ? l.target : (l.target as any)?.id;
      if (nodeLookup.has(srcId) && nodeLookup.has(dstId)) {
        links.push({
          id: l.id || `link_${srcId}_${dstId}`,
          type: l.type,
          source: srcId,
          target: dstId,
          properties: l.properties || {},
        });
      }
    });

    return { d3Nodes: nodes, d3Links: links };
  }, [topology]);

  // Initialize and run D3 force simulation
  useEffect(() => {
    if (!svgRef.current || d3Nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const rect = svgRef.current.getBoundingClientRect();
    const width = rect.width || 900;
    const height = rect.height || 650;

    // SVG Defs: Filters and Markers
    const defs = svg.append('defs');

    // Glow Red Filter
    const fRed = defs.append('filter').attr('id', 'glow-attack')
      .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    fRed.append('feGaussianBlur').attr('stdDeviation', 6).attr('result', 'blur');
    const mRed = fRed.append('feMerge');
    mRed.append('feMergeNode').attr('in', 'blur');
    mRed.append('feMergeNode').attr('in', 'SourceGraphic');

    // Glow Gold Filter (Crown Jewels)
    const fGold = defs.append('filter').attr('id', 'glow-crown')
      .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    fGold.append('feGaussianBlur').attr('stdDeviation', 8).attr('result', 'blur');
    const mGold = fGold.append('feMerge');
    mGold.append('feMergeNode').attr('in', 'blur');
    mGold.append('feMergeNode').attr('in', 'SourceGraphic');

    // Arrows
    defs.append('marker').attr('id', 'arrow-default')
      .attr('viewBox', '0 -5 10 10').attr('refX', 22).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', 'rgba(255,255,255,0.12)');

    defs.append('marker').attr('id', 'arrow-attack')
      .attr('viewBox', '0 -5 10 10').attr('refX', 22).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', '#f43f5e');

    // Zoom container
    const gRoot = svg.append('g').attr('class', 'graph-root');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .on('zoom', (event) => {
        gRoot.attr('transform', event.transform);
      });
    svg.call(zoom);
    zoomBehaviorRef.current = zoom;

    // Initial center transform
    const initialTransform = d3.zoomIdentity.translate(width / 2, height / 2).scale(0.85);
    svg.call(zoom.transform, initialTransform);

    // Links container
    const linkGroup = gRoot.append('g').attr('class', 'links-layer');
    const linkSel = linkGroup.selectAll<SVGLineElement, D3Link>('line')
      .data(d3Links)
      .enter().append('line')
      .attr('stroke', 'rgba(255,255,255,0.08)')
      .attr('stroke-width', 1)
      .attr('marker-end', 'url(#arrow-default)');

    // Nodes container
    const nodeGroup = gRoot.append('g').attr('class', 'nodes-layer');
    const nodeSel = nodeGroup.selectAll<SVGGElement, D3Node>('g')
      .data(d3Nodes)
      .enter().append('g')
      .attr('class', 'node-item')
      .style('cursor', 'pointer')
      .on('click', (_, d) => onSelectNode(d as unknown as GraphNode))
      .call(
        d3.drag<SVGGElement, D3Node>()
          .on('start', (event, d) => {
            if (!event.active && simRef.current) simRef.current.alphaTarget(0.2).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active && simRef.current) simRef.current.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Crown Jewel Outer Halo
    nodeSel.filter(d => d.is_crown_jewel === true || d.sensitivity === 'CrownJewel')
      .append('circle')
      .attr('r', 28)
      .attr('fill', 'none')
      .attr('stroke', '#fbbf24')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.45)
      .attr('stroke-dasharray', '4 2')
      .attr('class', 'node-ring-active');

    // Base Circle
    nodeSel.append('circle')
      .attr('class', 'node-circle')
      .attr('r', d => (d.is_crown_jewel || d.sensitivity === 'CrownJewel') ? 16 : 10)
      .attr('fill', d => {
        if (d.is_crown_jewel || d.sensitivity === 'CrownJewel') return '#fbbf24';
        return NODE_COLOR[d.label] || '#94a3b8';
      })
      .attr('stroke', d => (d.is_crown_jewel || d.sensitivity === 'CrownJewel') ? '#fffbeb' : 'rgba(255,255,255,0.25)')
      .attr('stroke-width', d => (d.is_crown_jewel || d.sensitivity === 'CrownJewel') ? 2.5 : 1)
      .attr('filter', d => (d.is_crown_jewel || d.sensitivity === 'CrownJewel') ? 'url(#glow-crown)' : null);

    // Labels
    nodeSel.append('text')
      .attr('class', 'node-label')
      .text(d => d.name)
      .attr('dy', d => (d.is_crown_jewel || d.sensitivity === 'CrownJewel') ? 28 : 20)
      .attr('text-anchor', 'middle')
      .attr('font-family', 'var(--font-mono, monospace)')
      .attr('font-size', d => (d.is_crown_jewel || d.sensitivity === 'CrownJewel') ? 11 : 9.5)
      .attr('font-weight', d => (d.is_crown_jewel || d.sensitivity === 'CrownJewel') ? 'bold' : 'normal')
      .attr('fill', d => (d.is_crown_jewel || d.sensitivity === 'CrownJewel') ? '#fbbf24' : 'rgba(255,255,255,0.45)')
      .attr('pointer-events', 'none');

    // D3 Simulation Setup
    const sim = d3.forceSimulation<D3Node>(d3Nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(d3Links).id(d => d.id).distance(80).strength(0.4))
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(0, 0))
      .force('collision', d3.forceCollide<D3Node>().radius(d => (d.is_crown_jewel ? 34 : 20)))
      .force('x', d3.forceX(0).strength(0.03))
      .force('y', d3.forceY(0).strength(0.03));

    sim.on('tick', () => {
      linkSel
        .attr('x1', d => (d.source as D3Node).x || 0)
        .attr('y1', d => (d.source as D3Node).y || 0)
        .attr('x2', d => (d.target as D3Node).x || 0)
        .attr('y2', d => (d.target as D3Node).y || 0);

      nodeSel.attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);
    });

    simRef.current = sim;

    return () => {
      sim.stop();
    };
  }, [d3Nodes, d3Links]);

function getSafeNodeMeta(node: any): { id: string; name: string } {
  if (!node) return { id: '', name: '' };
  if (typeof node === 'string') {
    const s = node.toLowerCase();
    return { id: s, name: s };
  }
  const id = String(node.id || node.name || '').toLowerCase();
  const name = String(node.name || node.id || '').toLowerCase();
  return { id, name };
}

  // Update styles for active path and severed edge without restarting physics
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    const isNodeActive = (d: any) => {
      if (!d) return false;
      const { id, name } = getSafeNodeMeta(d);
      return activeIdsSet.has(id) || activeIdsSet.has(name);
    };

    const isLinkActive = (d: D3Link) => {
      if (!d || !d.source || !d.target) return false;
      return isNodeActive(d.source) && isNodeActive(d.target);
    };

    const isLinkSevered = (d: D3Link) => {
      if (!severedEdge || !severedEdge.src || !severedEdge.dst) return false;
      if (!d || !d.source || !d.target) return false;
      const s = getSafeNodeMeta(d.source);
      const t = getSafeNodeMeta(d.target);
      const targetSrc = String(severedEdge.src).toLowerCase();
      const targetDst = String(severedEdge.dst).toLowerCase();

      return (
        ((s.name === targetSrc || s.id === targetSrc) && (t.name === targetDst || t.id === targetDst)) ||
        ((s.name === targetDst || s.id === targetDst) && (t.name === targetSrc || t.id === targetSrc))
      );
    };

    // Update Links
    svg.selectAll<SVGLineElement, D3Link>('.links-layer line')
      .each(function(d) {
        const el = d3.select(this);
        const s = getSafeNodeMeta(d.source);
        const t = getSafeNodeMeta(d.target);
        const srcInIso = !isolatedNodeIds || isolatedNodeIds.has(s.id) || isolatedNodeIds.has(s.name);
        const dstInIso = !isolatedNodeIds || isolatedNodeIds.has(t.id) || isolatedNodeIds.has(t.name);
        const inIsolation = srcInIso && dstInIso;

        if (isLinkSevered(d)) {
          el.attr('stroke', '#ef4444')
            .attr('stroke-width', 2.5)
            .attr('stroke-dasharray', '6 4')
            .attr('marker-end', null)
            .attr('filter', 'url(#glow-attack)')
            .attr('opacity', 1);
        } else if (isLinkActive(d)) {
          el.attr('stroke', '#f43f5e')
            .attr('stroke-width', 3)
            .attr('stroke-dasharray', '8 4')
            .attr('marker-end', 'url(#arrow-attack)')
            .attr('filter', 'url(#glow-attack)')
            .attr('class', 'path-line-active')
            .attr('opacity', 1);
        } else {
          el.attr('stroke', 'rgba(255,255,255,0.08)')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', null)
            .attr('marker-end', 'url(#arrow-default)')
            .attr('filter', null)
            .attr('class', null)
            .attr('opacity', inIsolation ? 1 : 0.04);
        }
      });

    // Update Nodes
    svg.selectAll<SVGGElement, D3Node>('.node-item')
      .each(function(d) {
        const el = d3.select(this);
        const active = isNodeActive(d);
        const isCrown = d.is_crown_jewel || d.sensitivity === 'CrownJewel';
        const s = getSafeNodeMeta(d);
        const inIsolation = !isolatedNodeIds || isolatedNodeIds.has(s.id) || isolatedNodeIds.has(s.name);

        el.attr('opacity', inIsolation ? 1 : 0.12);

        const circle = el.select<SVGCircleElement>('.node-circle');
        const text = el.select<SVGTextElement>('.node-label');

        if (active) {
          circle
            .attr('r', isCrown ? 18 : 14)
            .attr('fill', isCrown ? '#fbbf24' : '#f43f5e')
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 2.5)
            .attr('filter', 'url(#glow-attack)');

          text
            .attr('fill', isCrown ? '#fbbf24' : '#fca5a5')
            .attr('font-weight', 'bold')
            .attr('font-size', 11);
        } else {
          circle
            .attr('r', isCrown ? 16 : 10)
            .attr('fill', isCrown ? '#fbbf24' : (NODE_COLOR[d.label] || '#94a3b8'))
            .attr('stroke', isCrown ? '#fffbeb' : 'rgba(255,255,255,0.25)')
            .attr('stroke-width', isCrown ? 2.5 : 1)
            .attr('filter', isCrown ? 'url(#glow-crown)' : null);

          text
            .attr('fill', isCrown ? '#fbbf24' : 'rgba(255,255,255,0.45)')
            .attr('font-weight', isCrown ? 'bold' : 'normal')
            .attr('font-size', isCrown ? 11 : 9.5);
        }
      });

    // Smooth camera pan to active path or isolated nodes
    const targetSet = activeIdsSet.size > 0 ? activeIdsSet : (isolatedNodeIds || null);
    if (targetSet && targetSet.size > 0 && zoomBehaviorRef.current && svgRef.current) {
      const activeNodes = d3Nodes.filter(n =>
        (targetSet.has(n.id.toLowerCase()) || targetSet.has(n.name.toLowerCase())) &&
        n.x !== undefined && n.y !== undefined
      );
      if (activeNodes.length > 0) {
        const rect = svgRef.current.getBoundingClientRect();
        const W = rect.width || 900;
        const H = rect.height || 650;

        const avgX = activeNodes.reduce((sum, n) => sum + (n.x || 0), 0) / activeNodes.length;
        const avgY = activeNodes.reduce((sum, n) => sum + (n.y || 0), 0) / activeNodes.length;

        svg.transition().duration(700).ease(d3.easeCubicOut).call(
          zoomBehaviorRef.current.transform,
          d3.zoomIdentity.translate(W / 2 - avgX * 1.1, H / 2 - avgY * 1.1).scale(1.1)
        );
      }
    }
  }, [activeIdsSet, severedEdge, isolatedNodeIds, d3Nodes]);

  // Camera reset helper
  const handleResetCamera = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const W = rect.width || 900;
    const H = rect.height || 650;
    d3.select(svgRef.current)
      .transition().duration(600)
      .call(zoomBehaviorRef.current.transform, d3.zoomIdentity.translate(W / 2, H / 2).scale(0.85));
  }, []);

  const handleZoomIn = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current).transition().duration(300).call(zoomBehaviorRef.current.scaleBy, 1.3);
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current).transition().duration(300).call(zoomBehaviorRef.current.scaleBy, 0.7);
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#040711',
        overflow: 'hidden',
      }}
      className="grid-bg"
    >
      <svg
        ref={svgRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: 'grab',
        }}
      />

      {/* Top Left: Legend */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 10,
          background: 'rgba(8, 13, 26, 0.85)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          padding: '10px 14px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Graph Entities
        </div>
        {Object.entries(NODE_COLOR).map(([label, color]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, fontSize: 11, fontFamily: 'var(--font-mono, monospace)', color: '#cbd5e1' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}`, flexShrink: 0 }} />
            <span>{label}</span>
          </div>
        ))}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 6, paddingTop: 6, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: 'var(--font-mono, monospace)', color: '#fbbf24' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#fbbf24', boxShadow: '0 0 8px #fbbf24', flexShrink: 0 }} />
          <span style={{ fontWeight: 600 }}>Crown Jewel</span>
        </div>
      </div>

      {/* Camera Controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          zIndex: 10,
          display: 'flex',
          gap: 6,
          background: 'rgba(8, 13, 26, 0.85)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10,
          padding: 4,
        }}
      >
        <button
          onClick={handleZoomIn}
          title="Zoom In"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: 'none',
            color: '#e2e8f0',
            width: 28,
            height: 28,
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          +
        </button>
        <button
          onClick={handleZoomOut}
          title="Zoom Out"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: 'none',
            color: '#e2e8f0',
            width: 28,
            height: 28,
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          -
        </button>
        <button
          onClick={handleResetCamera}
          title="Reset Camera"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: 'none',
            color: '#94a3b8',
            height: 28,
            padding: '0 8px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'var(--font-mono, monospace)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ⟲ Center
        </button>
      </div>

      {/* Bottom Left Info Badge */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          zIndex: 10,
          background: 'rgba(8, 13, 26, 0.85)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8,
          padding: '6px 12px',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 11,
          color: '#64748b',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <span>{d3Nodes.length} nodes · {d3Links.length} edges</span>
        {activeIdsSet.size > 0 && (
          <span style={{ color: '#f87171', fontWeight: 600 }}>
            ⚡ Attack Path: {activeIdsSet.size} active nodes
          </span>
        )}
        {severedEdge && (
          <span style={{ color: '#34d399', fontWeight: 600 }}>
            ⊘ Choke Point Severed
          </span>
        )}
      </div>
    </div>
  );
};
