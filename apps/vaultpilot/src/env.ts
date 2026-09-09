/**
 * Minimal .env loader (no dependency). Reads `apps/vaultpilot/.env` if present and
 * populates process.env without overriding variables already set in the shell.
 */
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ENV_FILE = resolve(here, '..', '.env');

let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  if (!existsSync(ENV_FILE)) return;
  for (const raw of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
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
  'VAULTPILOT_PER_ACTION_CAP_USD',
  'VAULTPILOT_DAILY_CAP_USD',
  'BASE_RPC_URL',
] as const;

export type RequiredEnvKey = (typeof REQUIRED_ENV)[number];

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

export function envOptional(key: (typeof OPTIONAL_ENV)[number]): string | undefined {
  loadEnv();
  const v = process.env[key];
  return v && v.trim() !== '' ? v.trim() : undefined;
}
