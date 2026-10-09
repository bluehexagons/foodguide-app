import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';

const profile = await mkdtemp(path.join(tmpdir(), 'foodguide-app-test-'));
try {
  const child = spawn(electron, [path.join(import.meta.dirname, '../tests/electron-smoke.cjs')], {
    stdio: 'inherit',
    env: { ...process.env, FOODGUIDE_TEST_PROFILE: profile },
  });
  const timeout = setTimeout(() => child.kill(), 60_000);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally {
    clearTimeout(timeout);
  }
} finally {
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
