import { useEffect, useRef, type CSSProperties } from 'react';

/** How long a valid, in-range value sits before it reaches the project. */
const COMMIT_MS = 400;

type Common = {
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  'aria-label'?: string;
  title?: string;
};

/**
 * A number input that does not fight the person typing in it.
 *
 * The input is **uncontrolled while focused**: React never writes into it, so half-typed text
 * — `0.`, `-`, `1e` — survives. A value only leaves the field when it is complete: after a
 * pause (and only if it already parses and sits inside the range), on blur, or on Enter.
 * Escape puts the committed value back.
 *
 * The old pattern, `value={n} onChange={e => set(Number(e.target.value) || fallback)}`, cannot
 * work: a `type="number"` input reports an empty string while its text is mid-edit, so the
 * fallback lands in the project and React writes it straight back over what was being typed.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  integer = false,
  commitMs = COMMIT_MS,
  format,
  ...rest
}: Common & {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number | string;
  /** Round on commit, and never commit a fractional draft early. */
  integer?: boolean;
  /** Pause before an in-range value commits. 0 waits for blur or Enter. */
  commitMs?: number;
  /** How the committed value is written into the box. Defaults to `String`. */
  format?: (value: number) => string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  // Read through a ref: the handlers below outlive any one render.
  const latest = useRef({ value, onChange, format });
  latest.current = { value, onChange, format };

  const show = (v: number) => (latest.current.format ?? String)(v);

  // An edit from elsewhere (a slider, a solve, another field) wins only while this one is idle.
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el) el.value = show(value);
  });

  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const clamp = (n: number) => {
    const rounded = integer ? Math.round(n) : n;
    return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, rounded));
  };

  const commit = (raw: string, rewrite: boolean) => {
    stop();
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) {
      if (ref.current) ref.current.value = show(latest.current.value);
      return;
    }
    const next = clamp(n);
    if (next !== latest.current.value) latest.current.onChange(next);
    if (rewrite && ref.current) ref.current.value = show(next);
  };

  return (
    <input
      ref={ref}
      type="number"
      inputMode={integer ? 'numeric' : 'decimal'}
      min={min}
      max={max}
      step={step}
      defaultValue={show(value)}
      onChange={(e) => {
        const raw = e.target.value;
        stop();
        if (commitMs <= 0) return;
        const n = Number(raw);
        // Only text that is already a legal value commits early. Anything mid-edit — empty,
        // `0.`, out of range, a fraction in an integer field — waits for blur.
        if (raw.trim() === '' || !Number.isFinite(n)) return;
        if ((min !== undefined && n < min) || (max !== undefined && n > max)) return;
        if (integer && !Number.isInteger(n)) return;
        timer.current = window.setTimeout(() => commit(raw, false), commitMs);
      }}
      onBlur={(e) => commit(e.currentTarget.value, true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget.value, true);
        else if (e.key === 'Escape') {
          stop();
          e.currentTarget.value = show(latest.current.value);
          e.currentTarget.blur();
        }
      }}
      {...rest}
    />
  );
}

/**
 * The same contract for text that has a fallback: the box can be empty while you type, and the
 * fallback is only applied once you leave. `onChange` never sees an empty string.
 */
export function TextField({
  value,
  onChange,
  fallback,
  commitMs = COMMIT_MS,
  ...rest
}: Common & {
  value: string;
  onChange: (value: string) => void;
  /** Used when the field is left empty. Defaults to the last committed value. */
  fallback?: string;
  commitMs?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  const latest = useRef({ value, onChange, fallback });
  latest.current = { value, onChange, fallback };

  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el) el.value = value;
  });

  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const commit = (raw: string, rewrite: boolean) => {
    stop();
    const next = raw.trim() || latest.current.fallback || latest.current.value;
    if (next !== latest.current.value) latest.current.onChange(next);
    if (rewrite && ref.current) ref.current.value = next;
  };

  return (
    <input
      ref={ref}
      type="text"
      defaultValue={value}
      onChange={(e) => {
        const raw = e.target.value;
        stop();
        if (commitMs <= 0 || raw.trim() === '') return;
        timer.current = window.setTimeout(() => commit(raw, false), commitMs);
      }}
      onBlur={(e) => commit(e.currentTarget.value, true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget.value, true);
        else if (e.key === 'Escape') {
          stop();
          e.currentTarget.value = latest.current.value;
          e.currentTarget.blur();
        }
      }}
      {...rest}
    />
  );
}
