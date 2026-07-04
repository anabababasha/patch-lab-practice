import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  SelectionMode,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import { useApp } from '../app/store';
import { PinTableNode, type PinTableNodeType } from './nodes/PinTableNode';
import { SignalEdge, type SignalEdgeType } from './edges/SignalEdge';
import { DND_MIME } from './Palette';
import { NODE_WIDTH } from './constants';

const nodeTypes: NodeTypes = { pinTable: PinTableNode };
const edgeTypes: EdgeTypes = { signal: SignalEdge };

export function FlowCanvas() {
  const design = useApp((s) => s.design);
  const selectedNodeIds = useApp((s) => s.ui.selectedNodeIds);
  const selectedWireId = useApp((s) => s.ui.selectedWireId);
  const { screenToFlowPosition } = useReactFlow();

  /*
   * React Flow (v12) keeps node internals (measured size, handle bounds) keyed
   * by user-node OBJECT IDENTITY, and resets them for any node object it hasn't
   * seen unless that object carries `measured`. So we (a) reuse the exact same
   * object for unchanged nodes, and (b) thread the measured size — captured
   * from 'dimensions' changes — into any object we do recreate. Without this,
   * every selection/drag would re-measure all nodes and flicker the edges.
   */
  const nodeCacheRef = useRef(new Map<string, PinTableNodeType>());
  const measuredRef = useRef(new Map<string, { width: number; height: number }>());

  const nodes: PinTableNodeType[] = useMemo(() => {
    const cache = nodeCacheRef.current;
    const ids = new Set<string>();
    const next = design.nodes.map((n) => {
      ids.add(n.id);
      const selected = selectedNodeIds.includes(n.id);
      const measured = measuredRef.current.get(n.id);
      const prev = cache.get(n.id);
      if (
        prev &&
        prev.position.x === n.x &&
        prev.position.y === n.y &&
        prev.selected === selected &&
        prev.measured?.width === measured?.width &&
        prev.measured?.height === measured?.height
      ) {
        return prev;
      }
      const node: PinTableNodeType = {
        id: n.id,
        type: 'pinTable',
        position: { x: n.x, y: n.y },
        data: { pl: true },
        selected,
        ...(measured ? { measured } : {}),
      };
      cache.set(n.id, node);
      return node;
    });
    for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
    for (const id of measuredRef.current.keys())
      if (!ids.has(id)) measuredRef.current.delete(id);
    return next;
  }, [design.nodes, selectedNodeIds]);

  const edges: SignalEdgeType[] = useMemo(
    () =>
      design.wires.map((w) => ({
        id: w.id,
        type: 'signal' as const,
        source: w.from.nodeId,
        sourceHandle: w.from.pinId,
        target: w.to.nodeId,
        targetHandle: w.to.pinId,
        data: { colorIndex: w.colorIndex, kind: w.kind ?? 'audio' },
        selected: w.id === selectedWireId,
      })),
    [design.wires, selectedWireId],
  );

  const onNodesChange = useCallback((changes: NodeChange<PinTableNodeType>[]) => {
    const { moveNode, setSelectedNodes } = useApp.getState();
    const s = useApp.getState();
    let selChanged = false;
    let nextSel = new Set(s.ui.selectedNodeIds);

    for (const ch of changes) {
      if (ch.type === 'position' && ch.position) {
        moveNode(ch.id, ch.position.x, ch.position.y);
      } else if (ch.type === 'dimensions' && ch.dimensions) {
        measuredRef.current.set(ch.id, ch.dimensions);
      } else if (ch.type === 'select') {
        selChanged = true;
        if (ch.selected) nextSel.add(ch.id);
        else nextSel.delete(ch.id);
      }
    }
    
    if (selChanged) {
      setSelectedNodes(Array.from(nextSel));
    }
  }, []);

  const onEdgesChange = useCallback((_changes: EdgeChange<SignalEdgeType>[]) => {
    // deletion is handled by our own keyboard logic for atomic undo
  }, []);

  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target && c.sourceHandle && c.targetHandle) {
      useApp
        .getState()
        .addWire(
          { nodeId: c.source, pinId: c.sourceHandle },
          { nodeId: c.target, pinId: c.targetHandle },
        );
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const type = e.dataTransfer.getData(DND_MIME);
      if (!type) return;
      e.preventDefault();
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      useApp.getState().addNode(type, p.x - NODE_WIDTH / 2, p.y - 17);
    },
    [screenToFlowPosition],
  );

  // keyboard: Delete/Backspace, Esc, Cmd/Ctrl+Z
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable)
        return;
      const s = useApp.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        s.selectAll();
        return;
      }
      if (e.key === 'Escape') {
        s.clearSelection();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.ui.selectedWireId) {
          e.preventDefault();
          s.removeWire(s.ui.selectedWireId);
        } else if (s.ui.selectedNodeIds.length > 0) {
          e.preventDefault();
          s.removeNodes(s.ui.selectedNodeIds);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={() => true}
      onNodeClick={(_, n) => useApp.getState().setSelectedNodes([n.id])}
      onNodeDragStart={() => useApp.getState().beginDrag()}
      onPaneClick={() => useApp.getState().clearSelection()}
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      selectionMode={SelectionMode.Partial}
      // pin clicks pin the trace (the signature interaction) — connecting is drag-only
      connectOnClick={false}
      deleteKeyCode={null}
      fitView
      fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: false }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1.5}
        color="#1A1E25"
      />
      <MiniMap
        pannable
        zoomable
        nodeColor={() => '#171B21'}
        nodeStrokeColor={() => '#262C35'}
        maskColor="rgba(10, 12, 15, 0.75)"
        bgColor="#0E1116"
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
