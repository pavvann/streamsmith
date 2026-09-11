'use client';

/**
 * What actually happened, from the append-only ledger the agent writes: every allow and every deny,
 * and the transactions (if any) those allows produced. The empty state is a sentence, because "no
 * transactions" is a fact about how this wallet is funded, not a missing value.
 */
import {Eyebrow, Hash, Mono, Reading, Stamp} from './ui';
import type {LedgerRow, Snap} from './types';

function tone(status: string | null): 'go' | 'deny' | 'warn' {
  if (status === 'succeeded') return 'go';
  if (status === 'denied' || status === 'rejected' || status === 'failed') return 'deny';
  return 'warn';
}

export function Ledger({snap, readAt, origin, originDetail}: {snap: Snap; readAt: string; origin: string; originDetail: string}) {
  const txEntries = snap.ledger.recent.filter((e) => e.txHashes.length > 0);
  return (
    <section className="grid seq" style={{animationDelay: '480ms'}}>
      <div className="c7">
        <Eyebrow>From the ledger</Eyebrow>
        <h2 className="title" style={{marginTop: 6}}>
          Policy outcomes
        </h2>
        {snap.ledger.recent.length === 0 ? (
          <p className="prose" style={{marginTop: 14}}>
            No Earn action has been attempted yet, so the ledger has nothing to show.
          </p>
        ) : (
          <ul className="timeline" style={{marginTop: 10}}>
            {snap.ledger.recent.map((e) => (
              <Outcome key={e.id} entry={e} />
            ))}
          </ul>
        )}
        {snap.ledger.alerts.length > 0 ? (
          <ul className="refusals" style={{marginTop: 18}}>
            {snap.ledger.alerts.slice(-3).map((a) => (
              <li key={a.id}>
                <span className="dot" aria-hidden="true" />
                <span>
                  <code>alert</code> <Mono>{a.note ?? 'an open alert with no note'}</Mono>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="c5">
        <Eyebrow>On Base</Eyebrow>
        <h2 className="title" style={{marginTop: 6}}>
          Transactions
        </h2>
        {txEntries.length === 0 ? (
          <p className="prose" style={{marginTop: 14}}>
            No transaction yet. The business wallet is funded by a human; the agent only moves what is already in the
            two approved vaults.
          </p>
        ) : (
          <div style={{marginTop: 10}}>
            {txEntries.flatMap((e) =>
              e.txHashes.map((h) => (
                <div className="txline" key={h}>
                  <span className="value">
                    {e.kind} · {e.vaultLabel ?? e.vaultId ?? 'unnamed vault'}
                  </span>
                  <a className="mono" href={`https://basescan.org/tx/${h}`} target="_blank" rel="noreferrer" title={h}>
                    {h.slice(0, 10)}…{h.slice(-6)}
                  </a>
                </div>
              )),
            )}
          </div>
        )}

        <div className="footline" style={{marginTop: 24}}>
          <p className="prose sm muted" style={{margin: 0}}>
            Read {readAt} from the {origin}.
          </p>
          <p style={{margin: 0}}>
            <Mono title={originDetail}>{originDetail}</Mono>
          </p>
          <p className="prose sm muted" style={{margin: 0}}>
            Ledger: {snap.ledger.entryCount} entries.
          </p>
          <p style={{margin: 0}}>
            <Mono title={snap.ledger.path}>{snap.ledger.path}</Mono>
          </p>
          {snap.errors.length > 0 ? (
            <ul className="refusals" style={{marginTop: 6}}>
              {snap.errors.map((err) => (
                <li key={err}>
                  <span className="dot" aria-hidden="true" />
                  <span>
                    <code>note</code> <Mono>{err}</Mono>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Outcome({entry}: {entry: LedgerRow}) {
  const t = tone(entry.status);
  return (
    <li>
      <span className={`dot ${t}`} aria-hidden="true" />
      <div>
        <div className="what">
          <span className="name">{entry.kind}</span>
          {entry.vaultLabel ? <span className="value">· {entry.vaultLabel}</span> : null}
          <Stamp tone={t}>{entry.status ?? 'no status recorded'}</Stamp>
          {entry.dryRun ? <Stamp tone="quiet">dry run</Stamp> : null}
        </div>
        <p style={{margin: '4px 0 0'}}>
          <Mono>{entry.at}</Mono>
          {entry.idempotencyKey ? (
            <>
              {' · '}
              <Hash value={entry.idempotencyKey} label="the idempotency key of this entry" head={12} tail={6} copy={false} />
            </>
          ) : null}
        </p>
        {entry.note ? (
          <p style={{margin: '6px 0 0'}}>
            <Mono>{entry.note}</Mono>
          </p>
        ) : null}
        {entry.error ? (
          <p style={{margin: '4px 0 0'}}>
            <Mono>{entry.error}</Mono>
          </p>
        ) : null}
      </div>
      <span className="amount">
        {entry.amountNormalized !== null ? (
          <Reading size={18}>{entry.amountNormalized}</Reading>
        ) : (
          <span className="label">no amount</span>
        )}
      </span>
    </li>
  );
}
