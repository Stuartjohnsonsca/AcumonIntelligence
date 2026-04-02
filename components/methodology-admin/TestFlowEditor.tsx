'use client';

import { useState, useCallback, useRef, useMemo, DragEvent } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
  type Connection,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { X, Save, Loader2, GripVertical, Diamond, Play, CircleCheck, Bot, Users, User, Globe, FileInput, Calculator } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Types ───
export interface TestAction {
  id: string;
  name: string;
  description: string;
  actionType: 'client' | 'ai' | 'human' | 'review';
  isReusable: boolean;
  executionDef?: any;
}

export interface FlowData {
  nodes: Node[];
  edges: Edge[];
}

interface Props {
  testDescription: string;
  initialFlow: FlowData | null;
  testActions: TestAction[];
  onSave: (flow: FlowData) => Promise<void>;
  onClose: () => void;
}

// ─── Assignee config ───
const ASSIGNEES = [
  { value: 'ai', label: 'AI', icon: Bot, color: 'bg-purple-100 text-purple-700 border-purple-300' },
  { value: 'client', label: 'Client', icon: Users, color: 'bg-blue-100 text-blue-700 border-blue-300' },
  { value: 'team', label: 'Team', icon: User, color: 'bg-green-100 text-green-700 border-green-300' },
] as const;

// ─── Colour helpers ───
const ASSIGNEE_COLORS: Record<string, { bg: string; border: string; text: string; light: string; accent: string }> = {
  ai:     { bg: '#f3e8ff', border: '#a855f7', text: '#7e22ce', light: '#faf5ff', accent: '#c084fc' },
  client: { bg: '#dbeafe', border: '#3b82f6', text: '#1d4ed8', light: '#eff6ff', accent: '#60a5fa' },
  team:   { bg: '#dcfce7', border: '#22c55e', text: '#15803d', light: '#f0fdf4', accent: '#4ade80' },
};

const ASSIGNEE_LABELS: Record<string, string> = { ai: 'AI', client: 'Client', team: 'Team' };

const ASSIGNEE_ICONS: Record<string, typeof Bot> = { ai: Bot, client: Users, team: User };

// ─── Input types for action nodes ───
const INPUT_TYPES = [
  { value: 'none', label: 'No input' },
  { value: 'portal_request', label: 'Portal Request (to Client)' },
  { value: 'portal_upload', label: 'Portal Upload (from Client)' },
  { value: 'file_upload', label: 'File Upload' },
  { value: 'data_entry', label: 'Data Entry' },
  { value: 'sample_calculator', label: 'Sample Calculator' },
  { value: 'tb_reference', label: 'Trial Balance Reference' },
  { value: 'evidence_match', label: 'Evidence Matching' },
  { value: 'ai_analysis', label: 'AI Analysis' },
];

// ─── Custom Node: Action ───
function ActionNode({ data, selected }: NodeProps) {
  const assignee = (data as any).assignee || 'team';
  const colors = ASSIGNEE_COLORS[assignee] || ASSIGNEE_COLORS.team;
  const AssigneeIcon = ASSIGNEE_ICONS[assignee] || User;
  const inputType = (data as any).inputType || 'none';
  const hasPortal = inputType === 'portal_request' || inputType === 'portal_upload';

  return (
    <div
      className="rounded-lg shadow-md border-2 min-w-[200px] max-w-[260px] transition-shadow"
      style={{
        background: colors.light,
        borderColor: selected ? '#2563eb' : colors.border,
        boxShadow: selected ? '0 0 0 2px #93c5fd' : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-slate-400 !border-slate-300" />
      <div className="px-3 py-2">
        {/* Top row: assignee badge + portal indicator */}
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
            style={{ background: colors.bg, color: colors.text }}
          >
            <AssigneeIcon className="h-2.5 w-2.5" />
            {ASSIGNEE_LABELS[assignee]}
          </span>
          {hasPortal && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">
              <Globe className="h-2.5 w-2.5" /> Portal
            </span>
          )}
          {inputType === 'sample_calculator' && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
              <Calculator className="h-2.5 w-2.5" /> Sample
            </span>
          )}
          {(inputType === 'file_upload' || inputType === 'data_entry') && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              <FileInput className="h-2.5 w-2.5" /> Input
            </span>
          )}
        </div>
        {/* Label */}
        <div className="text-sm font-semibold text-slate-800 leading-tight">{(data as any).label}</div>
        {/* Description */}
        {(data as any).description && (
          <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{(data as any).description}</div>
        )}
        {/* Execution def indicator */}
        {(data as any).executionDef && (
          <div className="mt-1 flex items-center gap-1">
            <span className="inline-flex items-center text-[8px] font-medium px-1 py-0.5 rounded bg-green-100 text-green-700">
              Execution configured
            </span>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-slate-400 !border-slate-300" />
    </div>
  );
}

// ─── Custom Node: Decision ───
function DecisionNode({ data, selected }: NodeProps) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: 180, height: 110 }}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-amber-500 !border-amber-400" style={{ top: -6 }} />
      <svg width="180" height="110" viewBox="0 0 180 110" className="absolute inset-0">
        <polygon
          points="90,4 176,55 90,106 4,55"
          fill={selected ? '#fef9c3' : '#fffbeb'}
          stroke={selected ? '#2563eb' : '#f59e0b'}
          strokeWidth={selected ? 2.5 : 2}
        />
      </svg>
      <div className="relative z-10 text-center px-8">
        <div className="text-xs font-bold text-amber-800 leading-tight">{(data as any).label || 'Check'}</div>
        {(data as any).question && (
          <div className="text-[10px] text-amber-600 mt-0.5 leading-snug">{(data as any).question}</div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="yes"
        className="!w-3 !h-3 !bg-green-500 !border-green-400"
        style={{ left: '30%', bottom: -6 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="no"
        className="!w-3 !h-3 !bg-red-500 !border-red-400"
        style={{ left: '70%', bottom: -6 }}
      />
      {/* Yes/No labels */}
      <span className="absolute text-[9px] font-bold text-green-600" style={{ left: '18%', bottom: -18 }}>Yes</span>
      <span className="absolute text-[9px] font-bold text-red-600" style={{ left: '62%', bottom: -18 }}>No</span>
    </div>
  );
}

// ─── Custom Node: Start ───
function StartNode({ data }: NodeProps) {
  return (
    <div className="rounded-full bg-green-100 border-2 border-green-500 px-5 py-2.5 shadow-sm">
      <div className="flex items-center gap-1.5">
        <Play className="h-3.5 w-3.5 text-green-600 fill-green-600" />
        <span className="text-sm font-semibold text-green-700">Start Test</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-green-500 !border-green-400" />
    </div>
  );
}

// ─── Custom Node: End ───
function EndNode({ data }: NodeProps) {
  return (
    <div className="rounded-full bg-slate-100 border-2 border-slate-500 px-5 py-2.5 shadow-sm">
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-slate-400 !border-slate-300" />
      <div className="flex items-center gap-1.5">
        <CircleCheck className="h-3.5 w-3.5 text-slate-600" />
        <span className="text-sm font-semibold text-slate-700">{(data as any).label || 'Complete'}</span>
      </div>
    </div>
  );
}

// ─── Node types registry ───
const nodeTypes: NodeTypes = {
  action: ActionNode,
  decision: DecisionNode,
  start: StartNode,
  end: EndNode,
};

// ─── Default edge style ───
const defaultEdgeOptions = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  style: { strokeWidth: 2, stroke: '#94a3b8' },
};

let nodeCounter = 0;
function nextId() { return `node_${Date.now()}_${++nodeCounter}`; }

// ─── Default flow for a new test ───
function createDefaultFlow(): FlowData {
  const startId = nextId();
  const endId = nextId();
  return {
    nodes: [
      { id: startId, type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start Test' } },
      { id: endId, type: 'end', position: { x: 280, y: 600 }, data: { label: 'Complete' } },
    ],
    edges: [],
  };
}

// ─── Main Component ───
export function TestFlowEditor({ testDescription, initialFlow, testActions, onSave, onClose }: Props) {
  const flow = initialFlow && initialFlow.nodes.length > 0 ? initialFlow : createDefaultFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flow.edges);
  const [saving, setSaving] = useState(false);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // Edit panel state
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editAssignee, setEditAssignee] = useState('team');
  const [editInputType, setEditInputType] = useState('none');
  const [editQuestion, setEditQuestion] = useState('');

  const onConnect = useCallback((params: Connection) => {
    const label = params.sourceHandle === 'yes' ? 'Yes' : params.sourceHandle === 'no' ? 'No' : undefined;
    const style = params.sourceHandle === 'yes'
      ? { stroke: '#22c55e', strokeWidth: 2 }
      : params.sourceHandle === 'no'
      ? { stroke: '#ef4444', strokeWidth: 2 }
      : undefined;
    setEdges((eds) => addEdge({ ...params, label, style, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } }, eds));
  }, [setEdges]);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    const dataStr = event.dataTransfer.getData('application/reactflow');
    if (!dataStr || !reactFlowInstance) return;
    const nodeData = JSON.parse(dataStr);
    const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setNodes((nds) => [...nds, { id: nextId(), type: nodeData.nodeType, position, data: nodeData.data }]);
  }, [reactFlowInstance, setNodes]);

  // Double-click opens the full edit panel
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'start') return;
    setEditingNode(node.id);
    setEditLabel((node.data as any).label || '');
    setEditDescription((node.data as any).description || '');
    setEditAssignee((node.data as any).assignee || 'team');
    setEditInputType((node.data as any).inputType || 'none');
    setEditQuestion((node.data as any).question || '');
  }, []);

  const saveNodeEdit = useCallback(() => {
    if (!editingNode) return;
    setNodes((nds) => nds.map((n) => {
      if (n.id !== editingNode) return n;
      if (n.type === 'decision') {
        return { ...n, data: { ...n.data, label: editLabel, question: editQuestion } };
      }
      if (n.type === 'end') {
        return { ...n, data: { ...n.data, label: editLabel } };
      }
      // action node
      return {
        ...n,
        data: {
          ...n.data,
          label: editLabel,
          description: editDescription,
          assignee: editAssignee,
          inputType: editInputType,
        },
      };
    }));
    setEditingNode(null);
  }, [editingNode, editLabel, editDescription, editAssignee, editInputType, editQuestion, setNodes]);

  const deleteSelected = useCallback(() => {
    setNodes((nds) => nds.filter((n) => !n.selected || n.type === 'start'));
    setEdges((eds) => eds.filter((e) => !e.selected));
  }, [setNodes, setEdges]);

  async function handleSave() {
    setSaving(true);
    try { await onSave({ nodes, edges }); } finally { setSaving(false); }
  }

  // Group test actions by type for sidebar
  const groupedActions = useMemo(() => {
    const groups: Record<string, TestAction[]> = { ai: [], client: [], human: [], review: [] };
    testActions.forEach((a) => { if (groups[a.actionType]) groups[a.actionType].push(a); });
    return groups;
  }, [testActions]);

  const editingNodeObj = editingNode ? nodes.find((n) => n.id === editingNode) : null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl w-[95vw] h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b bg-slate-50">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-900 truncate">Test Flow Builder</h2>
            <p className="text-xs text-slate-500 truncate">{testDescription}</p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <span className="text-[10px] text-slate-400">{nodes.length - 2} steps</span>
            <button onClick={deleteSelected} className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded-md hover:bg-red-50">
              Delete Selected
            </button>
            <Button onClick={handleSave} size="sm" disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Save Flow
            </Button>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded-md">
              <X className="h-4 w-4 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar: drag palette */}
          <div className="w-56 border-r bg-slate-50 overflow-y-auto p-3 flex flex-col gap-3">
            <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Drag to Canvas</div>

            {/* Flow control */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold text-slate-500 uppercase">Flow Control</div>
              <DraggableItem
                label="Decision / Check"
                icon={<Diamond className="h-3.5 w-3.5 text-amber-600" />}
                color="border-amber-300 bg-amber-50"
                nodeType="decision"
                data={{ label: 'Agrees?', question: 'Does value match expected?' }}
              />
              <DraggableItem
                label="End / Conclude"
                icon={<CircleCheck className="h-3.5 w-3.5 text-slate-500" />}
                color="border-slate-300 bg-slate-50"
                nodeType="end"
                data={{ label: 'Complete' }}
              />
            </div>

            {/* Quick-add common patterns */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold text-slate-500 uppercase">Common Steps</div>
              <DraggableItem
                label="Portal Request"
                icon={<Globe className="h-3.5 w-3.5 text-sky-600" />}
                color="border-sky-300 bg-sky-50"
                nodeType="action"
                data={{ label: 'Request from Client', description: 'Send request via Client Portal', assignee: 'ai', inputType: 'portal_request' }}
              />
              <DraggableItem
                label="Client Upload"
                icon={<Users className="h-3.5 w-3.5 text-blue-600" />}
                color="border-blue-300 bg-blue-50"
                nodeType="action"
                data={{ label: 'Client Uploads Data', description: 'Client uploads requested evidence', assignee: 'client', inputType: 'portal_upload' }}
              />
              <DraggableItem
                label="AI Check"
                icon={<Bot className="h-3.5 w-3.5 text-purple-600" />}
                color="border-purple-300 bg-purple-50"
                nodeType="action"
                data={{ label: 'AI Verification', description: 'AI checks and validates data', assignee: 'ai', inputType: 'ai_analysis' }}
              />
              <DraggableItem
                label="Sample Selection"
                icon={<Calculator className="h-3.5 w-3.5 text-orange-600" />}
                color="border-orange-300 bg-orange-50"
                nodeType="action"
                data={{ label: 'Select Sample', description: 'Use sample calculator to select items', assignee: 'team', inputType: 'sample_calculator' }}
              />
              <DraggableItem
                label="Team Input"
                icon={<User className="h-3.5 w-3.5 text-green-600" />}
                color="border-green-300 bg-green-50"
                nodeType="action"
                data={{ label: 'User Input', description: 'Team member reviews or enters data', assignee: 'team', inputType: 'data_entry' }}
              />
            </div>

            {/* Test Actions from library */}
            {Object.entries(groupedActions).map(([type, actions]) => {
              if (actions.length === 0) return null;
              const colors = ASSIGNEE_COLORS[type === 'human' ? 'team' : type === 'review' ? 'ai' : type];
              return (
                <div key={type} className="space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase" style={{ color: colors?.text || '#475569' }}>
                    {type === 'human' ? 'Team' : type === 'review' ? 'Review' : type === 'ai' ? 'AI' : 'Client'} Library
                  </div>
                  {actions.map((action) => (
                    <DraggableItem
                      key={action.id}
                      label={action.name}
                      subtitle={action.description}
                      icon={<GripVertical className="h-3 w-3 text-slate-300" />}
                      color="bg-white border"
                      borderColor={colors?.border}
                      nodeType="action"
                      data={{
                        label: action.name,
                        description: action.description,
                        assignee: action.actionType === 'human' ? 'team' : action.actionType === 'review' ? 'ai' : action.actionType,
                        inputType: 'none',
                        actionId: action.id,
                        executionDef: action.executionDef || undefined,
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {/* Canvas */}
          <div className="flex-1 relative">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onInit={setReactFlowInstance}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onNodeDoubleClick={onNodeDoubleClick}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
              fitView
              deleteKeyCode="Delete"
              className="bg-white"
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
              <Controls />
            </ReactFlow>

            {/* Hint overlay */}
            {nodes.length <= 2 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-slate-300">
                  <p className="text-lg font-medium">Drag actions from the left panel</p>
                  <p className="text-sm mt-1">Double-click a node to edit its properties</p>
                </div>
              </div>
            )}
          </div>

          {/* Right panel: node editor (when a node is being edited) */}
          {editingNode && editingNodeObj && (
            <div className="w-72 border-l bg-white overflow-y-auto p-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-bold text-slate-800">Edit Node</span>
                <button onClick={() => setEditingNode(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3">
                {/* Label */}
                <div>
                  <label className="text-[10px] font-medium text-slate-500 uppercase">Name</label>
                  <input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="w-full border rounded-md px-2.5 py-1.5 text-sm mt-0.5"
                    autoFocus
                  />
                </div>

                {editingNodeObj.type === 'decision' && (
                  <div>
                    <label className="text-[10px] font-medium text-slate-500 uppercase">Question / Condition</label>
                    <textarea
                      value={editQuestion}
                      onChange={(e) => setEditQuestion(e.target.value)}
                      className="w-full border rounded-md px-2.5 py-1.5 text-sm mt-0.5"
                      rows={2}
                      placeholder="e.g. Does response agree to TB?"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">Yes exits left, No exits right</p>
                  </div>
                )}

                {editingNodeObj.type === 'action' && (
                  <>
                    {/* Description */}
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 uppercase">Description</label>
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="w-full border rounded-md px-2.5 py-1.5 text-sm mt-0.5"
                        rows={2}
                        placeholder="What does this step do?"
                      />
                    </div>

                    {/* Assignee */}
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 uppercase">Who performs this?</label>
                      <div className="flex gap-1.5 mt-1">
                        {ASSIGNEES.map((a) => {
                          const Icon = a.icon;
                          return (
                            <button
                              key={a.value}
                              onClick={() => setEditAssignee(a.value)}
                              className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                                editAssignee === a.value ? a.color + ' border-2' : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              <Icon className="h-3 w-3" />
                              {a.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Input Type */}
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 uppercase">Input / Interaction</label>
                      <select
                        value={editInputType}
                        onChange={(e) => setEditInputType(e.target.value)}
                        className="w-full border rounded-md px-2.5 py-1.5 text-sm mt-0.5 bg-white"
                      >
                        {INPUT_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <Button onClick={saveNodeEdit} size="sm" className="w-full mt-2">Apply Changes</Button>

                {/* Delete button */}
                {editingNodeObj.type !== 'start' && (
                  <button
                    onClick={() => {
                      setNodes((nds) => nds.filter((n) => n.id !== editingNode));
                      setEdges((eds) => eds.filter((e) => e.source !== editingNode && e.target !== editingNode));
                      setEditingNode(null);
                    }}
                    className="w-full text-xs text-red-500 hover:text-red-700 py-1.5 border border-red-200 rounded-md hover:bg-red-50 mt-1"
                  >
                    Delete This Node
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Draggable sidebar item ───
function DraggableItem({
  label,
  subtitle,
  icon,
  color,
  borderColor,
  nodeType,
  data,
}: {
  label: string;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  borderColor?: string;
  nodeType: string;
  data: Record<string, any>;
}) {
  const onDragStart = (event: DragEvent) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify({ nodeType, data }));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md border cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow ${color}`}
      style={borderColor ? { borderColor } : undefined}
    >
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-700 leading-tight">{label}</div>
        {subtitle && <div className="text-[10px] text-slate-400 leading-tight truncate">{subtitle}</div>}
      </div>
    </div>
  );
}
