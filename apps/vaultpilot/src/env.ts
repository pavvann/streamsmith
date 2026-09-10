/**
 * Minimal .env loader (no dependency). Reads `apps/vaultpilot/.env` and then the repo root `.env`
 * (the root file holds the ClickHouse credentials shared with the sink and the MCP) and populates
 * process.env without overriding variables already set in the shell. First writer wins, so the
 * app-local file takes precedence over the root file.
 */
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const APP_DIR = resolve(here, '..');
export const REPO_ROOT = resolve(here, '..', '..', '..');
export const ENV_FILE = resolve(APP_DIR, '.env');
export const ROOT_ENV_FILE = resolve(REPO_ROOT, '.env');

function loadFile(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  loadFile(ENV_FILE);
  loadFile(ROOT_ENV_FILE);
}

export const REQUIRED_ENV = [
  'PRIVY_APP_ID',
  'PRIVY_APP_SECRET',
  'PRIVY_AUTH_KEY',
  'PRIVY_AGENT_AUTH_KEY',
  'PRIVY_VAULT_ID_GAUNTLET',
  'PRIVY_VAULT_ID_STEAKHOUSE',
] as const;

export const OPTIONAL_ENV = [
  'PRIVY_VAULT_ID_UNAPPROVED',
  'PRIVY_TREASURER_KEY_ID',
  'PRIVY_AGENT_KEY_ID',
  'VAULTPILOT_PER_ACTION_CAP_USD',
  'VAULTPILOT_DAILY_CAP_USD',
  'VAULTPILOT_MIN_OBSERVATION_HOURS',
  'VAULTPILOT_MIN_DIFFERENTIAL_BPS',
  'VAULTPILOT_COOLDOWN_HOURS',
  'VAULTPILOT_OUTFLOW_GUARDRAIL_BPS',
  'VAULTPILOT_MAX_LAG_BLOCKS',
  'VAULTPILOT_SOURCE',
  'VAULTPILOT_FIXTURE',
  'VAULTPILOT_WATCH_MINUTES',
  'VAULTPILOT_AGENT_URL',
  'VAULTPILOT_SERVE_PORT',
  'BASE_RPC_URL',
  'CLICKHOUSE_URL',
  'CLICKHOUSE_USER',
  'CLICKHOUSE_PASSWORD',
  'CLICKHOUSE_DATABASE',
  'CH_CLOUD_URL',
  'CH_CLOUD_RO_USER',
  'CH_CLOUD_RO_PASSWORD',
  'CH_CLOUD_DATABASE',
  'MCP_MANIFEST_PATH',
  'MCP_RECEIPT_PATH',
] as const;

export type RequiredEnvKey = (typeof REQUIRED_ENV)[number];
export type OptionalEnvKey = (typeof OPTIONAL_ENV)[number];

/** Returns the names of required variables that are unset or empty. */
export function missingEnv(): RequiredEnvKey[] {
  loadEnv();
  return REQUIRED_ENV.filter((k) => !process.env[k] || process.env[k]!.trim() === '');
}

export function env(key: RequiredEnvKey): string {
  loadEnv();
  const v = process.env[key];
  if (!v || v.trim() === '') throw new Error(`Missing required env var ${key} (see .env.example)`);
  return v.trim();
}

export function envOptional(key: OptionalEnvKey): string | undefined {
  loadEnv();
  const v = process.env[key];
  return v && v.trim() !== '' ? v.trim() : undefined;
}

export function envNumber(key: OptionalEnvKey, fallback: number): number {
  const raw = envOptional(key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number, got ${JSON.stringify(raw)}`);
  return n;
}

export function envFlag(key: OptionalEnvKey, fallback: boolean): boolean {
  const raw = envOptional(key);
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}
