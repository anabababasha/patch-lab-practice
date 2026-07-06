import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './design/tokens.css';
import App from './App';

import { version } from '../package.json';

const mode = import.meta.env.DEV ? `dev ${__BUILD_TIME__}` : import.meta.env.VITE_GIT_HASH || 'prod';
console.log(`PatchLab v${version} · ${mode}`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
