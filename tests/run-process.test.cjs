const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const runNode = async (source, options = {}) => {
  const { runProcess } = await import('../dist/scripts/run-process.mjs');
  return runProcess({
    command: process.execPath,
    args: ['--eval', source],
    timeoutMs: 10_000,
    stdio: 'ignore',
    ...options,
  });
};

test('child process runner preserves successful and unsuccessful exit codes', async () => {
  assert.equal(await runNode('process.exit(0)'), 0);
  assert.equal(await runNode('process.exit(7)'), 7);
});

test('child process runner reports spawn failures without waiting for the deadline', async () => {
  const { runProcess } = await import('../dist/scripts/run-process.mjs');
  await assert.rejects(
    runProcess({
      command: path.join(__dirname, 'missing-executable'),
      args: [],
      timeoutMs: 10_000,
      stdio: 'ignore',
    }),
    { code: 'ENOENT' },
  );
});

test('a timed-out child cannot turn termination into a successful test', async () => {
  const { ProcessTimeoutError } = await import('../dist/scripts/run-process.mjs');
  await assert.rejects(
    runNode("process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);", {
      timeoutMs: 250,
    }),
    ProcessTimeoutError,
  );
});

test('a hanging child is forcibly stopped even if it ignores graceful termination', async () => {
  const { ProcessTimeoutError } = await import('../dist/scripts/run-process.mjs');
  await assert.rejects(
    runNode("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);", {
      timeoutMs: 250,
    }),
    ProcessTimeoutError,
  );
});
