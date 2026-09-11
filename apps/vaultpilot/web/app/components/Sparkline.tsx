'use client';

/**
 * Share value over the observed window, drawn from exactly the data the pipeline gives us and no
 * more. The sink hands the decision service the first and last `convertToAssets` observation of the
 * window, so this is honestly a two-point line: a hairline dashed baseline at the first reading, a
 * segment to the last, and a tick under each endpoint carrying the block it was observed at — the
 * block numbers are what make it a measurement rather than a decoration.
 *
 * Amplitude is relative to the largest growth on screen, so the two vaults are comparable; it is
 * never absolute, because a bps figure would be invisible at this scale.
 */

const W = 600;
const H = 76;
const PAD = 10;
const BASE = 48;
const TICK_TOP = 52;
const TICK_BOTTOM = 58;
const LABEL_Y = 70;

export function Sparkline({
  growthBps,
  peakBps,
  first,
  last,
  firstBlock,
  lastBlock,
  delayMs,
  label,
}: {
  growthBps: number | null;
  /** the largest absolute growth of the vaults on screen, so both sparklines share one scale */
  peakBps: number;
  first: string;
  last: string;
  firstBlock: number;
  lastBlock: number;
  delayMs: number;
  label: string;
}) {
  const magnitude = growthBps === null ? 0 : Math.abs(growthBps);
  const share = peakBps > 0 ? Math.min(1, magnitude / peakBps) : 0;
  const rise = magnitude === 0 ? 0 : 6 + share * 26;
  const down = growthBps !== null && growthBps < 0;
  const y1 = down ? BASE - rise : BASE;
  const y2 = down ? BASE : BASE - rise;
  const ring = growthBps === null ? 'var(--muted)' : down ? 'var(--deny-ink)' : 'var(--go)';

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={
        growthBps === null
          ? `${label}: share-value growth is not computable over the observed window`
          : `${label}: share value ${first} at block ${firstBlock} to ${last} at block ${lastBlock}, ${growthBps} bps`
      }
    >
      <line className="spark-base" x1={0} y1={BASE} x2={W} y2={BASE} />
      <path
        className="spark-line"
        d={`M ${PAD} ${y1} L ${W - PAD} ${y2}`}
        pathLength={1}
        style={{animationDelay: `${delayMs}ms`}}
      />
      <line className="spark-tick" x1={PAD} y1={TICK_TOP} x2={PAD} y2={TICK_BOTTOM} />
      <line className="spark-tick" x1={W - PAD} y1={TICK_TOP} x2={W - PAD} y2={TICK_BOTTOM} />
      <text className="spark-tag" x={PAD} y={LABEL_Y} textAnchor="start">
        {firstBlock}
      </text>
      <text className="spark-tag" x={W - PAD} y={LABEL_Y} textAnchor="end">
        {lastBlock}
      </text>
      <circle cx={PAD} cy={y1} r={3} fill="var(--paper)" stroke="var(--accent)" strokeWidth={1.5} />
      <circle
        className="spark-end"
        cx={W - PAD}
        cy={y2}
        r={4}
        fill="#ffffff"
        stroke={ring}
        strokeWidth={2}
        style={{animationDelay: `${delayMs + 480}ms`}}
      />
    </svg>
  );
}
