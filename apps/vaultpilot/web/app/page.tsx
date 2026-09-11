/**
 * The single screen. It renders on the server from the same `loadState()` the /api/state route
 * handler uses, then the client component keeps it current by polling that handler.
 */
import Dashboard from './Dashboard';
import {loadState} from '../lib/state';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function Page() {
  const initial = await loadState();
  return <Dashboard initial={initial} />;
}
