import React, { memo, useCallback, useRef, type CSSProperties } from 'react';
import { Handle, Position, useConnection, type Node, type NodeProps } from '@xyflow/react';
import { useApp } from '../../app/store';
import { registry } from '../../components/registry';
import { pinKey } from '../../lib/types';
import { meterService } from '../../audio/meterService';
import { scopeService, type ScopeMode } from '../../audio/scopeService';
import { HEADER_H, ROW_H, hueFor } from '../constants';

import { patterns } from '../../patterns';

export type PinTableNodeType = Node<{ pl: true }, 'pinTable'>;

function applySeqPreset(nodeId: string, name: string) {
  const setBulk = useApp.getState().setParamsBulk;
  const p: Record<string, number> = {};
  for (let r = 1; r <= 4; r++) {
    for (let c = 1; c <= 16; c++) {
      p[`s${r}_${c}`] = 0;
    }
  }
  
  if (name === 'Clear') {
    setBulk(nodeId, p, { pattern: '' });
  } else {
    const pattern = patterns.find(pat => pat.name === name || pat.id === name);
    if (pattern) {
      p.steps = pattern.steps;
      p.rate = pattern.rate;
      for (let r = 0; r < pattern.rows.length; r++) {
        for (let c = 0; c < pattern.rows[r].length; c++) {
          p[`s${r + 1}_${c + 1}`] = pattern.rows[r][c];
        }
      }
      setBulk(nodeId, p, { pattern: pattern.id });
    } else {
      setBulk(nodeId, p);
    }
  }
  
  // Show toast
  const showToast = useApp.getState().showToast;
  const displayName = name === 'Clear' ? 'Clear' : (patterns.find(pat => pat.name === name || pat.id === name)?.name || name);
  showToast(`${displayName} loaded`);
}

function PinTableNodeImpl({ id }: NodeProps<PinTableNodeType>) {
  const node = useApp((s) => s.design.nodes.find((n) => n.id === id));
  const selected = useApp((s) => s.ui.selectedNodeIds.includes(id));
  const trace = useApp((s) => s.ui.trace);
  const hoverTracePin = useApp((s) => s.hoverTracePin);
  const pinTracePin = useApp((s) => s.pinTracePin);
  const loadMediaFile = useApp((s) => s.loadMediaFile);
  const fileRef = useRef<HTMLInputElement>(null);

  const canvasRef = useCallback(
    (el: HTMLCanvasElement | null) => meterService.attachCanvas(id, el),
    [id],
  );
  const scopeRef = useCallback(
    (el: HTMLCanvasElement | null) => scopeService.attachCanvas(id, el),
    [id],
  );
  const seqRef = useRef<HTMLDivElement>(null);

  const conn = useConnection();
  const wires = useApp((s) => s.design.wires);
  const designNodes = useApp((s) => s.design.nodes);
  const activeLayerId = useApp((s) => s.ui.activeLayerId);
  const layers = useApp((s) => s.design.layers ?? [{ id: 'main', name: 'Main' }]);
  const firstLayerId = layers[0]?.id ?? 'main';
  
  const fromSpec = React.useMemo(() => {
    if (!conn.inProgress || !conn.fromHandle) return null;
    const fromType = designNodes.find(n => n.id === conn.fromHandle!.nodeId)?.type;
    return fromType ? registry[fromType]?.pins.find(p => p.id === conn.fromHandle!.id) : null;
  }, [conn.inProgress, conn.fromHandle, designNodes]);

  const takenInputs = React.useMemo(() => {
    if (!conn.inProgress) return new Set<string>();
    const set = new Set<string>();
    for (const w of wires) set.add(`${w.to.nodeId}:${w.to.pinId}`);
    return set;
  }, [conn.inProgress, wires]);

  const spec = node ? registry[node.type] : undefined;

  React.useEffect(() => {
    if (spec?.display !== 'sequencer') return;
    
    const onStep = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail.nodeId !== id) return;
      const grid = seqRef.current;
      if (!grid) return;
      
      setTimeout(() => {
        const prev = grid.querySelectorAll('.is-playhead');
        prev.forEach(el => el.classList.remove('is-playhead'));
        const cells = grid.querySelectorAll(`[data-col="${ce.detail.step}"]`);
        cells.forEach(el => el.classList.add('is-playhead'));
      }, ce.detail.delayMs);
    };

    const onStop = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail.nodeId !== id) return;
      const grid = seqRef.current;
      if (!grid) return;
      const prev = grid.querySelectorAll('.is-playhead');
      prev.forEach(el => el.classList.remove('is-playhead'));
    };

    window.addEventListener('pl-seq-step', onStep);
    window.addEventListener('pl-seq-stop', onStop);
    return () => {
      window.removeEventListener('pl-seq-step', onStep);
      window.removeEventListener('pl-seq-stop', onStop);
    };
  }, [id, spec?.display]);

  const activePattern = React.useMemo(() => {
    if (!node || !spec || spec.display !== 'sequencer' || !node.meta?.pattern) return null;
    const pat = patterns.find(p => p.id === node.meta?.pattern);
    if (!pat) return null;
    let edited = false;
    if ((node.params.steps || 16) !== pat.steps) edited = true;
    if ((node.params.rate || 0) !== pat.rate) edited = true;
    if (!edited) {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 16; c++) {
          const expected = (pat.rows[r]?.[c] === 1) ? 1 : 0;
          const actual = (node.params[`s${r + 1}_${c + 1}`] || 0) > 0.5 ? 1 : 0;
          if (expected !== actual) {
            edited = true;
            break;
          }
        }
        if (edited) break;
      }
    }
    return { pat, edited };
  }, [spec?.display, node?.meta?.pattern, node?.params]);

  const crossLayerTargets = React.useMemo(() => {
    const targets = new Map<string, string>();
    if (activeLayerId === 'all') return targets;
    
    const nodeLayers = new Map<string, string>();
    for (const n of designNodes) {
      nodeLayers.set(n.id, n.layerId ?? firstLayerId);
    }
    
    const layerNames = new Map<string, string>();
    for (const l of layers) {
      layerNames.set(l.id, l.name);
    }

    for (const w of wires) {
      if (w.from.nodeId === id || w.to.nodeId === id) {
        const isOut = w.from.nodeId === id;
        const pinId = isOut ? w.from.pinId : w.to.pinId;
        const otherId = isOut ? w.to.nodeId : w.from.nodeId;
        
        const otherLayerId = nodeLayers.get(otherId);
        if (otherLayerId && otherLayerId !== activeLayerId) {
          targets.set(pinId, layerNames.get(otherLayerId) ?? 'Other Layer');
        }
      }
    }
    return targets;
  }, [wires, designNodes, activeLayerId, layers, firstLayerId, id]);

  if (!node || !spec) return null;

  if (spec.display === 'scope') {
    scopeService.setMode(id, (Math.round(node.params.mode ?? 0) as ScopeMode) || 0);
  }

  const onPath = trace?.nodes.has(id) ?? false;
  const hue = trace ? hueFor(trace.hueIndex) : undefined;

  const inPins = spec.pins.filter((p) => p.direction === 'in');
  const outPins = spec.pins.filter((p) => p.direction === 'out');

  return (
    <div
      className={[
        'pl-node',
        spec.display === 'sequencer' ? 'is-seq' : '',
        selected ? 'is-selected' : '',
        onPath ? 'on-path' : '',
      ].join(' ')}
    >
      <div className="pl-node__header" style={{ height: HEADER_H }}>
        <span className="pl-node__title">{node.label}</span>
        <canvas
          ref={canvasRef}
          className="pl-meter"
          width={88}
          height={16}
          aria-label="level meter"
        />
      </div>

      {spec.pins.map((pin) => {
        const traced = trace?.pins.has(pinKey({ nodeId: id, pinId: pin.id }));
        const isIn = pin.direction === 'in';
        const isControl = pin.kind === 'control';
        const isTrigger = pin.kind === 'trigger';
        const idx = isIn
          ? inPins.indexOf(pin) + 1
          : outPins.indexOf(pin) + 1;
          
        let hintClass = '';
        if (conn.inProgress && fromSpec) {
          const isValidTarget =
            conn.fromHandle!.nodeId !== id &&
            fromSpec.direction !== pin.direction &&
            fromSpec.kind === pin.kind &&
            (!isIn || !takenInputs.has(`${id}:${pin.id}`));
          hintClass = isValidTarget ? 'is-valid-target' : 'is-dim';
        }
        
        const crossLayerName = crossLayerTargets.get(pin.id);

        return (
          <div
            key={pin.id}
            className={['pl-pinrow', isIn ? 'is-in' : 'is-out'].join(' ')}
            style={{ height: ROW_H }}
            onMouseEnter={() => hoverTracePin({ nodeId: id, pinId: pin.id })}
            onMouseLeave={() => hoverTracePin(null)}
            onClick={(e) => {
              e.stopPropagation();
              pinTracePin({ nodeId: id, pinId: pin.id });
              useApp.getState().setSelectedNodes([id]);
            }}
          >
            <span className="pl-pinrow__index">{idx}</span>
            <span className="pl-pinrow__label">{pin.label}</span>
            <Handle
              id={pin.id}
              type={isIn ? 'target' : 'source'}
              position={isIn ? Position.Left : Position.Right}
              className={[
                'pl-handle',
                traced ? 'is-traced' : '',
                isControl ? 'is-control' : '',
                isTrigger ? 'is-trigger' : '',
                crossLayerName ? 'is-crosslayer' : '',
                hintClass,
              ].join(' ')}
              style={
                { '--pl-pin-hue': traced ? hue : undefined } as CSSProperties
              }
              title={crossLayerName ? `→ ${crossLayerName}` : undefined}
              onMouseEnter={() =>
                hoverTracePin({ nodeId: id, pinId: pin.id })
              }
              onMouseLeave={() => hoverTracePin(null)}
              onClick={(e) => {
                e.stopPropagation();
                pinTracePin({ nodeId: id, pinId: pin.id });
              }}
            />
          </div>
        );
      })}

      {spec.display === 'scope' && (
        <canvas
          ref={scopeRef}
          className="pl-scope"
          width={368}
          height={144}
          aria-label="signal display"
        />
      )}

      {spec.display === 'media' && (
        <div className="pl-node__extra">
          <button
            className="pl-mini-btn nodrag"
            onClick={(e) => {
              e.stopPropagation();
              fileRef.current?.click();
            }}
          >
            Load file…
          </button>
          <span className="pl-node__file" title={node.meta?.file}>
            {node.meta?.file ?? 'no file loaded'}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadMediaFile(id, f);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {spec.display === 'mic' && (
        <div className="pl-node__extra pl-node__hint">
          Enable asks the browser for mic access
        </div>
      )}

      {spec.display === 'trigger' && (
        <div style={{ padding: '8px' }}>
          <button
            className="pl-pad nodrag"
            style={{ width: '100%', height: '44px' }}
            onPointerDown={(e) => {
              const btn = e.currentTarget;
              btn.classList.add('is-pressed');
              setTimeout(() => btn.classList.remove('is-pressed'), 120);
              useApp.getState().fireTrigger(id, 'out');
            }}
          >
            TRIG
          </button>
        </div>
      )}

      {spec.display === 'sequencer' && (
        <div className="pl-seq-block" ref={seqRef}>
          <div className="pl-seq-grid">
            {['D', 'T', 'K', 'G'].map((rowLabel, r) => (
              <div key={r} className="pl-seq-row">
                <span className="pl-seq-row-label">{rowLabel}</span>
                {Array.from({ length: 16 }).map((_, c) => {
                  const paramId = `s${r + 1}_${c + 1}`;
                  const on = (node.params[paramId] || 0) > 0.5;
                  const active = c < (node.params.steps || 16);
                  return (
                    <button
                      key={c}
                      data-col={c}
                      className={[
                        'pl-seq-cell',
                        'nodrag',
                        on ? 'is-on' : '',
                        !active ? 'is-inactive' : '',
                        c % 4 === 0 ? 'is-beat' : ''
                      ].join(' ')}
                      onClick={(e) => {
                        e.stopPropagation();
                        useApp.getState().setParam(id, paramId, on ? 0 : 1);
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          {activePattern && (
            <div style={{ padding: '0 8px 8px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                {activePattern.pat.name}{activePattern.edited ? ' · edited' : ''}
              </span>
              {activePattern.edited && (
                <button 
                  className="pl-mini-btn nodrag"
                  onClick={(e) => {
                    e.stopPropagation();
                    applySeqPreset(id, activePattern.pat.id);
                  }}
                >
                  Reset
                </button>
              )}
            </div>
          )}
          <div className="pl-seq-presets">
            {['Maqsum', 'Baladi', 'Saidi', 'Malfuf', "Sama\u02bfi Thaqil", 'Clear'].map(preset => (
              <button 
                key={preset}
                className="pl-mini-btn nodrag"
                onClick={(e) => {
                  e.stopPropagation();
                  applySeqPreset(id, preset);
                }}
              >
                {preset}
              </button>
            ))}
            <button 
              className="pl-mini-btn nodrag"
              onClick={(e) => {
                e.stopPropagation();
                const s = useApp.getState();
                s.setPanelOpen(true);
                s.setPanelTab('patterns');
              }}
            >
              More …
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const PinTableNode = memo(PinTableNodeImpl);
