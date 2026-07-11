import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type MarqueeDrag = {
  pointerId: number;
  paneRect: DOMRect;
  startClientX: number;
  startClientY: number;
  startFlowX: number;
  startFlowY: number;
};

type MarqueeBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function FlowCanvas() {
  const design = useApp((s) => s.design);
  const selectedNodeIds = useApp((s) => s.ui.selectedNodeIds);
  const selectedWireId = useApp((s) => s.ui.selectedWireId);
  const beginDrag = useApp((s) => s.beginDrag);
  const { screenToFlowPosition, getIntersectingNodes } = useReactFlow<PinTableNodeType, SignalEdgeType>();

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
  const marqueeDragRef = useRef<MarqueeDrag | null>(null);
  const [marquee, setMarquee] = useState<MarqueeBox | null>(null);

  const activeLayerId = useApp((s) => s.ui.activeLayerId);
  const layers = useApp((s) => s.design.layers ?? [{ id: 'main', name: 'Main' }]);
  const firstLayerId = layers[0].id;

  const visibleNodes = useMemo(() => {
    if (activeLayerId === 'all') return design.nodes;
    return design.nodes.filter(n => (n.layerId ?? firstLayerId) === activeLayerId);
  }, [design.nodes, activeLayerId, firstLayerId]);

  const nodes: PinTableNodeType[] = useMemo(() => {
    const cache = nodeCacheRef.current;
    const ids = new Set<string>();
    const next = visibleNodes.map((n) => {
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
  }, [visibleNodes, selectedNodeIds]);

  const edges: SignalEdgeType[] = useMemo(
    () => {
      const visibleIds = new Set(visibleNodes.map(n => n.id));
      return design.wires
        .filter(w => visibleIds.has(w.from.nodeId) && visibleIds.has(w.to.nodeId))
        .map((w) => ({
          id: w.id,
          type: 'signal' as const,
          source: w.from.nodeId,
          sourceHandle: w.from.pinId,
          target: w.to.nodeId,
          targetHandle: w.to.pinId,
          data: { colorIndex: w.colorIndex, kind: w.kind ?? 'audio', sourceNodeId: w.from.nodeId },
          selected: w.id === selectedWireId,
        }));
    },
    [design.wires, selectedWireId, visibleNodes],
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

  const onPanePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 2 || e.pointerType !== 'mouse') return;
      const target = e.target as HTMLElement | null;
      if (!target?.classList.contains('react-flow__pane')) return;

      e.preventDefault();
      e.stopPropagation();

      const paneRect = target.getBoundingClientRect();
      const flowStart = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      marqueeDragRef.current = {
        pointerId: e.pointerId,
        paneRect,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startFlowX: flowStart.x,
        startFlowY: flowStart.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      setMarquee({
        left: e.clientX - paneRect.left,
        top: e.clientY - paneRect.top,
        width: 0,
        height: 0,
      });
    },
    [screenToFlowPosition],
  );

  const onPanePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = marqueeDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    e.preventDefault();
    e.stopPropagation();

    const startX = drag.startClientX - drag.paneRect.left;
    const startY = drag.startClientY - drag.paneRect.top;
    const currentX = e.clientX - drag.paneRect.left;
    const currentY = e.clientY - drag.paneRect.top;
    setMarquee({
      left: Math.min(startX, currentX),
      top: Math.min(startY, currentY),
      width: Math.abs(currentX - startX),
      height: Math.abs(currentY - startY),
    });
  }, []);

  const finishPaneMarquee = useCallback(
    (e: React.PointerEvent, commit: boolean) => {
      const drag = marqueeDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;

      e.preventDefault();
      e.stopPropagation();

      const moved =
        Math.abs(e.clientX - drag.startClientX) >= 4 ||
        Math.abs(e.clientY - drag.startClientY) >= 4;

      if (commit && moved) {
        const flowEnd = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const rect = {
          x: Math.min(drag.startFlowX, flowEnd.x),
          y: Math.min(drag.startFlowY, flowEnd.y),
          width: Math.abs(flowEnd.x - drag.startFlowX),
          height: Math.abs(flowEnd.y - drag.startFlowY),
        };
        const visibleIds = new Set(visibleNodes.map((n) => n.id));
        const ids = getIntersectingNodes(rect, true)
          .map((n) => n.id)
          .filter((id) => visibleIds.has(id));
        useApp.getState().setSelectedNodes(ids);
      }

      if (e.currentTarget.hasPointerCapture(drag.pointerId)) {
        e.currentTarget.releasePointerCapture(drag.pointerId);
      }
      marqueeDragRef.current = null;
      setMarquee(null);
    },
    [getIntersectingNodes, screenToFlowPosition, visibleNodes],
  );

  const onPanePointerUp = useCallback(
    (e: React.PointerEvent) => finishPaneMarquee(e, true),
    [finishPaneMarquee],
  );

  const onPanePointerCancel = useCallback(
    (e: React.PointerEvent) => finishPaneMarquee(e, false),
    [finishPaneMarquee],
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
        const activeLayerId = s.ui.activeLayerId;
        const layers = s.design.layers ?? [{ id: 'main', name: 'Main' }];
        const firstLayerId = layers[0].id;
        const visibleIds = s.design.nodes
          .filter(n => activeLayerId === 'all' || (n.layerId ?? firstLayerId) === activeLayerId)
          .map(n => n.id);
        s.setSelectedNodes(visibleIds);
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
      onNodeDragStart={() => beginDrag()}
      onSelectionDragStart={() => beginDrag()}
      onPaneClick={() => useApp.getState().clearSelection()}
      onPaneContextMenu={(e) => e.preventDefault()}
      onPointerDownCapture={onPanePointerDown}
      onPointerMoveCapture={onPanePointerMove}
      onPointerUpCapture={onPanePointerUp}
      onPointerCancelCapture={onPanePointerCancel}
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      panOnDrag
      selectionOnDrag={false}
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
      {marquee && (
        <div
          className="pl-marquee"
          style={{
            left: marquee.left,
            top: marquee.top,
            width: marquee.width,
            height: marquee.height,
          }}
        />
      )}
      {design.nodes.length === 0 && (
        <div className="pl-empty-canvas">
          Drag components from the left — or load an example from the panel →
        </div>
      )}
    </ReactFlow>
  );
}
