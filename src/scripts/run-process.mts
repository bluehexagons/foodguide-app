import { spawn } from 'node:child_process';

interface ProcessOptions {
  command: string;
  args: string[];
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  stdio?: 'inherit' | 'ignore';
}

export class ProcessTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Child process exceeded its ${timeoutMs}-millisecond deadline`);
    this.name = 'ProcessTimeoutError';
  }
}

/** Preserve exit codes and make timeout or startup failures fail the caller. */
export async function runProcess({
  command,
  args,
  timeoutMs,
  env,
  stdio = 'inherit',
}: ProcessOptions): Promise<number> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('A process deadline must be a positive finite number');
  }
  const child = spawn(command, args, { env, stdio });
  let timedOut = false;
  const timeout = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    timedOut = true;
    // A child can handle SIGTERM and exit successfully or keep running.
    // Force termination and report a timeout independently of its exit status.
    child.kill('SIGKILL');
  }, timeoutMs);
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => {
        if (timedOut) {
          reject(new ProcessTimeoutError(timeoutMs));
        } else {
          resolve(code ?? 1);
        }
      });
    });
  } finally {
    clearTimeout(timeout);
  }
}
