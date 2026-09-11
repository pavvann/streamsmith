/**
 * GET /api/state — the one read the screen makes. Read-only by construction: it returns what
 * `loadState()` found (the agent's state service, or the snapshot file it writes each cycle) and
 * has no path to a signing key.
 */
import {NextResponse} from 'next/server';
import {loadState} from '../../../lib/state';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const state = await loadState();
  return NextResponse.json(state, {headers: {'cache-control': 'no-store'}});
}
