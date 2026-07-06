import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './design/tokens.css';
import App from './App';
import { ensureGrainWorklet } from './audio/grainWorklet';
import { createGrainDelay } from './audio/units';

import { version } from '../package.json';

// DSP render-test hook (tests/worklets.spec.ts) — exposes already-bundled factories so
// OfflineAudioContext tests exercise the SHIPPED bundle, not dev-mode transforms.
(window as unknown as Record<string, unknown>).__plWorkletTest = {
  ensureGrainWorklet,
  createGrainDelay,
};

const mode = import.meta.env.DEV ? `dev ${__BUILD_TIME__}` : import.meta.env.VITE_GIT_HASH || 'prod';
console.log(`PatchLab v${version} · ${mode}`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
