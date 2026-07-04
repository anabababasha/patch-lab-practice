import { useRef } from 'react';
import { useApp } from '../app/store';
import { engine } from '../audio/engine';

export function TopBar() {
  const name = useApp((s) => s.design.name);
  const setName = useApp((s) => s.setName);
  const audioRunning = useApp((s) => s.audioRunning);
  const setAudioRunning = useApp((s) => s.setAudioRunning);
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
