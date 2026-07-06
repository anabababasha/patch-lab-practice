import { useRef } from 'react';
import { useApp } from '../app/store';
import { engine } from '../audio/engine';
import { version } from '../../package.json';

export function TopBar() {
  const name = useApp((s) => s.design.name);
  const setName = useApp((s) => s.setName);
  const audioRunning = useApp((s) => s.audioRunning);
  const setAudioRunning = useApp((s) => s.setAudioRunning);
  const transport = useApp((s) => s.transport);
  const setBpm = useApp((s) => s.setBpm);
  const sessionSync = useApp((s) => s.design.settings?.sync ?? false);
  const setSessionSync = useApp((s) => s.setSessionSync);
  const toggleTransport = useApp((s) => s.toggleTransport);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const selectAll = useApp((s) => s.selectAll);
  const canUndo = useApp((s) => s.canUndo);
  const canRedo = useApp((s) => s.canRedo);
  const newDesign = useApp((s) => s.newDesign);
  const exportJson = useApp((s) => s.exportJson);
  const importJson = useApp((s) => s.importJson);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggleAudio = async () => {
    if (audioRunning) {
      await engine.suspend();
      setAudioRunning(false);
    } else {
      const ok = await engine.start(useApp.getState().design);
      setAudioRunning(ok);
    }
  };

  const doExport = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.trim().replace(/\s+/g, '-').toLowerCase() || 'design'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    importJson(await file.text());
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <header className="pl-topbar">
      <span className="pl-brand">
        Patch<span className="pl-brand__accent">Lab</span>
      </span>
      <input
        className="pl-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Design name"
        spellCheck={false}
      />
      <div className="pl-topbar__spacer" />
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginRight: '16px' }}>
        <span style={{
          fontFamily: 'monospace',
          fontSize: '10px',
          color: 'var(--text-disabled)',
          opacity: 0.6
        }}>
          v{version} &middot; {import.meta.env.DEV ? `dev ${(__BUILD_TIME__ as string)}` : import.meta.env.VITE_GIT_HASH || 'prod'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button 
          className="pl-btn"
          style={{ color: transport.playing ? 'var(--signal-1)' : undefined }}
          onClick={toggleTransport}
          aria-label={transport.playing ? 'Stop transport' : 'Play transport'}
        >
          {transport.playing ? '■' : '▶'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: 'var(--text-disabled)', fontSize: '11px' }}>BPM</span>
          <input
            type="number"
            value={transport.bpm}
            min={40} max={240}
            onChange={e => setBpm(Number(e.target.value))}
            style={{ width: '48px', background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text-primary)', font: '450 12px var(--font-data)', borderRadius: '4px', padding: '2px 4px', textAlign: 'center' }}
            aria-label="BPM"
          />
        </div>
        <button
          className={['pl-mini-btn', 'pl-sync-chip', sessionSync ? 'is-on' : ''].join(' ')}
          aria-pressed={sessionSync}
          onClick={() => setSessionSync(!sessionSync)}
          title="Session tempo sync — the default for params on Auto"
        >
          Sync
        </button>
      </div>
      </div>
      <button
        className={['pl-start', audioRunning ? 'is-running' : ''].join(' ')}
        onClick={toggleAudio}
      >
        {audioRunning ? '● Audio running' : 'Start Audio ▸'}
      </button>
      <button 
        className="pl-btn" 
        onClick={undo} 
        disabled={!canUndo}
        style={{ cursor: canUndo ? 'pointer' : 'default', color: canUndo ? '' : 'var(--text-disabled)' }}
        title="Undo (Ctrl/Cmd+Z)"
      >
        Undo
      </button>
      <button 
        className="pl-btn" 
        onClick={redo} 
        disabled={!canRedo}
        style={{ cursor: canRedo ? 'pointer' : 'default', color: canRedo ? '' : 'var(--text-disabled)' }}
        title="Redo (Ctrl/Cmd+Shift+Z)"
      >
        Redo
      </button>
      <button className="pl-btn" onClick={selectAll} title="Select All (Ctrl/Cmd+A)">
        Select All
      </button>
      <button className="pl-btn" onClick={newDesign}>
        New
      </button>
      <button className="pl-btn" onClick={doExport}>
        Export
      </button>
      <button className="pl-btn" onClick={() => fileRef.current?.click()}>
        Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => doImport(e.target.files?.[0])}
      />
    </header>
  );
}
