'use client';

/**
 * The hero: one word, the sentence behind it, the five numbers of the rule that produced it, and
 * every reason the agent refused to act. Refusals are never hidden and never boxed in red — they
 * are the normal output of a fail-closed service, so they read as a list of findings.
 */
import {Eyebrow, Field, Hash, Reading} from './ui';
import type {Snap} from './types';

export function DecisionBand({snap}: {snap: Snap}) {
  const d = snap.decision;
  const ev = d.evidence;
  const cfg = snap.config;
  // The service's reason sentence opens with the verdict word, which is already 64 px above it.
  const trimmed = d.reason.startsWith(`${d.action}: `) ? d.reason.slice(d.action.length + 2) : d.reason;
  const reason = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  const cooldown = ev.cooldown.clear
    ? 'clear'
    : `${ev.cooldown.hoursSinceLastRotation ?? '?'} h since the last rotation`;

  return (
    <section className={`decision ${d.action} seq`} style={{animationDelay: '60ms'}} aria-labelledby="decision-eyebrow">
      <Eyebrow id="decision-eyebrow">Decision</Eyebrow>
      <strong className="verdict">{d.action}</strong>
      <p className="prose lead">{reason}</p>

      <div className="rulestrip">
        <div>
          <span className="label">Min differential</span>
          <span className="value">{cfg.minDifferentialBps} bps</span>
        </div>
        <div>
          <span className="label">Min window</span>
          <span className="value">{cfg.minObservationHours} h</span>
        </div>
        <div>
          <span className="label">Cooldown</span>
          <span className="value">{cfg.cooldownHours} h</span>
        </div>
        <div>
          <span className="label">Guardrail</span>
          <span className="value">{ev.guardrail.limitBps} bps</span>
        </div>
        <div>
          <span className="label">Lag limit</span>
          <span className="value">{cfg.maxLagBlocks} blocks</span>
        </div>
      </div>

      <p className="prose sm muted" style={{marginTop: 12, maxWidth: '74ch'}}>
        Rotate to the other approved vault only when observed-window share-value growth differs by more than the
        minimum above, with both windows long enough, the cooldown clear, the destination inside the outflow guardrail
        (our own flows excluded), the sink no staler than the lag limit, and at most one action per observation block.
      </p>

      <div className="rulestrip" style={{borderTop: 0}}>
        <Field label="Amount">{d.amountNormalized ?? 'nothing would move'}</Field>
        <Field label="Idempotency key">
          {d.idempotencyKey ? (
            <Hash value={d.idempotencyKey} label="the idempotency key" head={14} tail={8} />
          ) : (
            'not issued: there is no rotation to key'
          )}
        </Field>
        <Field label="Cooldown state">
          {cooldown} · last rotation {ev.cooldown.lastRotationAt ?? 'never'}
        </Field>
        {d.lastObservationBlock !== null ? (
          <Field label="Decided on block">{d.lastObservationBlock}</Field>
        ) : null}
      </div>

      {d.refusals.length > 0 ? (
        <>
          <p className="label" style={{marginTop: 22}}>
            {d.refusals.length === 1 ? 'One refusal' : `${d.refusals.length} refusals`}
          </p>
          <ul className="refusals">
            {d.refusals.map((r) => (
              <li key={r.code + r.message}>
                <span className="dot" aria-hidden="true" />
                <span>
                  <code>{r.code}</code>{' '}
                  <span className="prose sm" style={{display: 'inline'}}>
                    {r.message}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="prose sm muted" style={{marginTop: 20}}>
          No refusals: every check the rule makes was evaluated and passed.
        </p>
      )}

    </section>
  );
}

export function PositionPanel({snap}: {snap: Snap}) {
  const d = snap.decision;
  const feePercent = snap.vaults[0]?.wrapperFeePercent ?? 10;
  return (
    <section className="panel seq" style={{animationDelay: '120ms'}} aria-labelledby="position-eyebrow">
      <Eyebrow id="position-eyebrow">Position</Eyebrow>
      <div className="rows" style={{marginTop: 16}}>
        {snap.vaults.map((v) => (
          <div className="holding" key={v.vaultId}>
            <div className="who">
              <span className="name">{v.label}</span>
              {d.from === v.vaultId ? <span className="stamp warn">Source</span> : null}
              {d.to === v.vaultId ? <span className="stamp go">Destination</span> : null}
            </div>
            {v.position ? (
              <Reading size={40} unit={v.position.assetSymbol.toUpperCase()}>
                {v.position.assetsNormalized}
              </Reading>
            ) : (
              <p className="prose sm muted" style={{margin: 0}}>
                The position could not be read from Privy on this cycle.
              </p>
            )}
          </div>
        ))}
      </div>

      <p className="prose sm muted" style={{marginTop: 18}}>
        {feePercent}% of generated returns goes to the app (fee wrapper).
      </p>

      <details className="details">
        <summary>Details</summary>
        <div>
          {snap.vaults.map((v) => (
            <div key={v.vaultId} style={{display: 'grid', gap: 3}}>
              <span className="label">{v.label}</span>
              <span className="value">
                vault id <Hash value={v.vaultId} label={`the Privy vault id for ${v.label}`} head={8} tail={4} />
              </span>
              <span className="value">
                observed <Hash value={v.vaultAddress} label={`the observed vault address for ${v.label}`} />
              </span>
              <span className="value">
                wrapper{' '}
                {v.wrapperAddress ? (
                  <Hash value={v.wrapperAddress} label={`the fee wrapper address for ${v.label}`} />
                ) : (
                  'not known on this cycle'
                )}
              </span>
            </div>
          ))}
          <p className="prose sm muted" style={{marginTop: 6}}>
            {snap.policy.wrapperFeeDisclosure}
          </p>
        </div>
      </details>
    </section>
  );
}
