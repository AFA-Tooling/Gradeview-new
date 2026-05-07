import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Chip, Stack, Tooltip, Typography } from '@mui/material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  PanOnScrollMode,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const NODE_WIDTH = 180;
const DETAIL_NODE_WIDTH = 260;
const NODE_HEIGHT = 68;
const RESULT_NODE_HEIGHT = 106;
const DETAIL_ROW_HEIGHT = 24;
const LAYER_GAP = 292;
const ROW_GAP = 92;
const GROUP_GAP = 58;
const INLINE_DETAIL_SUBTYPES = new Set(['drop', 'filter']);
const RAW_PROCESSING_SUBTYPES = new Set(['drop', 'filter']);

function formatPoints(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  if (Math.abs(numeric - Math.round(numeric)) < 0.005) return String(Math.round(numeric));
  return numeric.toFixed(digits);
}

function formatNodeResult(data) {
  if (data?.score == null) return '-';
  const score = Number(data.score);
  const maxScore = data?.maxScore == null ? NaN : Number(data.maxScore);
  if (Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0) {
    return `${formatPoints(score)} / ${formatPoints(maxScore)}`;
  }
  if (Number.isFinite(score)) return formatPoints(score);
  return '-';
}

function policyText(data) {
  return data?.details?.operator || data?.displayValue || data?.subtype || 'policy';
}

function nodeTone(type, subtype) {
  if (type === 'raw') return { border: '#2563eb', bg: '#ffffff', title: '#111827', accent: '#1d4ed8', soft: '#eff6ff' };
  if (type === 'category_output') return { border: '#0891b2', bg: '#ffffff', title: '#0f172a', accent: '#0e7490', soft: '#ecfeff' };
  if (type === 'final_output') return { border: '#111111', bg: '#ffffff', title: '#111111', accent: '#111111', soft: '#f3f4f6' };

  const logical = {
    drop: { border: '#c2410c', bg: '#ffffff', title: '#111827', accent: '#c2410c', soft: '#fff7ed' },
    filter: { border: '#7c3aed', bg: '#ffffff', title: '#111827', accent: '#7c3aed', soft: '#f5f3ff' },
    max: { border: '#dc2626', bg: '#ffffff', title: '#111827', accent: '#dc2626', soft: '#fef2f2' },
    clobber: { border: '#dc2626', bg: '#ffffff', title: '#111827', accent: '#dc2626', soft: '#fef2f2' },
    sum: { border: '#15803d', bg: '#ffffff', title: '#111827', accent: '#15803d', soft: '#f0fdf4' },
    scale: { border: '#ca8a04', bg: '#ffffff', title: '#111827', accent: '#a16207', soft: '#fefce8' },
    cap: { border: '#ca8a04', bg: '#ffffff', title: '#111827', accent: '#a16207', soft: '#fefce8' },
  };
  return logical[subtype] || logical.sum;
}

function StatusPill({ status }) {
  const colors = {
    kept: '#15803d',
    selected: '#15803d',
    dropped: '#c2410c',
    ignored: '#64748b',
    missing: '#dc2626',
    output: '#0e7490',
  };
  return (
    <Box
      component="span"
      sx={{
        px: 0.7,
        py: 0.15,
        borderRadius: 999,
        color: colors[status] || '#64748b',
        backgroundColor: 'rgba(0,0,0,0.055)',
        fontSize: 10,
        fontWeight: 800,
        textTransform: 'uppercase',
      }}
    >
      {status || 'kept'}
    </Box>
  );
}

function NodeShell({ data, children, sx = {} }) {
  const c = nodeTone(data.graphType, data.subtype);
  return (
    <Box
      sx={{
        boxSizing: 'border-box',
        width: data.renderWidth || NODE_WIDTH,
        height: data.renderHeight || NODE_HEIGHT,
        px: 1.15,
        py: 0.9,
        borderRadius: 1,
        border: `1.5px solid ${c.border}`,
        backgroundColor: c.bg,
        boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
        color: c.title,
        transition: 'border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease',
        '&:hover': {
          boxShadow: '0 6px 18px rgba(15,23,42,0.12)',
        },
        ...sx,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      {children}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </Box>
  );
}

const RawScoreNode = memo(({ data }) => {
  const c = nodeTone('raw');
  return (
    <NodeShell data={data}>
      <Stack direction="row" justifyContent="space-between" spacing={1}>
        <Typography sx={{ color: c.title, fontWeight: 800, fontSize: 11.5, lineHeight: 1.2 }} noWrap>
          {data.label}
        </Typography>
        <Box
          component="span"
          sx={{
            px: 0.7,
            py: 0.15,
            borderRadius: 999,
            color: c.accent,
            backgroundColor: c.soft,
            fontSize: 10,
            fontWeight: 850,
          }}
        >
          RAW
        </Box>
      </Stack>
      <Typography sx={{ color: c.accent, fontWeight: 800, fontSize: 11.5, mt: 0.5 }}>
        {data.displayValue || '-'}
      </Typography>
      <Typography sx={{ color: 'rgba(17,24,39,0.58)', fontSize: 10, mt: 0.3, lineHeight: 1.25 }} noWrap>
        {data.details?.questionKey || data.details?.reason || data.details?.sourceAssignment || data.subtype}
      </Typography>
    </NodeShell>
  );
});

const LogicalPolicyNode = memo(({ data }) => {
  const c = nodeTone('logical', data.subtype);
  const upstreamExpandable = Number(data.expandableSourceCount) > 0;
  const upstreamExpanded = Boolean(data.isUpstreamExpanded);
  const detailExpandable = Boolean(data.hasInlineDetail);
  const detailExpanded = Boolean(data.isDetailExpanded);
  const detailRows = Array.isArray(data.detailRows) ? data.detailRows : [];
  const showInlineDetail = Boolean(detailExpandable && detailExpanded && detailRows.length > 0);
  const showResultFooter = !RAW_PROCESSING_SUBTYPES.has(data.subtype);
  const DetailIcon = detailExpanded ? KeyboardArrowDownIcon : KeyboardArrowRightIcon;

  const handleClick = (event) => {
    event.stopPropagation();
    if (upstreamExpandable) data.onToggleUpstream?.(data.id);
  };

  const handleDetailClick = (event) => {
    event.stopPropagation();
    data.onToggleDetail?.(data.id);
  };

  return (
    <Tooltip
      title={upstreamExpandable ? `${upstreamExpanded ? 'Hide' : 'Show'} ${data.expandableSourceCount} upstream nodes` : 'No upstream nodes'}
      placement="top"
    >
      <Box className="nodrag nopan" onClick={handleClick} sx={{ cursor: upstreamExpandable ? 'pointer' : 'default' }}>
        <NodeShell
          data={data}
          sx={{
            borderWidth: upstreamExpanded ? 2 : 1.5,
            background: detailExpanded ? `linear-gradient(180deg, ${c.soft}, #ffffff)` : '#ffffff',
            overflow: 'hidden',
          }}
        >
          <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
            <Typography sx={{ color: c.accent, fontWeight: 900, fontSize: 12, lineHeight: 1.1 }} noWrap>
              {String(data.subtype || 'logic').toUpperCase()}
            </Typography>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography sx={{ color: c.accent, fontWeight: 800, fontSize: 10 }}>
                {data.details?.quality === 'estimated' ? 'EST' : 'POLICY'}
              </Typography>
              {detailExpandable && (
                <Box
                  component="button"
                  type="button"
                  onClick={handleDetailClick}
                  title={detailExpanded ? 'Hide policy result list' : 'Show policy result list'}
                  sx={{
                    width: 19,
                    height: 19,
                    p: 0,
                    borderRadius: 0.75,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px solid ${c.border}`,
                    backgroundColor: detailExpanded ? c.border : '#ffffff',
                    color: detailExpanded ? '#ffffff' : c.accent,
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                >
                  <DetailIcon sx={{ fontSize: 16 }} />
                </Box>
              )}
            </Stack>
          </Stack>
          <Typography sx={{ color: c.title, fontWeight: 750, fontSize: 11, mt: 0.55 }} noWrap>
            {data.label}
          </Typography>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mt: 0.45 }}>
            <Typography sx={{ color: c.accent, fontWeight: 850, fontSize: 11.5 }} noWrap>
              Policy: {policyText(data)}
            </Typography>
            {upstreamExpandable && (
              <Typography sx={{ color: 'rgba(17,24,39,0.52)', fontSize: 10, fontWeight: 700 }} noWrap>
                {upstreamExpanded ? `${data.expandableSourceCount} upstream` : 'upstream hidden'}
              </Typography>
            )}
          </Stack>
          {showInlineDetail && (
            <Box sx={{ mt: 0.8, pt: 0.65, borderTop: '1px solid rgba(17,24,39,0.12)' }}>
              {detailRows.map((row, index) => {
                const dropped = row.status === 'dropped' || row.status === 'ignored' || row.status === 'missing';
                const statusText = row.status === 'dropped'
                  ? 'drop'
                  : (row.status === 'ignored' ? 'skip' : (row.status === 'missing' ? 'miss' : 'keep'));
                return (
                  <Stack
                    key={row.id || `${row.label}-${index}`}
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    spacing={1}
                    sx={{
                      minHeight: DETAIL_ROW_HEIGHT,
                      px: 0.55,
                      borderRadius: 0.6,
                      backgroundColor: index % 2 === 0 ? 'rgba(255,255,255,0.54)' : 'rgba(17,24,39,0.035)',
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: dropped ? 'rgba(17,24,39,0.45)' : '#111827' }} noWrap>
                        {row.label}
                      </Typography>
                      <Typography sx={{ fontSize: 9.5, color: dropped ? 'rgba(17,24,39,0.38)' : 'rgba(17,24,39,0.58)' }} noWrap>
                        {row.displayValue}
                      </Typography>
                    </Box>
                    <Typography
                      sx={{
                        flexShrink: 0,
                        fontSize: 10.5,
                        fontWeight: 900,
                        color: dropped ? '#c2410c' : '#15803d',
                        textTransform: 'uppercase',
                      }}
                    >
                      {statusText}
                    </Typography>
                  </Stack>
                );
              })}
            </Box>
          )}
          {showResultFooter && (
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={1}
              sx={{
                mt: 0.75,
                pt: 0.55,
                borderTop: '1px solid rgba(17,24,39,0.12)',
              }}
            >
              <Typography sx={{ color: 'rgba(17,24,39,0.54)', fontSize: 10, fontWeight: 800 }}>
                Result
              </Typography>
              <Typography sx={{ color: c.accent, fontWeight: 900, fontSize: 11.5 }} noWrap>
                {formatNodeResult(data)}
              </Typography>
            </Stack>
          )}
        </NodeShell>
      </Box>
    </Tooltip>
  );
});

const CategoryOutputNode = memo(({ data }) => {
  const c = nodeTone('category_output');
  const pct = Number(data.details?.percentage) || 0;
  const upstreamExpandable = Number(data.expandableSourceCount) > 0;
  const upstreamExpanded = Boolean(data.isUpstreamExpanded);
  const handleClick = (event) => {
    event.stopPropagation();
    if (upstreamExpandable) data.onToggleUpstream?.(data.id);
  };
  return (
    <Tooltip
      title={upstreamExpandable ? `${upstreamExpanded ? 'Hide' : 'Show'} ${data.expandableSourceCount} upstream nodes` : ''}
      placement="top"
    >
      <Box className="nodrag nopan" onClick={handleClick} sx={{ cursor: upstreamExpandable ? 'pointer' : 'default' }}>
        <NodeShell data={data} sx={{ borderWidth: upstreamExpanded ? 2 : 1.5 }}>
          <Typography sx={{ color: c.title, fontWeight: 900, fontSize: 13 }} noWrap>
            {data.label}
          </Typography>
          <Typography sx={{ color: c.accent, fontWeight: 900, fontSize: 16, mt: 0.65 }}>
            {data.displayValue}
          </Typography>
          <Box sx={{ mt: 0.9, height: 5, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.1)', overflow: 'hidden' }}>
            <Box sx={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', backgroundColor: c.accent }} />
          </Box>
        </NodeShell>
      </Box>
    </Tooltip>
  );
});

const FinalOutputNode = memo(({ data }) => {
  const c = nodeTone('final_output');
  const pct = Number(data.details?.percentage) || 0;
  const upstreamExpandable = Number(data.expandableSourceCount) > 0;
  const upstreamExpanded = Boolean(data.isUpstreamExpanded);
  const handleClick = (event) => {
    event.stopPropagation();
    if (upstreamExpandable) data.onToggleUpstream?.(data.id);
  };
  return (
    <Tooltip
      title={upstreamExpandable ? `${upstreamExpanded ? 'Hide' : 'Show'} ${data.expandableSourceCount} upstream nodes` : ''}
      placement="top"
    >
      <Box className="nodrag nopan" onClick={handleClick} sx={{ cursor: upstreamExpandable ? 'pointer' : 'default' }}>
        <NodeShell data={data} sx={{ borderWidth: 2 }}>
          <Typography sx={{ color: c.title, fontWeight: 900, fontSize: 13 }} noWrap>
            FINAL OUTPUT
          </Typography>
          <Typography sx={{ color: c.accent, fontWeight: 900, fontSize: 18, mt: 0.65 }}>
            {data.displayValue}
          </Typography>
          <Typography sx={{ color: 'rgba(17,24,39,0.58)', fontSize: 10.5, mt: 0.35 }}>
            {pct.toFixed(2)}% · rounded for grade bins
          </Typography>
        </NodeShell>
      </Box>
    </Tooltip>
  );
});

const nodeTypes = {
  raw: RawScoreNode,
  logical: LogicalPolicyNode,
  category_output: CategoryOutputNode,
  final_output: FinalOutputNode,
};

function buildGraphIndexes(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map();
  const outgoingBySource = new Map();

  edges.forEach((edge) => {
    if (!incomingByTarget.has(edge.target)) incomingByTarget.set(edge.target, []);
    if (!outgoingBySource.has(edge.source)) outgoingBySource.set(edge.source, []);
    incomingByTarget.get(edge.target).push(edge);
    outgoingBySource.get(edge.source).push(edge);
  });

  return { nodeById, incomingByTarget, outgoingBySource };
}

function buildUpstreamNodeCollector(nodes, edges) {
  const { nodeById, incomingByTarget } = buildGraphIndexes(nodes, edges);
  const memo = new Map();

  const collect = (nodeId, visiting = new Set()) => {
    if (memo.has(nodeId)) return memo.get(nodeId);
    if (visiting.has(nodeId)) return new Set();

    visiting.add(nodeId);
    const upstreamSet = new Set();
    (incomingByTarget.get(nodeId) || []).forEach((edge) => {
      if (!nodeById.has(edge.source)) return;
      upstreamSet.add(edge.source);
      collect(edge.source, visiting).forEach((upstreamId) => upstreamSet.add(upstreamId));
    });
    visiting.delete(nodeId);
    memo.set(nodeId, upstreamSet);
    return upstreamSet;
  };

  return collect;
}

function getUpstreamToggleNodeIds(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  if (nodes.length === 0) return [];

  const { incomingByTarget } = buildGraphIndexes(nodes, edges);
  return nodes
    .filter((node) => node.type !== 'raw' && (incomingByTarget.get(node.id) || []).length > 0)
    .map((node) => node.id);
}

function getInlineDetailNodeIds(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  if (nodes.length === 0) return [];

  const { nodeById, incomingByTarget } = buildGraphIndexes(nodes, edges);
  return nodes
    .filter((node) => {
      if (node.type !== 'logical' || !INLINE_DETAIL_SUBTYPES.has(node.subtype)) return false;
      const directInputs = (incomingByTarget.get(node.id) || [])
        .map((edge) => nodeById.get(edge.source))
        .filter(Boolean);
      return directInputs.length > 1 && directInputs.every((inputNode) => inputNode.type === 'raw');
    })
    .map((node) => node.id);
}

function buildVisibleGraph(graph, upstreamExpandedNodeIds, detailExpandedNodeIds, toggleUpstreamNode, toggleDetailNode) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const components = Array.isArray(graph?.components) ? graph.components : [];
  const collectUpstreamNodes = buildUpstreamNodeCollector(nodes, edges);
  const fullIndexes = buildGraphIndexes(nodes, edges);
  const expandableSourceCountByNode = new Map();
  const detailRowsByNode = new Map();
  const inlineDetailNodeIds = new Set();
  const upstreamToggleNodeIds = [];
  const hiddenNodeIds = new Set();

  const hideNodeAndUpstream = (targetSet, nodeId) => {
    targetSet.add(nodeId);
    collectUpstreamNodes(nodeId).forEach((upstreamNodeId) => targetSet.add(upstreamNodeId));
  };

  nodes.forEach((node) => {
    if (node.type === 'raw') return;
    const directInputIds = (fullIndexes.incomingByTarget.get(node.id) || []).map((edge) => edge.source);
    expandableSourceCountByNode.set(node.id, directInputIds.length);
    if (directInputIds.length > 0) {
      upstreamToggleNodeIds.push(node.id);
    }

    if (node.type !== 'logical') return;

    const directInputs = directInputIds
      .map((inputId) => fullIndexes.nodeById.get(inputId))
      .filter(Boolean);
    const hasInlineDetail = INLINE_DETAIL_SUBTYPES.has(node.subtype)
      && directInputs.length > 1
      && directInputs.every((inputNode) => inputNode.type === 'raw');

    if (hasInlineDetail) {
      inlineDetailNodeIds.add(node.id);
      detailRowsByNode.set(
        node.id,
        directInputs.map((inputNode) => ({
          id: inputNode.id,
          label: inputNode.label,
          displayValue: inputNode.displayValue || `${formatPoints(inputNode.score)} / ${formatPoints(inputNode.maxScore)}`,
          status: inputNode.status || 'kept',
        })),
      );
    }
  });

  nodes.forEach((node) => {
    if (node.type === 'raw') return;
    const directInputIds = (fullIndexes.incomingByTarget.get(node.id) || []).map((edge) => edge.source);
    if (directInputIds.length > 0 && !upstreamExpandedNodeIds.has(node.id)) {
      directInputIds.forEach((inputId) => hideNodeAndUpstream(hiddenNodeIds, inputId));
    }
  });

  const layoutNodes = nodes;
  const layoutIds = new Set(layoutNodes.map((node) => node.id));
  const layoutEdges = edges.filter((edge) => layoutIds.has(edge.source) && layoutIds.has(edge.target));
  const visibleNodes = layoutNodes.filter((node) => !hiddenNodeIds.has(node.id));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const edgeList = layoutEdges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const layoutNodeById = new Map(layoutNodes.map((node) => [node.id, node]));
  const layoutIndexes = buildGraphIndexes(layoutNodes, layoutEdges);

  const knownComponentIds = new Set(components.map((component) => component.id));
  const discoveredComponentIds = layoutNodes
    .map((node) => node.group)
    .filter((groupId) => groupId && groupId !== 'course' && !knownComponentIds.has(groupId));
  const componentOrder = [...components.map((component) => component.id), ...Array.from(new Set(discoveredComponentIds))];

  const byGroup = new Map();
  layoutNodes.forEach((node) => {
    const group = node.group || 'course';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(node);
  });

  const layoutHeightById = new Map();
  const renderHeightById = new Map();
  const renderWidthById = new Map();
  layoutNodes.forEach((node) => {
    const detailRows = detailRowsByNode.get(node.id) || [];
    const hasInlineDetail = inlineDetailNodeIds.has(node.id) && detailRows.length > 0;
    const hasResultFooter = node.type === 'logical' && !RAW_PROCESSING_SUBTYPES.has(node.subtype);
    const baseHeight = hasResultFooter ? RESULT_NODE_HEIGHT : NODE_HEIGHT;
    const detailHeight = baseHeight + detailRows.length * DETAIL_ROW_HEIGHT + 14;
    const showInlineDetail = hasInlineDetail && detailExpandedNodeIds.has(node.id);
    layoutHeightById.set(node.id, hasInlineDetail ? detailHeight : baseHeight);
    renderWidthById.set(node.id, showInlineDetail ? DETAIL_NODE_WIDTH : NODE_WIDTH);
    renderHeightById.set(node.id, showInlineDetail ? detailHeight : baseHeight);
  });
  const layoutHeight = (node) => layoutHeightById.get(node.id) || NODE_HEIGHT;

  const displayLayer = (node) => {
    if (node.type === 'raw') return 0;
    const numericLayer = Number(node.layer);
    return Math.max(1, Number.isFinite(numericLayer) ? numericLayer : 1);
  };
  const sortText = (value) => String(value || '').trim().toLowerCase();
  const rawAttemptRank = (node) => {
    const direct = Number(node.details?.attemptNo);
    if (Number.isFinite(direct)) return direct;
    const sourceText = `${node.details?.assignmentTitle || ''} ${node.label || ''}`;
    const questMatch = sourceText.match(/quest\s*[-:]?\s*(\d+)/i);
    if (questMatch) return Number(questMatch[1]);
    return 9999;
  };
  const firstTargetKey = (node) => {
    const targets = (fullIndexes.outgoingBySource.get(node.id) || [])
      .map((edge) => fullIndexes.nodeById.get(edge.target))
      .filter(Boolean)
      .map((target) => sortText(target.details?.questionKey || target.label || target.id));
    return targets[0] || sortText(node.details?.questionKey || node.label);
  };
  const baseNodeCompare = (a, b) => {
    if (a.type === 'raw' && b.type === 'raw') {
      const targetDelta = firstTargetKey(a).localeCompare(firstTargetKey(b));
      if (targetDelta !== 0) return targetDelta;
      const questionDelta = sortText(a.details?.questionKey || a.details?.sourceAssignment || a.label)
        .localeCompare(sortText(b.details?.questionKey || b.details?.sourceAssignment || b.label));
      if (questionDelta !== 0) return questionDelta;
      const attemptDelta = rawAttemptRank(a) - rawAttemptRank(b);
      if (attemptDelta !== 0) return attemptDelta;
    }
    const typeRank = { raw: 0, logical: 1, category_output: 2, final_output: 3 };
    const rankDelta = (typeRank[a.type] ?? 9) - (typeRank[b.type] ?? 9);
    if (rankDelta !== 0) return rankDelta;
    const labelDelta = sortText(a.label).localeCompare(sortText(b.label));
    if (labelDelta !== 0) return labelDelta;
    return String(a.id).localeCompare(String(b.id));
  };

  const buildLayerOrders = (groupNodes) => {
    const layers = new Map();
    groupNodes.forEach((node) => {
      const layer = displayLayer(node);
      if (!layers.has(layer)) layers.set(layer, []);
      layers.get(layer).push(node);
    });

    const layerValues = Array.from(layers.keys()).sort((a, b) => a - b);
    layers.forEach((layerNodes) => layerNodes.sort(baseNodeCompare));

    const orderById = new Map();
    const refreshOrderMap = () => {
      orderById.clear();
      layerValues.forEach((layer) => {
        (layers.get(layer) || []).forEach((node, index) => {
          orderById.set(node.id, index);
        });
      });
    };

    const neighborAverage = (node, direction) => {
      const relevantEdges = direction === 'incoming'
        ? (layoutIndexes.incomingByTarget.get(node.id) || [])
        : (layoutIndexes.outgoingBySource.get(node.id) || []);
      const orders = relevantEdges
        .map((edge) => (direction === 'incoming' ? edge.source : edge.target))
        .map((neighborId) => layoutNodeById.get(neighborId))
        .filter((neighbor) => neighbor && neighbor.group === node.group && orderById.has(neighbor.id))
        .map((neighbor) => orderById.get(neighbor.id));
      if (orders.length === 0) return null;
      return orders.reduce((sum, value) => sum + value, 0) / orders.length;
    };

    const sortLayerByNeighbors = (layer, direction) => {
      const layerNodes = layers.get(layer) || [];
      if (layerNodes.length < 2) return;
      layerNodes.sort((a, b) => {
        const aAverage = neighborAverage(a, direction);
        const bAverage = neighborAverage(b, direction);
        if (aAverage != null && bAverage != null && Math.abs(aAverage - bAverage) > 0.001) {
          return aAverage - bAverage;
        }
        if (aAverage != null && bAverage == null) return -1;
        if (aAverage == null && bAverage != null) return 1;
        return baseNodeCompare(a, b);
      });
    };

    refreshOrderMap();
    for (let pass = 0; pass < 5; pass += 1) {
      layerValues.forEach((layer, index) => {
        if (index > 0) sortLayerByNeighbors(layer, 'incoming');
      });
      refreshOrderMap();
      [...layerValues].reverse().forEach((layer, index) => {
        if (index > 0) sortLayerByNeighbors(layer, 'outgoing');
      });
      refreshOrderMap();
    }

    return { layers, layerValues };
  };

  const positions = new Map();
  let yCursor = 28;
  let maxComponentX = 28;
  componentOrder.forEach((groupId) => {
    const groupNodes = byGroup.get(groupId) || [];
    if (groupNodes.length === 0) return;
    const { layers, layerValues } = buildLayerOrders(groupNodes);

    layerValues.forEach((layer) => {
      (layers.get(layer) || []).forEach((node, index) => {
        const x = 28 + layer * LAYER_GAP;
        positions.set(node.id, {
          x,
          y: yCursor + index * ROW_GAP,
        });
        maxComponentX = Math.max(maxComponentX, x);
      });
    });

    const spreadColumn = (layer) => {
      const layerNodes = [...(layers.get(layer) || [])]
        .sort((a, b) => (positions.get(a.id)?.y || 0) - (positions.get(b.id)?.y || 0));
      let nextY = yCursor;
      layerNodes.forEach((node) => {
        const position = positions.get(node.id);
        if (!position) return;
        if (position.y < nextY) position.y = nextY;
        nextY = position.y + layoutHeight(node) + 10;
      });
    };

    layerValues.forEach((layer, index) => {
      if (index === 0) {
        spreadColumn(layer);
        return;
      }

      (layers.get(layer) || []).forEach((node) => {
        const inputCenters = (layoutIndexes.incomingByTarget.get(node.id) || [])
          .map((edge) => layoutNodeById.get(edge.source))
          .filter((sourceNode) => sourceNode && sourceNode.group === node.group && positions.has(sourceNode.id))
          .map((sourceNode) => {
            const sourcePosition = positions.get(sourceNode.id);
            return sourcePosition.y + layoutHeight(sourceNode) / 2;
          });
        if (inputCenters.length === 0) return;
        const averageCenter = inputCenters.reduce((sum, value) => sum + value, 0) / inputCenters.length;
        const position = positions.get(node.id);
        if (position) position.y = averageCenter - layoutHeight(node) / 2;
      });
      spreadColumn(layer);
    });

    const groupBottom = groupNodes.reduce((bottom, node) => {
      const position = positions.get(node.id);
      return position ? Math.max(bottom, position.y + layoutHeight(node)) : bottom;
    }, yCursor + 128);
    yCursor = groupBottom + GROUP_GAP;
  });

  const courseNodes = byGroup.get('course') || [];
  courseNodes.forEach((node) => {
    const inputCenters = (layoutIndexes.incomingByTarget.get(node.id) || [])
      .map((edge) => {
        const sourceNode = layoutNodeById.get(edge.source);
        const position = positions.get(edge.source);
        return sourceNode && position ? position.y + layoutHeight(sourceNode) / 2 : null;
      })
      .filter((value) => value != null);
    const defaultY = Math.max(140, yCursor / 2 - NODE_HEIGHT);
    const centeredY = inputCenters.length > 0
      ? inputCenters.reduce((sum, value) => sum + value, 0) / inputCenters.length - layoutHeight(node) / 2
      : defaultY;
    positions.set(node.id, {
      x: maxComponentX + LAYER_GAP,
      y: Math.max(28, centeredY),
    });
  });

  const flowNodes = visibleNodes.map((node) => {
    const expandableSourceCount = expandableSourceCountByNode.get(node.id) || 0;
    const detailRows = detailRowsByNode.get(node.id) || [];
    const showInlineDetail = inlineDetailNodeIds.has(node.id);
    return {
      id: node.id,
      type: node.type,
      position: positions.get(node.id) || { x: 28, y: 28 },
      data: {
        ...node,
        graphType: node.type,
        expandableSourceCount,
        isUpstreamExpanded: upstreamExpandedNodeIds.has(node.id),
        isDetailExpanded: detailExpandedNodeIds.has(node.id),
        hasInlineDetail: showInlineDetail,
        detailRows,
        renderHeight: renderHeightById.get(node.id) || NODE_HEIGHT,
        renderWidth: renderWidthById.get(node.id) || NODE_WIDTH,
        onToggleUpstream: toggleUpstreamNode,
        onToggleDetail: toggleDetailNode,
      },
      draggable: false,
    };
  });

  const flowEdges = edgeList.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'simplebezier',
    animated: edge.kind === 'clobber',
    label: edge.kind === 'clobber' ? edge.label || undefined : undefined,
    markerEnd: { type: MarkerType.ArrowClosed, color: edge.kind === 'clobber' ? '#dc2626' : 'rgba(17,24,39,0.34)' },
    interactionWidth: 12,
    style: {
      stroke: edge.kind === 'clobber' ? '#dc2626' : (edge.active === false ? 'rgba(17,24,39,0.1)' : 'rgba(17,24,39,0.24)'),
      strokeWidth: edge.kind === 'clobber' ? 1.9 : 1.25,
      strokeDasharray: edge.active === false ? '5 5' : undefined,
    },
    labelStyle: { fill: '#111827', fontWeight: 700, fontSize: 10 },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
  }));

  return {
    flowNodes,
    flowEdges,
    visibleRawCount: visibleNodes.filter((node) => node.type === 'raw').length,
    upstreamToggleNodeIds,
  };
}

function FlowCanvas({
  nodes,
  edges,
  fitKey,
  total,
  visibleRawCount,
  upstreamExpandedCount,
  detailExpandedCount,
}) {
  const reactFlow = useReactFlow();
  const lastViewportKey = useRef(null);

  useEffect(() => {
    if (!fitKey || lastViewportKey.current === fitKey) return undefined;
    lastViewportKey.current = fitKey;
    const frame = requestAnimationFrame(() => {
      reactFlow.setViewport({ x: 22, y: 22, zoom: 0.78 }, { duration: 180 });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitKey, reactFlow]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      defaultViewport={{ x: 22, y: 22, zoom: 0.78 }}
      minZoom={0.45}
      maxZoom={1.25}
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      panOnScroll
      panOnScrollMode={PanOnScrollMode.Vertical}
      panOnScrollSpeed={0.9}
      panOnDrag
      preventScrolling
      style={{ background: '#f8fafc' }}
    >
      <Background color="rgba(17,24,39,0.16)" gap={24} size={1} />
      <Controls position="bottom-left" showZoom={false} showInteractive={false} />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable={false}
        nodeColor={(node) => nodeTone(node.data?.graphType, node.data?.subtype).border}
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid rgba(0,0,0,0.18)',
          borderRadius: 6,
        }}
      />
      <Panel position="top-left">
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{
            px: 1.15,
            py: 0.9,
            borderRadius: 1,
            backgroundColor: 'rgba(255,255,255,0.92)',
            border: '1px solid rgba(0,0,0,0.18)',
            boxShadow: '0 6px 20px rgba(15,23,42,0.08)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <Stack direction="row" spacing={0.8} alignItems="center">
            <AccountTreeIcon sx={{ color: '#111111', fontSize: 19 }} />
            <Box>
              <Typography sx={{ color: '#111111', fontSize: 13, fontWeight: 850, lineHeight: 1.1 }}>
                Grade Flow
              </Typography>
              <Typography sx={{ color: 'rgba(17,17,17,0.58)', fontSize: 11 }}>
                Click a card to show/hide upstream nodes; use list buttons for filter/drop details
              </Typography>
            </Box>
          </Stack>
          <Chip size="small" label={total.displayValue || `${formatPoints(total.score)} / ${formatPoints(total.cap)}`} />
          <Chip size="small" label={`${nodes.length} nodes`} />
          <Chip size="small" label={`${visibleRawCount} raw shown`} />
          <Chip size="small" label={`${upstreamExpandedCount} upstream open`} />
          <Chip size="small" label={`${detailExpandedCount} detail open`} />
        </Stack>
      </Panel>
    </ReactFlow>
  );
}

export default function GradeDataFlow({ studentData }) {
  const graph = studentData?.gradeFlow;
  const defaultUpstreamExpandedNodeIds = useMemo(
    () => new Set(getUpstreamToggleNodeIds(graph)),
    [graph],
  );
  const defaultDetailExpandedNodeIds = useMemo(
    () => new Set(getInlineDetailNodeIds(graph)),
    [graph],
  );
  const [upstreamExpandedNodeIds, setUpstreamExpandedNodeIds] = useState(defaultUpstreamExpandedNodeIds);
  const [detailExpandedNodeIds, setDetailExpandedNodeIds] = useState(defaultDetailExpandedNodeIds);

  useEffect(() => {
    setUpstreamExpandedNodeIds(defaultUpstreamExpandedNodeIds);
  }, [defaultUpstreamExpandedNodeIds]);

  useEffect(() => {
    setDetailExpandedNodeIds(defaultDetailExpandedNodeIds);
  }, [defaultDetailExpandedNodeIds]);

  const toggleUpstreamNode = useCallback((nodeId) => {
    setUpstreamExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const toggleDetailNode = useCallback((nodeId) => {
    setDetailExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const {
    flowNodes,
    flowEdges,
    visibleRawCount,
    upstreamToggleNodeIds,
  } = useMemo(
    () => buildVisibleGraph(graph, upstreamExpandedNodeIds, detailExpandedNodeIds, toggleUpstreamNode, toggleDetailNode),
    [graph, upstreamExpandedNodeIds, detailExpandedNodeIds, toggleUpstreamNode, toggleDetailNode],
  );

  if (!graph) {
    return (
      <Box sx={{ p: 3, border: '1px solid #e5e7eb', borderRadius: 2, backgroundColor: '#fff' }}>
        <Typography sx={{ color: '#6b7280' }}>Grade flow graph is not available yet.</Typography>
      </Box>
    );
  }

  const total = graph.total || {};
  const components = Array.isArray(graph.components) ? graph.components : [];
  const fitKey = `${graph.student?.email || studentData?.email || 'student'}:${graph.course?.id || 'course'}:${components.length}`;

  return (
    <Box
      sx={{
        height: '100%',
        minHeight: { xs: 620, md: 680 },
        borderRadius: 1,
        overflow: 'hidden',
        border: '1px solid rgba(0,0,0,0.18)',
        backgroundColor: '#f8fafc',
      }}
    >
      <ReactFlowProvider>
        <FlowCanvas
          nodes={flowNodes}
          edges={flowEdges}
          fitKey={fitKey}
          total={total}
          visibleRawCount={visibleRawCount}
          upstreamExpandedCount={upstreamToggleNodeIds.filter((nodeId) => upstreamExpandedNodeIds.has(nodeId)).length}
          detailExpandedCount={defaultDetailExpandedNodeIds.size
            ? Array.from(defaultDetailExpandedNodeIds).filter((nodeId) => detailExpandedNodeIds.has(nodeId)).length
            : 0}
        />
      </ReactFlowProvider>
    </Box>
  );
}
