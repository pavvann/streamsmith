// Injectable command execution. Every external process Streamsmith spawns goes through a Runner
// so tests can substitute fixtures without touching substreams/buf/cargo.
import { spawn } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** When set, stdout is streamed to this file instead of being buffered (used for jsonl runs). */
  stdoutFile?: string;
  timeoutMs?: number;
  /** Also echo child stderr to our own stderr while running (long builds). */
  echoStderr?: boolean;
}

export interface RunResult {
  command: string;
  code: number;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface Runner {
  run(cmd: string, args: string[], opts?: RunOptions): Promise<RunResult>;
}

export function formatCommand(cmd: string, args: string[]): string {
  return [cmd, ...args].map((a) => (/[\s"'$&|<>]/.test(a) ? JSON.stringify(a) : a)).join(" ");
}

const MAX_BUFFER = 50 * 1024 * 1024;

export class ProcessRunner implements Runner {
  async run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
    const started = Date.now();
    let out: WriteStream | undefined;
    if (opts.stdoutFile) {
      await mkdir(dirname(opts.stdoutFile), { recursive: true });
      out = createWriteStream(opts.stdoutFile);
    }
    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = opts.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, opts.timeoutMs)
        : undefined;
      child.stdout.on("data", (d: Buffer) => {
        if (out) out.write(d);
        else if (stdout.length < MAX_BUFFER) stdout += d.toString("utf8");
      });
      child.stderr.on("data", (d: Buffer) => {
        if (stderr.length < MAX_BUFFER) stderr += d.toString("utf8");
        if (opts.echoStderr) process.stderr.write(d);
      });
      child.on("error", (err) => {
        if (timer) clearTimeout(timer);
        out?.end();
        // ENOENT and friends: surface as a non-zero result rather than a throw so callers report evidence.
        resolve({
          command: formatCommand(cmd, args),
          code: 127,
          signal: null,
          stdout,
          stderr: `${stderr}\n${(err as Error).message}`.trim(),
          durationMs: Date.now() - started,
          timedOut,
        });
      });
      child.on("close", (code, signal) => {
        if (timer) clearTimeout(timer);
        const finish = () =>
          resolve({
            command: formatCommand(cmd, args),
            code: code ?? (signal ? 128 : 1),
            signal,
            stdout,
            stderr,
            durationMs: Date.now() - started,
            timedOut,
          });
        if (out) out.end(finish);
        else finish();
      });
      child.on("spawn", () => {
        /* no-op; kept for symmetry */
      });
      if (!child.pid && !child.killed) {
        // spawn failed synchronously; 'error' will fire.
      }
      void reject;
    });
  }
}

/**
 * Test double: matches commands by predicate and returns canned results. Can also write a fixture
 * file to `stdoutFile` so jsonl-producing commands behave like the real thing.
 */
export interface FakeRule {
  match: (cmd: string, args: string[]) => boolean;
  result?: Partial<RunResult>;
  stdoutFileContent?: string;
  onCall?: (cmd: string, args: string[], opts: RunOptions) => void | Promise<void>;
}

export class FakeRunner implements Runner {
  public calls: Array<{ cmd: string; args: string[]; opts: RunOptions }> = [];
  constructor(private rules: FakeRule[] = []) {}
  add(rule: FakeRule): this {
    this.rules.push(rule);
    return this;
  }
  async run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
    this.calls.push({ cmd, args, opts });
    const rule = this.rules.find((r) => r.match(cmd, args));
    if (!rule) {
      return {
        command: formatCommand(cmd, args),
        code: 127,
        signal: null,
        stdout: "",
        stderr: `FakeRunner: no rule for ${formatCommand(cmd, args)}`,
        durationMs: 0,
        timedOut: false,
      };
    }
    if (rule.onCall) await rule.onCall(cmd, args, opts);
    if (opts.stdoutFile && rule.stdoutFileContent !== undefined) {
      await mkdir(dirname(opts.stdoutFile), { recursive: true });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(opts.stdoutFile, rule.stdoutFileContent);
    }
    return {
      command: formatCommand(cmd, args),
      code: 0,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 1,
      timedOut: false,
      ...(rule.result ?? {}),
    };
  }
}
