'use client';

/**
 * The one screen. Everything on it is a fact the agent recorded: position, the two observed
 * windows with their exact block ranges, share-value growth and the differential, the decision and
 * the rule that produced it, the policy and the latest allow/deny outcomes, the pipeline
 * provenance from the generated MCP's `pipeline_status` shape, transaction links, and who controls
 * the wallet plus the command that revokes the agent.
 *
 * It re-reads /api/state every 20 seconds and holds no signing key of any kind.
 */
import {useCallback, useEffect, useState} from 'react';
import type {LoadedState} from '../lib/state';

type Refusal = {code: string; message: string};

export default function Dashboard({initial}: {initial: LoadedState}) {
  const [state, setState] = useState<LoadedState>(initial);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/state', {cache: 'no-store'});
      if (res.ok) setState((await res.json()) as LoadedState);
    } catch {
      // keep the last good screen rather than blanking it
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const s = state.snapshot;
  if (!s) {
    return (
      <main className="wrap">
        <header className="top">
          <h1>Vaultpilot</h1>
          <span className="sub">no state yet</span>
        </header>
        <section className="panel">
          <h2>Nothing to show</h2>
          <p className="empty">{state.error}</p>
          <pre className="cmd">cd apps/vaultpilot &amp;&amp; pnpm agent:once</pre>
        </section>
      </main>
    );
  }

  const d = s.decision;
  const ev = d.evidence;
  const growthByVault = new Map(
    [ev.growthA, ev.growthB].filter(Boolean).map((g) => [g!.vaultId, g!]),
  );
  const windowByVault = new Map(ev.observedWindow.vaults.map((w) => [w.vaultId, w]));
  const guardrailByVault = new Map(ev.guardrail.evaluated.map((g) => [g.vaultId, g]));
  const txEntries = s.ledger.recent.filter((e) => e.txHashes.length > 0);

  return (
    <main className="wrap">
      <header className="top">
        <h1>Vaultpilot</h1>
        <span className={`tag ${s.mode.dryRun ? 'warn' : 'stop'}`}>
          {s.mode.dryRun ? 'DRY RUN — nothing is sent' : 'EXECUTE'}
        </span>
        <span className="sub">
          decided {d.decidedAt} · data {s.mode.source.kind} ({s.mode.source.origin}) · Privy {s.mode.privy} · via{' '}
          {state.origin}
        </span>
        <span style={{marginLeft: 'auto'}}>
          <button className="refresh" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? 'reading…' : 'refresh'}
          </button>
        </span>
      </header>

      <div className="grid" style={{marginBottom: 12}}>
        <section className="panel">
          <h2>Decision</h2>
          <div className={`decision ${d.action}`}>
            <div className="verdict">{d.action}</div>
            <div className="rule">{d.reason}</div>
          </div>
          <dl className="kv" style={{marginTop: 10}}>
            <dt>rule</dt>
            <dd>
              rotate when observed-window share-value growth differs by more than{' '}
              {s.config.minDifferentialBps} bps, with ≥ {s.config.minObservationHours} h observed on both vaults, a{' '}
              {s.config.cooldownHours} h cooldown, a {ev.guardrail.limitBps} bps destination outflow guardrail (our own
              flows excluded), a staleness refusal above {s.config.maxLagBlocks} blocks of lag, and one action per
              observation block
            </dd>
            <dt>differential</dt>
            <dd>{ev.differentialBps === null ? 'not computable' : `${ev.differentialBps} bps`}</dd>
            <dt>amount</dt>
            <dd>{d.amountNormalized ?? '—'}</dd>
            <dt>idempotency</dt>
            <dd>{d.idempotencyKey ?? '—'}</dd>
            <dt>cooldown</dt>
            <dd>
              {ev.cooldown.clear ? 'clear' : `${ev.cooldown.hoursSinceLastRotation} h since the last rotation`} · last{' '}
              {ev.cooldown.lastRotationAt ?? 'never'}
            </dd>
          </dl>
          {d.refusals.length > 0 && (
            <ul className="refusals">
              {d.refusals.map((r: Refusal) => (
                <li key={r.code + r.message}>
                  <code>{r.code}</code> {r.message}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Position</h2>
          <table>
            <thead>
              <tr>
                <th>Vault</th>
                <th className="num">Held</th>
                <th>Privy vault id</th>
              </tr>
            </thead>
            <tbody>
              {s.vaults.map((v) => (
                <tr key={v.vaultId}>
                  <td>
                    {v.label}
                    <div className="hash">
                      observed {v.vaultAddress}
                      <br />
                      via wrapper {v.wrapperAddress ?? 'unknown'}
                    </div>
                  </td>
                  <td className="num">
                    {v.position ? `${v.position.assetsNormalized} ${v.position.assetSymbol}` : 'unknown'}
                  </td>
                  <td>
                    {v.vaultId}
                    {d.from === v.vaultId && <div className="tag warn">source</div>}
                    {d.to === v.vaultId && <div className="tag ok">destination</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">{s.policy.wrapperFeeDisclosure}</p>
        </section>
      </div>

      <section className="panel span2" style={{marginBottom: 12}}>
        <h2>Observed window and share-value growth</h2>
        <table>
          <thead>
            <tr>
              <th>Vault</th>
              <th className="num">Observed</th>
              <th>Block range</th>
              <th className="num">Observations</th>
              <th>Share value first → last</th>
              <th className="num">Growth</th>
              <th className="num">24 h net third-party outflow</th>
            </tr>
          </thead>
          <tbody>
            {s.vaults.map((v) => {
              const w = windowByVault.get(v.vaultId);
              const g = growthByVault.get(v.vaultId);
              const guard = guardrailByVault.get(v.vaultId);
              return (
                <tr key={v.vaultId}>
                  <td>{v.label}</td>
                  <td className="num">
                    {w ? `${w.hours} h` : '—'}
                    {w && !w.meetsMinimum && (
                      <div className="tag warn">under {ev.observedWindow.minHoursRequired} h</div>
                    )}
                  </td>
                  <td className="hash">
                    {w ? `${w.firstBlockNumber} → ${w.lastBlockNumber}` : '—'}
                    {w && (
                      <div>
                        {new Date(w.firstBlockTimestamp * 1000).toISOString()} →{' '}
                        {new Date(w.lastBlockTimestamp * 1000).toISOString()}
                      </div>
                    )}
                  </td>
                  <td className="num">{w?.observationCount ?? '—'}</td>
                  <td className="hash">
                    {g ? `${g.firstAssetsPerShareNormalized} → ${g.lastAssetsPerShareNormalized}` : '—'}
                  </td>
                  <td className="num">{g?.growthBps === null || !g ? '—' : `${g.growthBps} bps`}</td>
                  <td className="num">
                    {guard && guard.computable ? `${guard.netOutflowExcludingSelfNormalized} (${guard.outflowBps} bps)` : 'not computable'}
                    {guard?.exceedsLimit && <div className="tag stop">over {ev.guardrail.limitBps} bps</div>}
                    {guard && guard.selfExcludedOutNormalized !== '0' && (
                      <div className="hash">ours excluded: {guard.selfExcludedOutNormalized}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="note">
          Observations are the pipeline&apos;s own <code>convertToAssets</code> samples on the underlying vaults, only
          where the call succeeded, never interpolated. The window is measured on the data, not on the clock.
        </p>
      </section>

      <div className="grid three" style={{marginBottom: 12}}>
        <section className="panel">
          <h2>Policy</h2>
          <dl className="kv">
            <dt>methods</dt>
            <dd>{s.policy.methods.join(', ')}</dd>
            <dt>vault ids</dt>
            <dd>{s.policy.allowedVaultIds.join('\n')}</dd>
            <dt>per action</dt>
            <dd>≤ {s.policy.perActionCapUsd} USD</dd>
            <dt>everything else</dt>
            <dd>denied by default</dd>
            <dt>daily cap</dt>
            <dd>
              {s.policy.dailySpentUsd} of {s.policy.dailyCapUsd} USD used · {s.policy.dailyRemainingUsd} left
            </dd>
          </dl>
          <p className="note">{s.policy.dailyCapDisclosure}</p>
        </section>

        <section className="panel">
          <h2>Pipeline provenance</h2>
          <dl className="kv">
            <dt>status</dt>
            <dd>
              {s.pipelineHealth.refused ? (
                <span className="tag stop">refused: {s.pipelineHealth.reason}</span>
              ) : (
                <span className="tag ok">verified</span>
              )}
            </dd>
            <dt>package</dt>
            <dd>
              {s.provenance.packageName} {s.provenance.packageVersion}
            </dd>
            <dt>packageHash</dt>
            <dd className="hash">{s.provenance.packageHash ?? '—'}</dd>
            <dt>outputModule</dt>
            <dd className="hash">
              {s.provenance.outputModule} @ {s.provenance.outputModuleHash ?? '—'}
            </dd>
            <dt>deployment</dt>
            <dd>
              {s.provenance.deploymentMode ?? '—'} {s.provenance.deploymentId ? `(${s.provenance.deploymentId})` : ''}
            </dd>
            <dt>head / chain</dt>
            <dd>
              {s.pipelineHealth.headBlock ?? '—'} / {s.pipelineHealth.chainHead ?? '—'} · lag{' '}
              {s.pipelineHealth.lagBlocks ?? '—'} (limit {s.config.maxLagBlocks})
            </dd>
            <dt>chain</dt>
            <dd>
              {s.provenance.network ?? '—'} ({s.provenance.chainId ?? '—'})
            </dd>
          </dl>
          {s.pipelineHealth.detail && <p className="note">{s.pipelineHealth.detail}</p>}
        </section>

        <section className="panel">
          <h2>Control and revocation</h2>
          <dl className="kv">
            <dt>wallet</dt>
            <dd className="hash">
              {s.wallet.walletId}
              <br />
              {s.wallet.address}
            </dd>
            <dt>treasurer key</dt>
            <dd className="hash">{s.wallet.treasurerKeyId ?? 'unknown'}</dd>
            <dt>agent signer</dt>
            <dd className="hash">{s.wallet.agentKeyQuorumId ?? 'unknown'}</dd>
            <dt>policy</dt>
            <dd className="hash">{s.wallet.policyId ?? 'unknown'}</dd>
          </dl>
          <p className="note">{s.wallet.control}</p>
          <pre className="cmd">{s.wallet.revocationCommand}</pre>
        </section>
      </div>

      <div className="grid">
        <section className="panel">
          <h2>Latest policy outcomes</h2>
          {s.ledger.recent.length === 0 ? (
            <p className="empty">No Earn action has been attempted yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th className="num">Amount</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {s.ledger.recent.map((e) => (
                  <tr key={e.id}>
                    <td className="hash">{e.at}</td>
                    <td>
                      {e.kind}
                      {e.vaultLabel ? ` · ${e.vaultLabel}` : ''}
                      {e.dryRun && <span className="tag"> dry run</span>}
                    </td>
                    <td className="num">{e.amountNormalized ?? '—'}</td>
                    <td>
                      <span
                        className={`tag ${
                          e.status === 'succeeded' ? 'ok' : e.status === 'denied' || e.status === 'rejected' ? 'stop' : 'warn'
                        }`}
                      >
                        {e.status ?? '—'}
                      </span>
                      {e.note && <div className="hash">{e.note}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.ledger.alerts.length > 0 && (
            <ul className="refusals">
              {s.ledger.alerts.slice(-3).map((a) => (
                <li key={a.id}>
                  <code>alert</code> {a.note}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Transactions</h2>
          {txEntries.length === 0 ? (
            <p className="empty">
              No transaction yet. The business wallet is funded by a human; the agent only moves what is already in the
              two approved vaults.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Basescan</th>
                </tr>
              </thead>
              <tbody>
                {txEntries.flatMap((e) =>
                  e.txHashes.map((h) => (
                    <tr key={h}>
                      <td>
                        {e.kind} · {e.vaultLabel ?? e.vaultId}
                      </td>
                      <td>
                        <a href={`https://basescan.org/tx/${h}`} target="_blank" rel="noreferrer">
                          {h.slice(0, 18)}…{h.slice(-6)}
                        </a>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          )}
          <p className="note">
            State read {state.readAt} from {state.originDetail}. Ledger: {s.ledger.entryCount} entries at{' '}
            {s.ledger.path}.
          </p>
          {s.errors.length > 0 && (
            <ul className="refusals">
              {s.errors.map((e) => (
                <li key={e}>
                  <code>note</code> {e}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
