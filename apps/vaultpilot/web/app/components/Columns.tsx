'use client';

/**
 * Three quiet columns: what the agent is allowed to do, what the data it acted on is provably made
 * of, and how a human takes the agent's hands off the wallet. The pipeline badge is the stamp of
 * trust — it is the only circle on the page.
 */
import {CopyButton, Eyebrow, Field, Hash, Meter, Reading, Stamp} from './ui';
import type {Snap} from './types';

export function PolicyColumn({snap}: {snap: Snap}) {
  const p = snap.policy;
  return (
    <section className="c4 seq" style={{animationDelay: '300ms'}}>
      <Eyebrow>In force</Eyebrow>
      <h2 className="title" style={{marginTop: 6}}>
        Policy
      </h2>
      <div className="stack" style={{marginTop: 18}}>
        <div className="field">
          <span className="label">Methods</span>
          <span className="stamp-row" style={{marginTop: 2}}>
            {p.methods.map((m) => (
              <Stamp key={m} tone="accent">
                {m}
              </Stamp>
            ))}
          </span>
        </div>
        <div className="field">
          <span className="label">Vault ids</span>
          {p.allowedVaultIds.map((id) => (
            <span className="value" key={id}>
              <Hash value={id} label="the approved vault id" head={8} tail={4} />
            </span>
          ))}
        </div>
        <div className="field">
          <span className="label">Per action</span>
          <span>
            <Reading size={28} unit="USD">
              ≤ {p.perActionCapUsd}
            </Reading>
          </span>
        </div>
        <p className="value" style={{margin: 0}}>
          Everything else: denied by default.
        </p>
        <div className="field">
          <span className="label">Daily cap</span>
          <div style={{marginTop: 4}}>
            <Meter
              value={p.dailySpentUsd}
              limit={p.dailyCapUsd}
              over={p.dailySpentUsd > p.dailyCapUsd}
              label={`${p.dailySpentUsd} of ${p.dailyCapUsd} USD used in the trailing 24 h`}
            />
            <p className="meter-cap value" style={{margin: '6px 0 0'}}>
              {p.dailySpentUsd} of {p.dailyCapUsd} USD used · {p.dailyRemainingUsd} left
            </p>
          </div>
        </div>
      </div>
      <p className="prose sm muted" style={{marginTop: 16}}>
        {p.dailyCapDisclosure}
      </p>
    </section>
  );
}

export function PipelineColumn({snap}: {snap: Snap}) {
  const h = snap.pipelineHealth;
  const pv = snap.provenance;
  const refused = h.refused;
  return (
    <section className="c4 panel seq" style={{animationDelay: '360ms'}}>
      <Eyebrow>Provenance</Eyebrow>
      <h2 className="title" style={{marginTop: 6}}>
        Pipeline
      </h2>
      <div className="badge-row" style={{marginTop: 18}}>
        <span className={refused ? 'badge refused' : 'badge'} role="img" aria-label={refused ? 'refused' : 'verified'}>
          {refused ? (
            <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
              <circle cx="15" cy="15" r="11" fill="none" stroke="var(--deny-ink)" strokeWidth="2.4" />
              <line x1="7.5" y1="22.5" x2="22.5" y2="7.5" stroke="var(--deny-ink)" strokeWidth="2.4" />
            </svg>
          ) : (
            <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
              <path
                d="M7 16.2 L12.4 21.4 L23 8.6"
                fill="none"
                stroke="var(--go-ink)"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        <div>
          <p className="value" style={{margin: 0, fontWeight: 600}}>
            {refused ? `refused: ${h.reason ?? 'unknown'}` : 'verified'}
          </p>
          <p className="prose sm muted" style={{margin: '2px 0 0'}}>
            {refused
              ? 'The agent does not act on data the pipeline will not vouch for.'
              : 'pipeline_status answered, and the sink head is inside the lag limit.'}
          </p>
        </div>
      </div>

      <div className="stack" style={{marginTop: 20}}>
        <Field label="Package">
          {pv.packageName ?? 'not read'} {pv.packageVersion ?? ''}
        </Field>
        <div className="field">
          <span className="label">Output module</span>
          <span className="value">
            {pv.outputModule ?? 'not read'}{' '}
            {pv.outputModuleHash ? <Hash value={pv.outputModuleHash} label="the output module hash" /> : null}
          </span>
        </div>
        <div className="field">
          <span className="label">Package hash</span>
          <span className="value">
            {pv.packageHash ? (
              <Hash value={pv.packageHash} label="the package hash" />
            ) : (
              'the manifest carried no package hash'
            )}
          </span>
        </div>
        <Field label="Deployment">
          {pv.deploymentMode ?? 'not read'}
          {pv.deploymentId ? ` (${pv.deploymentId})` : ''}
        </Field>
        <div className="field">
          <span className="label">Sink lag</span>
          <span>
            <Reading size={28} tone={refused ? 'deny' : 'quiet'} unit="blocks">
              {h.lagBlocks ?? 'unmeasured'}
            </Reading>
          </span>
          <span className="value">
            of {snap.config.maxLagBlocks} allowed · head {h.headBlock ?? 'unknown'} · chain {h.chainHead ?? 'unknown'}
          </span>
        </div>
        <Field label="Chain">
          {pv.network ?? 'not read'} ({pv.chainId ?? h.chainId ?? 'unknown'})
        </Field>
      </div>
      {h.detail ? (
        <p className="prose sm muted" style={{marginTop: 16}}>
          {h.detail}
        </p>
      ) : null}
    </section>
  );
}

export function ControlColumn({snap}: {snap: Snap}) {
  const w = snap.wallet;
  return (
    <section className="c4 seq" style={{animationDelay: '420ms'}}>
      <Eyebrow>Who holds the keys</Eyebrow>
      <h2 className="title" style={{marginTop: 6}}>
        Control
      </h2>
      <div className="stack" style={{marginTop: 18}}>
        <div className="field">
          <span className="label">Business wallet</span>
          <span className="value">
            {w.address ? <Hash value={w.address} label="the business wallet address" /> : 'not known'}
          </span>
          <span className="value">
            {w.walletId ? <Hash value={w.walletId} label="the Privy wallet id" head={8} tail={4} /> : 'no wallet id'}
          </span>
        </div>
        <div className="field">
          <span className="label">Treasurer key</span>
          <span className="value">
            {w.treasurerKeyId ? (
              <Hash value={w.treasurerKeyId} label="the treasurer key id" head={8} tail={4} />
            ) : (
              'not configured in this environment'
            )}
          </span>
        </div>
        <div className="field">
          <span className="label">Agent signer</span>
          <span className="value">
            {w.agentKeyQuorumId ? (
              <Hash value={w.agentKeyQuorumId} label="the agent signer key quorum id" head={8} tail={4} />
            ) : (
              'no agent signer is attached'
            )}
          </span>
        </div>
        <div className="field">
          <span className="label">Policy id</span>
          <span className="value">
            {w.policyId ? (
              <Hash value={w.policyId} label="the Privy policy id" head={8} tail={4} />
            ) : (
              'no policy has been created yet'
            )}
          </span>
        </div>
      </div>
      <p className="prose sm" style={{marginTop: 16}}>
        {w.control}
      </p>
      <div style={{marginTop: 4}}>
        <p className="label" style={{marginTop: 14}}>
          Revocation <CopyButton value={w.revocationCommand} label="the revocation command" />
        </p>
        <pre className="cmd">{w.revocationCommand}</pre>
        <p className="prose sm muted" style={{marginTop: 8}}>
          Signed by the treasurer key; the agent cannot run this.
        </p>
      </div>
    </section>
  );
}
