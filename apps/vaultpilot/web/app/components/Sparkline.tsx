'use client';

/**
 * Share value over the observed window, drawn from exactly the data the pipeline gives us and no
 * more. The sink hands the decision service the first and last `convertToAssets` observation of the
 * window, so this is honestly a two-point line: a dashed baseline at the first reading, a segment
 * to the last, an open circle where the window opens and a filled endpoint where it closes.
 * Amplitude is relative to the largest growth on screen, so the two vaults are comparable; it is
 * never absolute, because a bps figure would be invisible at this scale.
 */

const W = 320;
const H = 56;
const PAD = 9;

export function Sparkline({
  growthBps,
  peakBps,
  first,
  last,
  delayMs,
  label,
}: {
  growthBps: number | null;
  /** the largest absolute growth of the vaults on screen, so both sparklines share one scale */
  peakBps: number;
  first: string;
  last: string;
  delayMs: number;
  label: string;
}) {
  const magnitude = growthBps === null ? 0 : Math.abs(growthBps);
  const share = peakBps > 0 ? Math.min(1, magnitude / peakBps) : 0;
  const rise = magnitude === 0 ? 0 : 7 + share * 27;
  const down = growthBps !== null && growthBps < 0;
  const base = H - PAD;
  const y1 = down ? base - rise : base;
  const y2 = down ? base : base - rise;
  const tone = growthBps === null ? 'var(--muted)' : down ? 'var(--deny-ink)' : 'var(--go)';

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={
        growthBps === null
          ? `${label}: share-value growth is not computable over the observed window`
          : `${label}: share value ${first} to ${last} over the observed window, ${growthBps} bps`
      }
    >
      <line className="spark-base" x1={0} y1={base} x2={W} y2={base} />
      <path
        className="spark-line"
        d={`M ${PAD} ${y1} L ${W - PAD} ${y2}`}
        pathLength={1}
        style={{animationDelay: `${delayMs}ms`}}
      />
      <circle cx={PAD} cy={y1} r={3} fill="var(--paper-2)" stroke="var(--accent)" strokeWidth={1.5} />
      <circle
        className="spark-end"
        cx={W - PAD}
        cy={y2}
        r={4.5}
        fill={tone}
        stroke="var(--paper-2)"
        strokeWidth={1.5}
        style={{animationDelay: `${delayMs + 480}ms`}}
      />
    </svg>
  );
}
