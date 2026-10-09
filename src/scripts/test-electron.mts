import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electronExport from 'electron';
// Under Node the Electron package exports its executable path. In Electron it
// exports an API object; verify the runtime contract before starting a child.
const electron: unknown = electronExport;
if (typeof electron !== 'string') {
  throw new Error('Run the smoke launcher with Node.js');
}

const profile = await mkdtemp(path.join(tmpdir(), 'foodguide-app-test-'));
try {
  const child = spawn(
    electron,
    [path.join(import.meta.dirname, '../../tests/electron-smoke.cjs')],
    {
      stdio: 'inherit',
      env: { ...process.env, FOODGUIDE_TEST_PROFILE: profile },
    },
  );
  const timeout = setTimeout(() => child.kill(), 60_000);
  try {
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally {
    clearTimeout(timeout);
  }
} finally {
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
