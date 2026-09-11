/**
 * The UI is a single dynamic page; nothing is prerendered, because everything on the screen is a
 * live reading of the sink, the wallet and the ledger. `outputFileTracingRoot` points at the
 * package so Next stops guessing which lockfile in the monorepo is the root.
 */
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  outputFileTracingRoot: resolve(here, '..'),
  reactStrictMode: true,
  eslint: {ignoreDuringBuilds: true},
};
