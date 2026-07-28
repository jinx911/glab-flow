import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export function glabHost(): string {
  return process.env.GLAB_FLOW_HOST ?? 'git.kuainiujinke.com';
}

export type GlabRunner = (args: string[]) => Promise<string>;

export const defaultRunner: GlabRunner = async (args) => {
  const { stdout } = await execFileP('glab', args, { maxBuffer: 20 * 1024 * 1024 });
  return stdout;
};

async function runWithRetry(runner: GlabRunner, args: string[], retries = 3): Promise<string> {
  let last: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await runner(args);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw last;
}

/**
 * Run `glab api --hostname <host> --method <M> [--raw-field k=v ...] <path>` and parse JSON.
 * Uses runner DI so tests can mock the subprocess (no real glab/network).
 */
export async function glabApi<T = unknown>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  fields: Record<string, string> = {},
  opts: { host?: string; runner?: GlabRunner } = {},
): Promise<T> {
  const host = opts.host ?? glabHost();
  const runner = opts.runner ?? defaultRunner;
  const args = buildArgs(method, path, fields, host);
  const out = await runWithRetry(runner, args);
  return (out.trim() ? JSON.parse(out) : ({} as T));
}

/** Build the argv without executing — handy for tests/assertions. */
export function buildArgs(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  fields: Record<string, string> = {},
  host: string = glabHost(),
): string[] {
  const args = ['api', '--hostname', host, '--method', method];
  for (const [k, v] of Object.entries(fields)) {
    args.push('--raw-field', `${k}=${v}`);
  }
  args.push(path);
  return args;
}
