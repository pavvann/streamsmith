'use client';

/**
 * The small vocabulary the screen is built from. Kept deliberately thin: an eyebrow, a stamp that
 * always carries a word (colour is never the only signal), a reading (Fraunces + tabular numerals),
 * a truncated hash with a copy button, and a meter. Nothing here knows what a vault is.
 */
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';

export type Tone = 'quiet' | 'go' | 'accent' | 'warn' | 'deny';

export function Eyebrow({children, id}: {children: ReactNode; id?: string}) {
  return (
    <span className="eyebrow" id={id}>
      {children}
    </span>
  );
}

export function Stamp({tone = 'quiet', children, title}: {tone?: Tone; children: ReactNode; title?: string}) {
  return (
    <span className={`stamp ${tone}`} title={title}>
      {children}
    </span>
  );
}

/** A number the reader is meant to take away from a section. Always Fraunces, always tabular. */
export function Reading({
  size,
  tone = 'quiet',
  unit,
  children,
}: {
  size: 64 | 44 | 40 | 32 | 28 | 22 | 18;
  tone?: Tone;
  unit?: string;
  children: ReactNode;
}) {
  return (
    <span className={`reading r${size}${tone === 'quiet' ? '' : ` ${tone}`}`}>
      {children}
      {unit ? <span className="unit">{unit}</span> : null}
    </span>
  );
}

export function Field({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <span className="value">{children}</span>
    </div>
  );
}

export function CopyButton({value, label}: {value: string; label: string}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onClick = useCallback(() => {
    const done = () => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 900);
    };
    try {
      const p = navigator.clipboard?.writeText(value);
      if (p) void p.then(done, () => undefined);
      else done();
    } catch {
      // a browser without clipboard access still shows the full value in the title attribute
    }
  }, [value]);

  return (
    <button type="button" className={`copy${copied ? ' copied' : ''}`} onClick={onClick} aria-label={`Copy ${label}`}>
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

/** `0x1234…abcd`, full value in the title attribute, copy button alongside. */
export function Hash({
  value,
  label,
  head = 6,
  tail = 4,
  copy = true,
}: {
  value: string;
  label: string;
  head?: number;
  tail?: number;
  copy?: boolean;
}) {
  const short = value.length > head + tail + 4 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
  return (
    <span className="hashline">
      <span className="mono" title={value}>
        {short}
      </span>
      {copy ? <CopyButton value={value} label={label} /> : null}
    </span>
  );
}

export function Mono({children, title, ink}: {children: ReactNode; title?: string; ink?: boolean}) {
  return (
    <span className={ink ? 'mono ink' : 'mono'} title={title}>
      {children}
    </span>
  );
}

/**
 * A 6 px track with a fill proportional to value/limit and a tick at the limit (the right edge).
 * Over the limit the fill saturates and turns to the denied red; the caption carries the words.
 */
export function Meter({value, limit, over, label}: {value: number; limit: number; over?: boolean; label: string}) {
  const pct = limit > 0 ? Math.max(0, Math.min(100, (value / limit) * 100)) : 0;
  return (
    <div className="meter" role="img" aria-label={label}>
      <div className={`meter-fill${over ? ' over' : ''}`} style={{width: `${pct}%`}} />
      <span className="meter-tick" />
    </div>
  );
}

/** One page-load sequence: sections fade and rise 8 px, staggered 60 ms apart. */
export function step(index: number): {animationDelay: string} {
  return {animationDelay: `${index * 60}ms`};
}
