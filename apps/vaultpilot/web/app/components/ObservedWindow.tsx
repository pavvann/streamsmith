'use client';

/**
 * The graphical centrepiece. The window is measured on the data — first and last observation block
 * and their block timestamps — never on the clock, and observations are never interpolated, so the
 * sparklines are two honest points and say so. The differential is the one number the rule acts on.
 */
import {Sparkline} from './Sparkline';
import {Eyebrow, Meter, Mono, Reading, Stamp} from './ui';
import {iso, type GrowthEvidence, type GuardrailEvidence, type Snap, type WindowEvidence} from './types';

export function ObservedWindow({snap}: {snap: Snap}) {
  const ev = snap.decision.evidence;
  const windows = ev.observedWindow.vaults;
  const growths = [ev.growthA, ev.growthB].filter((g): g is GrowthEvidence => g !== null);
  const growthByVault = new Map(growths.map((g) => [g.vaultId, g]));
  const windowByVault = new Map(windows.map((w) => [w.vaultId, w]));

  const sharedHours = windows.length > 0 ? Math.min(...windows.map((w) => w.hours)) : null;
  const firstBlock = windows.length > 0 ? Math.min(...windows.map((w) => w.firstBlockNumber)) : null;
  const lastBlock = windows.length > 0 ? Math.max(...windows.map((w) => w.lastBlockNumber)) : null;
  const firstTs = windows.length > 0 ? Math.min(...windows.map((w) => w.firstBlockTimestamp)) : null;
  const lastTs = windows.length > 0 ? Math.max(...windows.map((w) => w.lastBlockTimestamp)) : null;
  const observations = windows.reduce((sum, w) => sum + w.observationCount, 0);
  const peakBps = growths.reduce((m, g) => Math.max(m, Math.abs(g.growthBps ?? 0)), 0);

  const differential =
    ev.differentialBps !== null
      ? `Differential ${ev.differentialBps} bps · minimum to act ${snap.config.minDifferentialBps} bps`
      : snap.decision.from === null || snap.decision.to === null
        ? 'Differential not computable: it is measured from the vault that holds the position to the other one, and no position is held right now.'
        : 'Differential not computable: one vault has no computable share-value growth over its observed window.';

  return (
    <section className="window-band seq" style={{animationDelay: '180ms'}} aria-labelledby="window-eyebrow">
      <div className="grid">
        <div className="c3">
          <Eyebrow id="window-eyebrow">Observed window</Eyebrow>
          <div style={{marginTop: 12}}>
            {sharedHours === null ? (
              <p className="prose sm muted" style={{margin: 0}}>
                No window yet: the sink returned no call_ok observations for either vault.
              </p>
            ) : (
              <Reading size={44} unit="h">
                {sharedHours}
              </Reading>
            )}
          </div>
          {firstBlock !== null && lastBlock !== null ? (
            <p style={{margin: '14px 0 0'}}>
              <Mono ink>
                {firstBlock} → {lastBlock}
              </Mono>
            </p>
          ) : null}
          <p className="prose sm muted" style={{marginTop: 8}}>
            {observations} observations across both vaults, on the shorter of the two windows. The rule needs{' '}
            {ev.observedWindow.minHoursRequired} h on each.
          </p>
          {firstTs !== null && lastTs !== null ? (
            <p style={{margin: '10px 0 0'}}>
              <Mono>{iso(firstTs)}</Mono>
              <br />
              <Mono>{iso(lastTs)}</Mono>
            </p>
          ) : null}
        </div>

        <div className="c9">
          <div className="rows">
            {snap.vaults.map((v, i) => (
              <VaultSpark
                key={v.vaultId}
                label={v.label}
                growth={growthByVault.get(v.vaultId) ?? null}
                window={windowByVault.get(v.vaultId) ?? null}
                minHours={ev.observedWindow.minHoursRequired}
                peakBps={peakBps}
                sharedFirstTs={firstTs}
                sharedLastTs={lastTs}
                delayMs={260 + i * 140}
              />
            ))}
          </div>
          <p className="value" style={{marginTop: 18, borderTop: '1px solid var(--hair)', paddingTop: 14}}>
            {differential}
          </p>
          <p className="prose sm muted" style={{marginTop: 10, maxWidth: '78ch'}}>
            Observations are the pipeline&apos;s own <code>convertToAssets</code> samples on the underlying vaults, only
            where the call succeeded, never interpolated. The window is measured on the data, not on the clock, so a
            sparkline shows the first and last reading of the window and the line between them.
          </p>
        </div>
      </div>
    </section>
  );
}

function VaultSpark({
  label,
  growth,
  window: w,
  minHours,
  peakBps,
  sharedFirstTs,
  sharedLastTs,
  delayMs,
}: {
  label: string;
  growth: GrowthEvidence | null;
  window: WindowEvidence | null;
  minHours: number;
  peakBps: number;
  sharedFirstTs: number | null;
  sharedLastTs: number | null;
  delayMs: number;
}) {
  // The shared window above already prints these two timestamps; only spell them out per vault when
  // this vault's window is not the one on the left, so no fact is hidden and nothing is repeated.
  const ownWindow = w !== null && (w.firstBlockTimestamp !== sharedFirstTs || w.lastBlockTimestamp !== sharedLastTs);
  return (
    <div className="spark-row">
      <div>
        <div className="who">
          <span className="name">{label}</span>
          {w && !w.meetsMinimum ? <Stamp tone="warn">Under {minHours} h</Stamp> : null}
          {w && w.meetsMinimum ? <Stamp tone="accent">Window long enough</Stamp> : null}
        </div>
        {growth ? (
          <>
            <Sparkline
              growthBps={growth.growthBps}
              peakBps={peakBps}
              first={growth.firstAssetsPerShareNormalized}
              last={growth.lastAssetsPerShareNormalized}
              delayMs={delayMs}
              label={label}
            />
            <p style={{margin: '8px 0 0'}}>
              <Mono ink>
                {growth.firstAssetsPerShareNormalized} → {growth.lastAssetsPerShareNormalized}
              </Mono>
            </p>
          </>
        ) : (
          <p className="prose sm muted" style={{margin: 0}}>
            No call_ok share-value observations for this vault in the window, so nothing is drawn.
          </p>
        )}
        {w ? (
          <p className="spark-meta">
            {w.hours} h · {w.observationCount} observations ·{' '}
            <Mono title={`${iso(w.firstBlockTimestamp)} → ${iso(w.lastBlockTimestamp)}`}>
              blocks {w.firstBlockNumber} → {w.lastBlockNumber}
            </Mono>
            {ownWindow ? (
              <>
                <br />
                <Mono>
                  {iso(w.firstBlockTimestamp)} → {iso(w.lastBlockTimestamp)}
                </Mono>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      <div className="growth">
        {growth && growth.growthBps !== null ? (
          <Reading size={32} tone={growth.growthBps > 0 ? 'go' : growth.growthBps < 0 ? 'deny' : 'quiet'} unit="bps">
            {growth.growthBps}
          </Reading>
        ) : (
          <span className="value">growth not computable</span>
        )}
      </div>
    </div>
  );
}

/**
 * The guardrail the destination has to pass: net third-party outflow over the trailing 24 h as a
 * share of the vault's observed total assets, with every flow of ours taken out of the numerator.
 */
export function GuardrailStrip({snap}: {snap: Snap}) {
  const ev = snap.decision.evidence;
  const byVault = new Map(ev.guardrail.evaluated.map((g) => [g.vaultId, g]));
  return (
    <section className="seq" style={{animationDelay: '240ms'}} aria-labelledby="guardrail-eyebrow">
      <Eyebrow id="guardrail-eyebrow">
        24 h net third-party outflow <span className="quiet">· our own flows excluded</span>
      </Eyebrow>
      <div style={{marginTop: 14}}>
        {snap.vaults.map((v) => (
          <GuardrailRow key={v.vaultId} label={v.label} guard={byVault.get(v.vaultId) ?? null} limit={ev.guardrail.limitBps} />
        ))}
      </div>
    </section>
  );
}

function GuardrailRow({
  label,
  guard,
  limit,
}: {
  label: string;
  guard: GuardrailEvidence | null;
  limit: number;
}) {
  if (!guard || !guard.computable || guard.outflowBps === null) {
    return (
      <div className="guard-row">
        <span className="value">{label}</span>
        <p className="prose sm muted" style={{margin: 0}}>
          Not computable: the vault&apos;s observed total assets are not available for this window, so the guardrail
          has no denominator and a rotation into it is refused.
        </p>
        <span />
      </div>
    );
  }
  return (
    <div className="guard-row">
      <div>
        <span className="value">{label}</span>
        {guard.exceedsLimit ? (
          <div style={{marginTop: 6}}>
            <Stamp tone="deny">Over {limit} bps</Stamp>
          </div>
        ) : null}
      </div>
      <div>
        <Meter
          value={guard.outflowBps}
          limit={limit}
          over={guard.exceedsLimit}
          label={`${label}: ${guard.outflowBps} bps of the ${limit} bps limit`}
        />
        <p className="meter-cap">
          <Mono>
            {guard.netOutflowExcludingSelfNormalized} out of {guard.observedTotalAssetsNormalized} observed
            {guard.selfExcludedOutNormalized !== '0' ? ` · ours excluded: ${guard.selfExcludedOutNormalized}` : ''}
          </Mono>
        </p>
      </div>
      <div className="bps">
        <Reading size={22} tone={guard.exceedsLimit ? 'deny' : 'quiet'} unit="bps">
          {guard.outflowBps}
        </Reading>
      </div>
    </div>
  );
}
