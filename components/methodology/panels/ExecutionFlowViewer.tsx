'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { X, Loader2, Play, CircleCheck, Bot, Users, User, Globe, FileInput, Calculator, AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react';

interface NodeRunData {
  nodeId: string;
  status: string;
  input?: any;
  output?: any;
  errorMessage?: string;
  duration?: number;
}

interface Props {
  engagementId: string;
  executionId: string;
  testDescription: string;
  onClose: () => void;
}

// ─── Status colours ───
const STATUS_BORDER: Record<string, string> = {
  completed: '#22c55e',
  failed: '#ef4444',
  running: '#3b82f6',
  paused: '#f59e0b',
  pending: '#d1d5db',
  skipped: '#9ca3af',
};

const STATUS_BG: Record<string, string> = {
  completed: '#f0fdf4',
  failed: '#fef2f2',
  running: '#eff6ff',
  paused: '#fffbeb',
  pending: '#f9fafb',
  skipped: '#f3f4f6',
};

const STATUS_SHADOW: Record<string, string> = {
  completed: '0 0 0 3px #bbf7d0',
  failed: '0 0 0 3px #fecaca',
  running: '0 0 0 3px #bfdbfe',
  paused: '0 0 0 3px #fef3c7',
};

// ─── Assignee config ───
const ASSIGNEE_COLORS: Record<string, { bg: string; border: string; text: string; light: string }> = {
  ai:     { bg: '#f3e8ff', border: '#a855f7', text: '#7e22ce', light: '#faf5ff' },
  client: { bg: '#dbeafe', border: '#3b82f6', text: '#1d4ed8', light: '#eff6ff' },
  team:   { bg: '#dcfce7', border: '#22c55e', text: '#15803d', light: '#f0fdf4' },
};
const ASSIGNEE_LABELS: Record<string, string> = { ai: 'AI', client: 'Client', team: 'Team' };
const ASSIGNEE_ICONS: Record<string, typeof Bot> = { ai: Bot, client: Users, team: User };

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
  if (status === 'paused') return <Clock className="h-3.5 w-3.5 text-orange-500" />;
  return <div className="w-2.5 h-2.5 rounded-full border-2 border-slate-300" />;
}

function OutputBadge({ output }: { output: any }) {
  if (!output) return null;
  const result = output.result || output.decision;
  if (!result) return null;
  const isPass = result === 'pass' || result === 'yes' || result === 'true';
  const isFail = result === 'fail' || result === 'no' || result === 'false';
  return (
    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${
      isPass ? 'bg-green-200 text-green-800' : isFail ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'
    }`}>{String(result)}</span>
  );
}

function DataPanel({ label, data }: { label: string; data: any }) {
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return null;
  const entries = typeof data === 'object' ? Object.entries(data).filter(([k]) => k !== 'result' && k !== 'decision') : [];
  if (entries.length === 0 && typeof data !== 'string') return null;
  return (
    <div className="mt-1 bg-white/80 rounded border border-slate-200 px-2 py-1">
      <div className="text-[7px] font-bold text-slate-400 uppercase">{label}</div>
      {typeof data === 'string' ? (
        <div className="text-[9px] text-slate-600 break-words">{data.slice(0, 120)}{data.length > 120 ? '...' : ''}</div>
      ) : (
        entries.slice(0, 4).map(([k, v]) => (
          <div key={k} className="text-[9px] text-slate-600 truncate"><span className="font-medium text-slate-500">{k}:</span> {String(v).slice(0, 80)}</div>
        ))
      )}
    </div>
  );
}

// ─── Execution-aware node components ───

function ExecActionNode({ data }: NodeProps) {
  const d = data as any;
  const status = d._execStatus || 'pending';
  const assignee = d.assignee || 'team';
  const colors = ASSIGNEE_COLORS[assignee] || ASSIGNEE_COLORS.team;
  const AssigneeIcon = ASSIGNEE_ICONS[assignee] || User;

  return (
    <div className="rounded-lg shadow-md border-2 min-w-[220px] max-w-[300px] relative"
      style={{ background: STATUS_BG[status] || colors.light, borderColor: STATUS_BORDER[status] || colors.border, boxShadow: STATUS_SHADOW[status] }}>
      {/* Status indicator */}
      <div className="absolute -top-2.5 -right-2.5 z-10"><StatusIcon status={status} /></div>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-slate-400 !border-slate-300" />
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: colors.bg, color: colors.text }}>
            <AssigneeIcon className="h-2.5 w-2.5" />{ASSIGNEE_LABELS[assignee]}
          </span>
          <OutputBadge output={d._execOutput} />
          {d._execDuration && <span className="text-[8px] text-slate-400">{(d._execDuration / 1000).toFixed(1)}s</span>}
        </div>
        <div className="text-sm font-semibold text-slate-800 leading-tight">{d.label}</div>
        {d._execError && <div className="text-[9px] text-red-600 font-medium mt-1 break-words">{d._execError}</div>}
        <DataPanel label="Output" data={d._execOutput} />
        <DataPanel label="Input" data={d._execInput} />
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-slate-400 !border-slate-300" />
    </div>
  );
}

function ExecDecisionNode({ data }: NodeProps) {
  const d = data as any;
  const status = d._execStatus || 'pending';
  const strokeColor = STATUS_BORDER[status] || '#f59e0b';

  return (
    <div className="relative flex items-center justify-center" style={{ width: 200, height: 130 }}>
      <div className="absolute -top-2.5 -right-2.5 z-10"><StatusIcon status={status} /></div>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-amber-500 !border-amber-400" style={{ top: -6 }} />
      <svg width="200" height="130" viewBox="0 0 200 130" className="absolute inset-0">
        <polygon points="100,4 196,65 100,126 4,65" fill={STATUS_BG[status] || '#fffbeb'} stroke={strokeColor} strokeWidth={2.5} />
      </svg>
      <div className="relative z-10 text-center px-10">
        <div className="text-xs font-bold text-amber-800 leading-tight">{d.label || 'Check'}</div>
        <OutputBadge output={d._execOutput} />
        {d._execError && <div className="text-[8px] text-red-600 mt-0.5">{d._execError}</div>}
      </div>
      <Handle type="source" position={Position.Bottom} id="yes" className="!w-3 !h-3 !bg-green-500 !border-green-400" style={{ left: '30%', bottom: -6 }} />
      <Handle type="source" position={Position.Bottom} id="no" className="!w-3 !h-3 !bg-red-500 !border-red-400" style={{ left: '70%', bottom: -6 }} />
      <span className="absolute text-[9px] font-bold text-green-600" style={{ left: '18%', bottom: -18 }}>Yes</span>
      <span className="absolute text-[9px] font-bold text-red-600" style={{ left: '62%', bottom: -18 }}>No</span>
    </div>
  );
}

function ExecStartNode({ data }: NodeProps) {
  const status = (data as any)._execStatus || 'pending';
  return (
    <div className="rounded-full border-2 px-5 py-2.5 shadow-sm" style={{ background: STATUS_BG[status] || '#dcfce7', borderColor: STATUS_BORDER[status] || '#22c55e' }}>
      <div className="flex items-center gap-1.5">
        <Play className="h-3.5 w-3.5 text-green-600 fill-green-600" />
        <span className="text-sm font-semibold text-green-700">Start Test</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-green-500 !border-green-400" />
    </div>
  );
}

function ExecEndNode({ data }: NodeProps) {
  const d = data as any;
  const status = d._execStatus || 'pending';
  return (
    <div className="rounded-full border-2 px-5 py-2.5 shadow-sm" style={{ background: STATUS_BG[status] || '#f1f5f9', borderColor: STATUS_BORDER[status] || '#64748b' }}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-slate-400 !border-slate-300" />
      <div className="flex items-center gap-1.5">
        <CircleCheck className="h-3.5 w-3.5 text-slate-600" />
        <span className="text-sm font-semibold text-slate-700">{d.label || 'Complete'}</span>
      </div>
    </div>
  );
}

function ExecForEachNode({ data }: NodeProps) {
  const d = data as any;
  const status = d._execStatus || 'pending';
  return (
    <div className="rounded-lg shadow-md border-2 min-w-[220px] max-w-[280px] relative" style={{ background: STATUS_BG[status] || '#f0fdfa', borderColor: STATUS_BORDER[status] || '#14b8a6', boxShadow: STATUS_SHADOW[status] }}>
      <div className="absolute -top-2.5 -right-2.5 z-10"><StatusIcon status={status} /></div>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-teal-400 !border-teal-300" />
      <div className="px-3 py-2">
        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">For Each</span>
        <div className="text-sm font-semibold text-slate-800 leading-tight mt-1">{d.label || 'For Each Item'}</div>
        {d.collection && <div className="text-[11px] text-teal-600 mt-0.5">over: {d.collection}</div>}
        <DataPanel label="Output" data={d._execOutput} />
      </div>
      <Handle type="source" position={Position.Left} id="body" className="!w-4 !h-4 !bg-teal-500 !border-teal-400" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Bottom} id="done" className="!w-4 !h-4 !bg-slate-500 !border-slate-400" />
      <span className="absolute text-[9px] font-bold text-teal-600" style={{ left: -30, top: '45%' }}>Each</span>
      <span className="absolute text-[9px] font-bold text-slate-500" style={{ left: '38%', bottom: -16 }}>Done</span>
    </div>
  );
}

function ExecLoopUntilNode({ data }: NodeProps) {
  const d = data as any;
  const status = d._execStatus || 'pending';
  return (
    <div className="rounded-lg shadow-md border-2 min-w-[220px] max-w-[280px] relative" style={{ background: STATUS_BG[status] || '#fefce8', borderColor: STATUS_BORDER[status] || '#eab308', boxShadow: STATUS_SHADOW[status] }}>
      <div className="absolute -top-2.5 -right-2.5 z-10"><StatusIcon status={status} /></div>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-yellow-400 !border-yellow-300" />
      <div className="px-3 py-2">
        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">Loop Until</span>
        <div className="text-sm font-semibold text-slate-800 leading-tight mt-1">{d.label || 'Repeat Until'}</div>
        {d.condition && <div className="text-[11px] text-yellow-700 mt-0.5">until: {d.condition}</div>}
        <DataPanel label="Output" data={d._execOutput} />
      </div>
      <Handle type="source" position={Position.Left} id="repeat" className="!w-4 !h-4 !bg-yellow-500 !border-yellow-400" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Bottom} id="done" className="!w-4 !h-4 !bg-slate-500 !border-slate-400" />
      <span className="absolute text-[9px] font-bold text-yellow-600" style={{ left: -38, top: '45%' }}>Repeat</span>
      <span className="absolute text-[9px] font-bold text-slate-500" style={{ left: '38%', bottom: -16 }}>Done</span>
    </div>
  );
}

function ExecWaitNode({ data }: NodeProps) {
  const d = data as any;
  const status = d._execStatus || 'pending';
  return (
    <div className="rounded-lg shadow-md border-2 min-w-[220px] max-w-[280px] relative" style={{ background: STATUS_BG[status] || '#fdf4ff', borderColor: STATUS_BORDER[status] || '#c084fc', boxShadow: STATUS_SHADOW[status] }}>
      <div className="absolute -top-2.5 -right-2.5 z-10"><StatusIcon status={status} /></div>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-purple-400 !border-purple-300" />
      <div className="px-3 py-2">
        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">Wait</span>
        <div className="text-sm font-semibold text-slate-800 leading-tight mt-1">{d.label || 'Wait for Event'}</div>
        {d.waitFor && <div className="text-[11px] text-purple-600 mt-0.5">{d.waitFor}</div>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-purple-400 !border-purple-300" />
    </div>
  );
}

function ExecSubFlowNode({ data }: NodeProps) {
  const d = data as any;
  const status = d._execStatus || 'pending';
  return (
    <div className="rounded-lg shadow-md border-2 min-w-[220px] max-w-[280px] relative" style={{ background: STATUS_BG[status] || '#eef2ff', borderColor: STATUS_BORDER[status] || '#6366f1', boxShadow: STATUS_SHADOW[status] }}>
      <div className="absolute -top-2.5 -right-2.5 z-10"><StatusIcon status={status} /></div>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-indigo-400 !border-indigo-300" />
      <div className="px-3 py-2">
        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">Sub-Flow</span>
        <div className="text-sm font-semibold text-slate-800 leading-tight mt-1">{d.label || 'Call Sub-Flow'}</div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-indigo-400 !border-indigo-300" />
    </div>
  );
}

const execNodeTypes: NodeTypes = {
  action: ExecActionNode,
  decision: ExecDecisionNode,
  start: ExecStartNode,
  end: ExecEndNode,
  forEach: ExecForEachNode,
  loopUntil: ExecLoopUntilNode,
  wait: ExecWaitNode,
  subFlow: ExecSubFlowNode,
};

const defaultEdgeOptions = {
  type: 'smoothstep' as const,
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  style: { strokeWidth: 2 },
};

// ─── Main component ───
export function ExecutionFlowViewer({ engagementId, executionId, testDescription, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flowSnapshot, setFlowSnapshot] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [nodeRuns, setNodeRuns] = useState<NodeRunData[]>([]);
  const [execStatus, setExecStatus] = useState('');
  const [execError, setExecError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/test-execution/${executionId}`);
        if (!res.ok) { setError('Failed to load execution'); return; }
        const data = await res.json();
        setFlowSnapshot(data.flowSnapshot || null);
        setNodeRuns(data.nodeRuns || []);
        setExecStatus(data.execution?.status || '');
        setExecError(data.execution?.errorMessage || null);
      } catch { setError('Failed to load'); }
      finally { setLoading(false); }
    }
    load();
  }, [engagementId, executionId]);

  // Merge execution data into flow nodes
  const enrichedNodes = useMemo(() => {
    if (!flowSnapshot?.nodes) return [];
    return flowSnapshot.nodes.map(node => {
      const run = nodeRuns.find(r => r.nodeId === node.id);
      return {
        ...node,
        data: {
          ...node.data,
          _execStatus: run?.status || (node.type === 'start' ? (execStatus === 'failed' && !run ? 'failed' : 'completed') : 'pending'),
          _execOutput: run?.output || null,
          _execInput: run?.input || null,
          _execError: run?.errorMessage || null,
          _execDuration: run?.duration || null,
        },
        draggable: false,
        selectable: false,
        connectable: false,
      };
    });
  }, [flowSnapshot, nodeRuns, execStatus]);

  // Color edges based on execution path
  const enrichedEdges = useMemo(() => {
    if (!flowSnapshot?.edges) return [];
    const completedNodeIds = new Set(nodeRuns.filter(r => r.status === 'completed').map(r => r.nodeId));
    const failedNodeIds = new Set(nodeRuns.filter(r => r.status === 'failed').map(r => r.nodeId));

    return flowSnapshot.edges.map(edge => {
      const sourceCompleted = completedNodeIds.has(edge.source);
      const targetFailed = failedNodeIds.has(edge.target);
      return {
        ...edge,
        ...defaultEdgeOptions,
        style: {
          ...defaultEdgeOptions.style,
          stroke: targetFailed ? '#ef4444' : sourceCompleted ? '#22c55e' : '#d1d5db',
          strokeWidth: sourceCompleted || targetFailed ? 3 : 2,
        },
        animated: sourceCompleted && !completedNodeIds.has(edge.target) && !failedNodeIds.has(edge.target),
      };
    });
  }, [flowSnapshot, nodeRuns]);

  if (loading) return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-white" />
    </div>
  );

  if (error || !flowSnapshot) return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 max-w-sm">
        <p className="text-sm text-red-600">{error || 'No flow data available for this execution.'}</p>
        <button onClick={onClose} className="mt-3 text-xs text-blue-600 hover:text-blue-800">Close</button>
      </div>
    </div>
  );

  const completedCount = nodeRuns.filter(r => r.status === 'completed').length;
  const failedCount = nodeRuns.filter(r => r.status === 'failed').length;
  const totalNodes = flowSnapshot.nodes.length;

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl w-[95vw] h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-800">{testDescription}</h3>
            <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full ${
              execStatus === 'completed' ? 'bg-green-100 text-green-700' :
              execStatus === 'failed' ? 'bg-red-100 text-red-700' :
              execStatus === 'running' ? 'bg-blue-100 text-blue-700' :
              execStatus === 'paused' ? 'bg-orange-100 text-orange-700' :
              'bg-slate-100 text-slate-500'
            }`}>{execStatus}</span>
            <span className="text-[10px] text-slate-400">
              {completedCount}/{totalNodes} completed
              {failedCount > 0 && <span className="text-red-500 ml-1">({failedCount} failed)</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {execError && (
              <div className="flex items-center gap-1 text-[10px] text-red-600 bg-red-50 px-2 py-1 rounded">
                <AlertTriangle className="h-3 w-3" />
                <span className="max-w-[300px] truncate">{execError}</span>
              </div>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded"><X className="h-5 w-5 text-slate-400" /></button>
          </div>
        </div>

        {/* Flow canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={enrichedNodes}
            edges={enrichedEdges}
            nodeTypes={execNodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnScroll
            zoomOnScroll
            minZoom={0.3}
            maxZoom={2}
          >
            <Controls showInteractive={false} />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e2e8f0" />
          </ReactFlow>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 px-4 py-2 border-t bg-slate-50 text-[9px] text-slate-500">
          <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-green-500" /> Completed</span>
          <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-red-500" /> Failed</span>
          <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-blue-500" /> Running</span>
          <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-amber-500" /> Paused</span>
          <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-slate-300" /> Pending</span>
        </div>
      </div>
    </div>
  );
}
