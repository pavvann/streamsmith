'use client';

/**
 * Who this is and how fresh it is. Three stamps carry the only three facts a treasurer checks
 * before reading anything else: whether the agent can send, where the numbers came from, and
 * whether the wallet side is live. The timestamps cross-fade on every refresh.
 */
import {Stamp} from './ui';
import type {Snap} from './types';

export function Masthead({
  snap,
  origin,
  readAt,
  refreshing,
  onRefresh,
}: {
  snap: Snap;
  origin: string;
  readAt: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const {mode, decision} = snap;
  const source = mode.source;
  return (
    <header className="masthead seq">
      <div>
        <h1>Vaultpilot</h1>
        <p className="tagline">Idle USDC, moved only inside the treasurer&apos;s policy.</p>
      </div>
      <div className="masthead-status">
        <div className="stamp-row">
          <Stamp tone={mode.dryRun ? 'warn' : 'go'}>
            {mode.dryRun ? 'Dry run · nothing is sent' : 'Execute'}
          </Stamp>
          <Stamp tone="quiet" title={`${source.kind} · database ${source.database}${source.note ? ` · ${source.note}` : ''}`}>
            {source.origin}
            {source.readOnly ? ' · read-only' : ''}
          </Stamp>
          <Stamp tone={mode.privy === 'live' ? 'go' : 'warn'}>Privy {mode.privy}</Stamp>
        </div>
        <p className="stampline crossfade" key={`${decision.decidedAt}|${readAt}`}>
          decided {decision.decidedAt} · read {readAt} · via {origin}
        </p>
        <button type="button" className="textbtn" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Reading…' : 'Refresh'}
        </button>
      </div>
    </header>
  );
}
