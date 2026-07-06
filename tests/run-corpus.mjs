import { spawn } from 'node:child_process';

const previewUrl = 'http://127.0.0.1:4173/patch-lab-practice/';
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCmd = process.execPath;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function waitForPreview() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(previewUrl);
      if (res.ok) return;
    } catch {
      /* server still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('vite preview did not become ready');
}

function stop(child) {
  if (!child.killed) child.kill();
}

const buildCode = await run(npmCmd, ['run', 'build'], {
  shell: process.platform === 'win32',
});
if (buildCode !== 0) process.exit(buildCode);

const preview = spawn(
  nodeCmd,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
  { stdio: 'inherit' },
);

let exitCode = 1;
try {
  await waitForPreview();
  exitCode = await run(
    nodeCmd,
    ['node_modules/playwright/cli.js', 'test'],
    { env: { ...process.env, PATCHLAB_EXTERNAL_PREVIEW: '1' } },
  );
} finally {
  stop(preview);
}

process.exit(exitCode);
