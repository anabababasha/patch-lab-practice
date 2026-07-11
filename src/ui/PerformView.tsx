import React, { useEffect, useRef } from 'react';
import { useApp } from '../app/store';
import { formatValue } from '../lib/units';
import { meterService } from '../audio/meterService';
import { engine } from '../audio/engine';

function dbToTravel(db: number, min: number, max: number): number {
  db = Math.max(min, Math.min(max, db));
  if (db <= -30) {
    return 0.25 * ((db - min) / (-30 - min));
  } else {
    return 0.25 + 0.75 * ((db - -30) / (max - -30));
  }
}

function travelToDb(t: number, min: number, max: number): number {
  t = Math.max(0, Math.min(1, t));
  if (t <= 0.25) {
    return min + (t / 0.25) * (-30 - min);
  } else {
    return -30 + ((t - 0.25) / 0.75) * (max - -30);
  }
}

const Fader = ({ nodeId, paramId, dbMin, dbMax, defaultVal }: { nodeId: string, paramId: string, dbMin: number, dbMax: number, defaultVal: number }) => {
  const paramVal = useApp(s => s.design.nodes.find(n => n.id === nodeId)?.params?.[paramId] ?? defaultVal);
  const beginParamGesture = useApp(s => s.beginParamGesture);
  const setParamLive = useApp(s => s.setParamLive);
  const finishParamGesture = useApp(s => s.finishParamGesture);
  const setParam = useApp(s => s.setParam);

  const thumbRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const popupTextRef = useRef<HTMLSpanElement>(null);
  const fineTagRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const state = useRef({
    dragging: false,
    startedGesture: false,
    startY: 0,
    startX: 0,
    startDb: 0,
    lastDb: 0,
    fine: false,
    lastUpdate: 0,
    doubleTapTime: 0
  });

  useEffect(() => () => {
    if (state.current.startedGesture) {
      finishParamGesture(nodeId, paramId);
    }
  }, [nodeId, paramId, finishParamGesture]);

  const t = dbToTravel(paramVal, dbMin, dbMax);

  const updatePopup = (val: number, fine: boolean) => {
    if (popupTextRef.current) popupTextRef.current.textContent = formatValue(val, 'dB', 0.5);
    if (fineTagRef.current) fineTagRef.current.style.display = fine ? '' : 'none';
  };

  const positionPopup = (e: React.PointerEvent) => {
    if (popupRef.current) {
      popupRef.current.style.left = `${e.clientX}px`;
      popupRef.current.style.top = `${e.clientY - 44}px`;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const now = Date.now();
    if (now - state.current.doubleTapTime < 300) {
      state.current.doubleTapTime = 0;
      setParam(nodeId, paramId, defaultVal);
      return;
    }
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    state.current.dragging = true;
    state.current.startedGesture = false;
    state.current.startY = e.clientY;
    state.current.startX = e.clientX;
    state.current.startDb = paramVal;
    state.current.lastDb = paramVal;
    state.current.fine = false;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!state.current.dragging) return;
    if (!state.current.startedGesture) {
      // gesture (and its single undo snapshot) starts only past a real-movement threshold — a tap leaves no history entry
      const moved = Math.abs(e.clientY - state.current.startY) > 3 || Math.abs(e.clientX - state.current.startX) > 3;
      if (!moved) return;
      state.current.startedGesture = true;
      beginParamGesture(nodeId, paramId);
      if (popupRef.current) popupRef.current.style.display = 'block';
      updatePopup(state.current.lastDb, false);
      positionPopup(e);
    }
    const now = Date.now();
    if (now - state.current.lastUpdate < 30) return;
    state.current.lastUpdate = now;

    const dx = Math.abs(e.clientX - state.current.startX);
    const fine = dx > 60;
    if (fine !== state.current.fine) {
      // rebase the anchor at the mode crossing so the value stays continuous — no jump
      state.current.fine = fine;
      state.current.startY = e.clientY;
      state.current.startDb = state.current.lastDb;
      if (thumbRef.current) thumbRef.current.classList.toggle('is-fine', fine);
    }

    const dy = state.current.startY - e.clientY;
    const startT = dbToTravel(state.current.startDb, dbMin, dbMax);
    const trackHeight = trackRef.current ? trackRef.current.clientHeight : 200;
    const dt = (dy / trackHeight) * (fine ? 0.1 : 1);

    let newDb = travelToDb(startT + dt, dbMin, dbMax);
    newDb = Math.max(dbMin, Math.min(dbMax, newDb));
    state.current.lastDb = newDb;

    setParamLive(nodeId, paramId, newDb);
    updatePopup(newDb, fine);
    positionPopup(e);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!state.current.dragging) return;
    state.current.dragging = false;
    const el = e.currentTarget as HTMLElement;
    try { el.releasePointerCapture(e.pointerId); } catch {}
    if (state.current.startedGesture) {
      state.current.startedGesture = false;
      finishParamGesture(nodeId, paramId);
    } else {
      // a clean tap — arm the double-tap window (drags never arm it)
      state.current.doubleTapTime = Date.now();
    }
    if (popupRef.current) popupRef.current.style.display = 'none';
    if (thumbRef.current) thumbRef.current.classList.remove('is-fine');
  };

  return (
     <div className="pl-perform-fader-area">
       <div className="pl-perform-fader-track" />
       <div
         ref={trackRef}
         className="pl-perform-fader-hit"
         onPointerDown={handlePointerDown}
         onPointerMove={handlePointerMove}
         onPointerUp={endDrag}
         onPointerCancel={endDrag}
       >
         <div
           ref={thumbRef}
           className="pl-perform-fader-thumb"
           style={{ bottom: `${t * 100}%` }}
         />
       </div>
       <div ref={popupRef} className="pl-perform-popup" style={{ display: 'none', transform: 'translateX(-50%)' }}>
         <span ref={popupTextRef} />
         <span ref={fineTagRef} className="fine-tag" style={{ display: 'none' }}>FINE</span>
       </div>
     </div>
  );
};

const PanMini = ({ nodeId, pinIdx }: { nodeId: string, pinIdx: number }) => {
  const paramId = `pan${pinIdx}`;
  const paramVal = useApp(s => s.design.nodes.find(n => n.id === nodeId)?.params?.[paramId] ?? 0);
  
  const beginParamGesture = useApp(s => s.beginParamGesture);
  const setParamLive = useApp(s => s.setParamLive);
  const finishParamGesture = useApp(s => s.finishParamGesture);
  const setParam = useApp(s => s.setParam);

  const trackRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const state = useRef({
    dragging: false,
    startedGesture: false,
    startX: 0,
    startY: 0,
    startPan: 0,
    lastPan: 0,
    lastUpdate: 0,
    doubleTapTime: 0
  });

  useEffect(() => () => {
    if (state.current.startedGesture) {
      finishParamGesture(nodeId, paramId);
    }
  }, [nodeId, paramId, finishParamGesture]);

  const updatePopup = (val: number) => {
    if (popupRef.current) {
      let text = 'C';
      if (val < -0.01) text = `L ${formatValue(Math.abs(val), '', 0.01)}`;
      else if (val > 0.01) text = `R ${formatValue(Math.abs(val), '', 0.01)}`;
      popupRef.current.textContent = text;
    }
  };

  const positionPopup = (e: React.PointerEvent) => {
    if (popupRef.current) {
      popupRef.current.style.left = `${e.clientX}px`;
      popupRef.current.style.top = `${e.clientY - 44}px`;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const now = Date.now();
    if (now - state.current.doubleTapTime < 300) {
      state.current.doubleTapTime = 0;
      setParam(nodeId, paramId, 0);
      return;
    }
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    state.current.dragging = true;
    state.current.startedGesture = false;
    state.current.startX = e.clientX;
    state.current.startY = e.clientY;
    state.current.startPan = paramVal;
    state.current.lastPan = paramVal;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!state.current.dragging) return;
    if (!state.current.startedGesture) {
      const moved = Math.abs(e.clientX - state.current.startX) > 3 || Math.abs(e.clientY - state.current.startY) > 3;
      if (!moved) return;
      state.current.startedGesture = true;
      beginParamGesture(nodeId, paramId);
      if (popupRef.current) popupRef.current.style.display = 'block';
      updatePopup(state.current.lastPan);
      positionPopup(e);
    }
    const now = Date.now();
    if (now - state.current.lastUpdate < 30) return;
    state.current.lastUpdate = now;

    const dx = e.clientX - state.current.startX;
    const trackWidth = trackRef.current ? trackRef.current.clientWidth : 50;

    const dt = dx / (trackWidth / 2);
    let newPan = state.current.startPan + dt;
    newPan = Math.max(-1, Math.min(1, newPan));
    state.current.lastPan = newPan;

    setParamLive(nodeId, paramId, newPan);
    updatePopup(newPan);
    positionPopup(e);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!state.current.dragging) return;
    state.current.dragging = false;
    const el = e.currentTarget as HTMLElement;
    try { el.releasePointerCapture(e.pointerId); } catch {}
    if (state.current.startedGesture) {
      state.current.startedGesture = false;
      finishParamGesture(nodeId, paramId);
    } else {
      state.current.doubleTapTime = Date.now();
    }
    if (popupRef.current) popupRef.current.style.display = 'none';
  };

  const pct = ((paramVal + 1) / 2) * 100;

  return (
    <div className="pl-perform-pan-area" ref={trackRef}>
      <div className="pl-perform-pan-track">
        <div
          className="pl-perform-pan-hit"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
        <div className="pl-perform-pan-thumb" style={{ left: `${pct}%` }} />
      </div>
      <div ref={popupRef} className="pl-perform-popup" style={{ display: 'none', transform: 'translateX(-50%)' }} />
    </div>
  );
};

const MuteSolo = ({ nodeId, isMaster, pinIdx }: { nodeId: string, isMaster: boolean, pinIdx?: number }) => {
  const muteParam = isMaster ? 'muted' : `mute${pinIdx}`;
  const soloParam = isMaster ? '' : `solo${pinIdx}`;
  
  const muteVal = useApp(s => s.design.nodes.find(n => n.id === nodeId)?.params?.[muteParam] ?? 0);
  // hook is unconditional (rules-of-hooks law); the master case resolves to 0 inside the selector
  const soloVal = useApp(s => soloParam ? (s.design.nodes.find(n => n.id === nodeId)?.params?.[soloParam] ?? 0) : 0);

  const setParam = useApp(s => s.setParam);

  return (
    <div className="pl-perform-mutes">
      {!isMaster && (
        <button
          className={['pl-perform-mute-btn', soloVal > 0.5 ? 'is-soloed' : ''].join(' ')}
          title="Solo"
          aria-pressed={soloVal > 0.5}
          onClick={() => setParam(nodeId, soloParam, soloVal > 0.5 ? 0 : 1)}
        >
          S
        </button>
      )}
      <button
        className={['pl-perform-mute-btn', muteVal > 0.5 ? 'is-muted' : ''].join(' ')}
        title="Mute"
        aria-pressed={muteVal > 0.5}
        onClick={() => setParam(nodeId, muteParam, muteVal > 0.5 ? 0 : 1)}
      >
        M
      </button>
    </div>
  );
};

const StripMeter = ({ nodeId, slot, analyserKey }: { nodeId: string, slot: string, analyserKey?: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    if (canvasRef.current) {
      meterService.attachCanvas(nodeId, canvasRef.current, slot, analyserKey);
    }
    return () => {
      meterService.attachCanvas(nodeId, null, slot, analyserKey);
    };
  }, [nodeId, slot, analyserKey]);
  
  return (
    <div className="pl-perform-meter-area">
      <div className="pl-perform-meter-label">{analyserKey ? 'POST' : 'PRE'}</div>
      <canvas ref={canvasRef} className="pl-perform-meter-canvas" width={56} height={8} />
    </div>
  );
};

export function PerformView() {
  const setPerformOpen = useApp(s => s.setPerformOpen);
  const nodes = useApp(s => s.design.nodes);
  const wires = useApp(s => s.design.wires);
  const transport = useApp(s => s.transport);
  const toggleTransport = useApp(s => s.toggleTransport);
  const designName = useApp(s => s.design.name);
  const audioRunning = useApp(s => s.audioRunning);
  const setAudioRunning = useApp(s => s.setAudioRunning);
  const showToast = useApp(s => s.showToast);

  // the performer's panic switch: transport stop only halts triggers/sequencing,
  // free-running sources keep sounding — this mirrors the TopBar Audio pill so
  // ALL sound can be killed without leaving Perform
  const toggleAudio = async () => {
    if (audioRunning) {
      await engine.suspend();
      setAudioRunning(false);
    } else {
      const ok = await engine.start(useApp.getState().design);
      setAudioRunning(ok);
    }
  };

  type Strip =
    | { key: string; type: 'mixer'; nodeId: string; sourceId: string; pinIdx: number; primaryLabel: string; secondaryLabel: string }
    | { key: string; type: 'master'; nodeId: string; primaryLabel: string; secondaryLabel: string };
  const strips: Strip[] = [];

  // mixer-input strips first (design order), THEN masters — never interleaved
  for (const n of nodes) {
    if (n.type !== 'mixer') continue;
    for (let i = 1; i <= 4; i++) {
      const pinId = `in${i}`;
      const wire = wires.find(w => w.to.nodeId === n.id && w.to.pinId === pinId);
      if (wire) {
        const sourceNode = nodes.find(sn => sn.id === wire.from.nodeId);
        if (sourceNode) {
          strips.push({
            key: `mixer-${n.id}-${pinId}`,
            type: 'mixer',
            nodeId: n.id,
            sourceId: sourceNode.id,
            pinIdx: i,
            primaryLabel: sourceNode.label,
            secondaryLabel: `${n.label} · Input ${i}`
          });
        }
      }
    }
  }
  for (const n of nodes) {
    if (n.type !== 'master_out') continue;
    strips.push({
      key: `master-${n.id}`,
      type: 'master',
      nodeId: n.id,
      primaryLabel: n.label,
      secondaryLabel: 'Main Output'
    });
  }

  useEffect(() => {
    const handleUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const target = e.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        setPerformOpen(false);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('keydown', handleKey);
    };
  }, [setPerformOpen]);

  const exitRef = useRef<HTMLDivElement>(null);
  const exitState = useRef({
    held: false,
    start: 0,
    raf: 0
  });

  // a hold interrupted by unmount (e.g. Esc mid-hold) must not leave a live rAF
  // that could close a re-opened Perform view at the 800ms mark
  useEffect(() => () => {
    exitState.current.held = false;
    cancelAnimationFrame(exitState.current.raf);
  }, []);

  const stopExit = (fromPointerUp: boolean) => {
    const wasHeld = exitState.current.held;
    const elapsed = performance.now() - exitState.current.start;
    exitState.current.held = false;
    cancelAnimationFrame(exitState.current.raf);
    if (exitRef.current) {
      exitRef.current.style.setProperty('--exit-progress', '0%');
      exitRef.current.classList.remove('pl-perform-exit-pulse');
    }
    // a quick TAP on the exit control is the natural first gesture — teach the hold
    if (fromPointerUp && wasHeld && elapsed < 300) {
      showToast('Hold ✕ to exit — or press Esc');
    }
  };

  const startExit = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    exitState.current.held = true;
    exitState.current.start = performance.now();
    if (exitRef.current) exitRef.current.classList.add('pl-perform-exit-pulse');
    const tick = (now: number) => {
      if (!exitState.current.held) return;
      const progress = Math.min(1, (now - exitState.current.start) / 800);
      if (exitRef.current) exitRef.current.style.setProperty('--exit-progress', `${progress * 100}%`);
      if (progress >= 1) {
        setPerformOpen(false);
      } else {
        exitState.current.raf = requestAnimationFrame(tick);
      }
    };
    exitState.current.raf = requestAnimationFrame(tick);
  };

  return (
    <div className="pl-perform-overlay">
      <div className="pl-perform-header">
        <div className="pl-perform-design-name">{designName}</div>
        <button 
          className="pl-btn"
          style={{ color: transport.playing ? 'var(--signal-1)' : undefined }}
          onClick={toggleTransport}
          aria-label={transport.playing ? 'Stop transport' : 'Play transport'}
        >
          {transport.playing ? '■' : '▶'}
        </button>
        <div className="pl-perform-bpm">{transport.bpm} BPM</div>
        <button
          className="pl-btn"
          style={{ color: audioRunning ? 'var(--signal-1)' : undefined }}
          onClick={toggleAudio}
          aria-label={audioRunning ? 'Stop all audio' : 'Start audio'}
          title={audioRunning ? 'Audio is ON — click to stop ALL sound' : 'Start audio'}
        >
          {audioRunning ? '● AUDIO' : '○ AUDIO'}
        </button>
        <div style={{ flex: 1 }} />
        <div
          className="pl-perform-exit-btn"
          role="button"
          tabIndex={0}
          aria-label="Hold to exit Perform (or press Esc)"
          title="Hold to exit (Esc)"
          onPointerDown={startExit}
          onPointerUp={() => stopExit(true)}
          onPointerCancel={() => stopExit(false)}
          onPointerLeave={() => stopExit(false)}
        >
          ✕
          <div ref={exitRef} className="pl-perform-exit-progress" style={{ '--exit-progress': '0%' } as any} />
        </div>
      </div>
      {strips.length === 0 ? (
        <div className="pl-perform-empty">Patch a Mixer or Master Output to perform.</div>
      ) : (
        <div className="pl-perform-strip-container">
          {strips.map(s => (
            <div key={s.key} className="pl-perform-strip">
              <div className="pl-perform-strip-labels">
                <div className="pl-perform-strip-primary" title={s.primaryLabel}>{s.primaryLabel}</div>
                <div className="pl-perform-strip-secondary" title={s.secondaryLabel}>{s.secondaryLabel}</div>
              </div>
              <Fader
                nodeId={s.nodeId}
                paramId={s.type === 'mixer' ? `lvl${s.pinIdx}` : 'level'}
                dbMin={-60}
                dbMax={s.type === 'mixer' ? 12 : 0}
                defaultVal={s.type === 'mixer' ? 0 : -6}
              />
              {s.type === 'mixer' && <PanMini nodeId={s.nodeId} pinIdx={s.pinIdx} />}
              <MuteSolo nodeId={s.nodeId} isMaster={s.type === 'master'} pinIdx={s.type === 'mixer' ? s.pinIdx : undefined} />
              <StripMeter 
                nodeId={s.type === 'mixer' ? s.sourceId : s.nodeId}
                slot={s.type === 'mixer' ? `perform:${s.nodeId}:in${s.pinIdx}` : 'perform'}
                analyserKey={s.type === 'master' ? 'main' : undefined}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
