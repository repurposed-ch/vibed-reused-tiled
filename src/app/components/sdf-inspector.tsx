import type { SdfNodeJson, SdfOp } from '@/domain/material';
import { SDF_OPS } from '@/domain/material';
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  OP_META,
  opsInCategory,
  pathsEqual,
  type ParamMeta,
  type SdfPath,
  type SeamIssue,
  type SeamSeverity,
} from '@/render/materials';

const SEVERITY_COLOR: Record<SeamSeverity, string> = {
  error: '#c45c5c',
  warning: '#d9773a',
  info: '#b5a89a',
};

const LABEL_W = '7rem';

/** Range inputs must stay outside `.field` — its padding/border wrecks the track. */
const RANGE_STYLE = { flex: 1, accentColor: '#d9773a', background: 'transparent' } as const;

const NUM_STYLE = {
  width: '5rem',
  flex: '0 0 5rem',
  background: '#1a1714',
  border: '1px solid #4a4036',
  color: '#f3ebe1',
  padding: '0.3rem 0.35rem',
  fontSize: '0.78rem',
  fontFamily: 'Fragment Mono, monospace',
} as const;

function ParamLabel({ text }: { text: string }) {
  return (
    <label
      className="mono muted"
      style={{ width: LABEL_W, flex: `0 0 ${LABEL_W}`, fontSize: '0.72rem', margin: 0 }}
    >
      {text}
    </label>
  );
}

function Hint({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="muted" style={{ margin: '0 0 0 7.5rem', fontSize: '0.7rem' }}>
      {text}
    </p>
  );
}

function NumberControl({
  param,
  value,
  onChange,
}: {
  param: Extract<ParamMeta, { kind: 'number' }>;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <>
      <div className="row" style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'nowrap' }}>
        <ParamLabel text={param.label} />
        <input
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={value}
          style={RANGE_STYLE}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          type="number"
          min={param.min}
          max={param.max}
          step={param.step}
          value={Number(value.toFixed(4))}
          style={NUM_STYLE}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.min(Math.max(n, param.min), param.max));
          }}
        />
      </div>
      <Hint text={param.hint} />
    </>
  );
}

function IntControl({
  param,
  value,
  onChange,
}: {
  param: Extract<ParamMeta, { kind: 'int' }>;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <>
      <div className="row" style={{ alignItems: 'center', gap: '0.35rem', flexWrap: 'nowrap' }}>
        <ParamLabel text={param.label} />
        <button
          type="button"
          className="btn"
          disabled={value <= param.min}
          onClick={() => onChange(Math.max(param.min, value - 1))}
        >
          −
        </button>
        <span className="mono" style={{ minWidth: '2rem', textAlign: 'center' }}>
          {value}
        </span>
        <button
          type="button"
          className="btn"
          disabled={value >= param.max}
          onClick={() => onChange(Math.min(param.max, value + 1))}
        >
          +
        </button>
      </div>
      <Hint text={param.hint} />
    </>
  );
}

function Vec2Control({
  label,
  step,
  value,
  onChange,
  hint,
}: {
  label: string;
  step: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  hint?: string;
}) {
  return (
    <>
      <div className="row" style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'nowrap' }}>
        <ParamLabel text={label} />
        {([0, 1] as const).map((i) => (
          <input
            key={i}
            type="number"
            step={step}
            value={Number(value[i].toFixed(4))}
            style={NUM_STYLE}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              const next: [number, number] = [...value] as [number, number];
              next[i] = n;
              onChange(next);
            }}
          />
        ))}
      </div>
      <Hint text={hint} />
    </>
  );
}

/** Quarter turns only — any other angle takes a periodic field off the tile lattice. */
function QuarterTurnControl({
  value,
  onChange,
  isSquareTile,
}: {
  value: number;
  onChange: (v: number) => void;
  isSquareTile: boolean;
}) {
  const quarters = Math.round(value / (Math.PI / 2));
  const normalized = ((quarters % 4) + 4) % 4;
  const offLattice = Math.abs(value - quarters * (Math.PI / 2)) > 1e-6;
  return (
    <>
      <div className="row" style={{ alignItems: 'center', gap: '0.35rem', flexWrap: 'nowrap' }}>
        <ParamLabel text="Angle" />
        {[0, 1, 2, 3].map((q) => {
          const needsSquare = q % 2 === 1 && !isSquareTile;
          return (
            <button
              key={q}
              type="button"
              className={!offLattice && normalized === q ? 'btn primary' : 'btn'}
              style={{ padding: '0.35rem 0.5rem' }}
              title={needsSquare ? '90°/270° need a square tile — they swap axes' : undefined}
              onClick={() => onChange(q * (Math.PI / 2))}
            >
              {q * 90}°{needsSquare ? ' ⚠' : ''}
            </button>
          );
        })}
      </div>
      <Hint
        text={
          offLattice
            ? `Current angle ${value.toFixed(3)} rad is off-lattice and will seam. Pick a quarter turn.`
            : 'Only quarter turns keep a periodic field seamless.'
        }
      />
    </>
  );
}

/** `scale.factor` is `number | [number, number]`; only 1/integer stays seamless. */
function ScaleFactorControl({
  value,
  onChange,
}: {
  value: number | [number, number];
  onChange: (v: number | [number, number]) => void;
}) {
  const perAxis = Array.isArray(value);
  const pair: [number, number] = perAxis ? value : [value, value];
  const divisor = (f: number) => (f > 0 ? Math.round(1 / f) : 0);
  const unsafe = pair.some((f) => !(f > 0) || Math.abs(1 / f - Math.round(1 / f)) > 1e-6);
  return (
    <>
      <div className="row" style={{ alignItems: 'center', gap: '0.35rem', flexWrap: 'nowrap' }}>
        <ParamLabel text="Factor" />
        <button
          type="button"
          className={perAxis ? 'btn' : 'btn primary'}
          style={{ padding: '0.35rem 0.5rem' }}
          onClick={() => onChange(pair[0])}
        >
          Uniform
        </button>
        <button
          type="button"
          className={perAxis ? 'btn primary' : 'btn'}
          style={{ padding: '0.35rem 0.5rem' }}
          onClick={() => onChange([pair[0], pair[1]])}
        >
          Per axis
        </button>
      </div>
      <div className="row" style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'nowrap' }}>
        <ParamLabel text={perAxis ? '1 / (x, y)' : '1 / m'} />
        {(perAxis ? [0, 1] : [0]).map((i) => (
          <input
            key={i}
            type="number"
            min={1}
            max={64}
            step={1}
            value={divisor(pair[i]!)}
            style={NUM_STYLE}
            onChange={(e) => {
              const m = Math.max(1, Math.round(Number(e.target.value) || 1));
              const next: [number, number] = [...pair] as [number, number];
              next[i] = 1 / m;
              onChange(perAxis ? next : next[0]);
            }}
          />
        ))}
      </div>
      <Hint
        text={
          unsafe
            ? 'Current factor is not 1/integer and will seam. Entering a whole divisor fixes it.'
            : 'Entered as a whole divisor, because only 1/integer factors stay seamless.'
        }
      />
    </>
  );
}

function Control({
  param,
  node,
  isSquareTile,
  onSetParam,
}: {
  param: ParamMeta;
  node: SdfNodeJson;
  isSquareTile: boolean;
  onSetParam: (key: string, value: unknown) => void;
}) {
  const raw = (node as unknown as Record<string, unknown>)[param.key];
  const set = (v: unknown) => onSetParam(param.key, v);

  switch (param.kind) {
    case 'number':
      return (
        <NumberControl
          param={param}
          value={typeof raw === 'number' ? raw : param.fallback}
          onChange={set}
        />
      );
    case 'int':
      return (
        <IntControl param={param} value={typeof raw === 'number' ? raw : param.fallback} onChange={set} />
      );
    case 'enum':
      return (
        <>
          <div className="row" style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'nowrap' }}>
            <ParamLabel text={param.label} />
            <select
              value={typeof raw === 'string' ? raw : param.fallback}
              style={{ ...NUM_STYLE, width: 'auto', flex: 1 }}
              onChange={(e) => set(e.target.value)}
            >
              {param.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <Hint text={param.hint} />
        </>
      );
    case 'bool':
      return (
        <>
          <div className="row" style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'nowrap' }}>
            <ParamLabel text={param.label} />
            <input
              type="checkbox"
              checked={typeof raw === 'boolean' ? raw : param.fallback}
              onChange={(e) => set(e.target.checked)}
            />
          </div>
          <Hint text={param.hint} />
        </>
      );
    case 'vec2':
      return (
        <Vec2Control
          label={param.label}
          step={param.step}
          value={Array.isArray(raw) ? (raw as [number, number]) : param.fallback}
          onChange={set}
          hint={param.hint}
        />
      );
    case 'scaleFactor':
      return (
        <ScaleFactorControl
          value={
            typeof raw === 'number' || Array.isArray(raw)
              ? (raw as number | [number, number])
              : param.fallback
          }
          onChange={set}
        />
      );
    case 'quarterTurn':
      return (
        <QuarterTurnControl
          value={typeof raw === 'number' ? raw : param.fallback}
          onChange={set}
          isSquareTile={isSquareTile}
        />
      );
    default:
      return null;
  }
}

const WRAPPABLE: SdfOp[] = SDF_OPS.filter((op) => OP_META[op].slots.length > 0);

export function SdfInspector({
  node,
  path,
  issues,
  isSquareTile,
  onSetParam,
  onChangeOp,
  onWrap,
  onDelete,
}: {
  node: SdfNodeJson;
  path: SdfPath;
  issues: SeamIssue[];
  isSquareTile: boolean;
  onSetParam: (key: string, value: unknown) => void;
  onChangeOp: (op: SdfOp) => void;
  onWrap: (op: SdfOp) => void;
  onDelete: () => void;
}) {
  const meta = OP_META[node.op];
  const mine = issues.filter((i) => pathsEqual(i.path, path));

  return (
    <div className="stack" style={{ gap: '0.6rem' }}>
      <div className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1rem' }}>{meta.label}</h2>
        <span className="pill">{CATEGORY_LABEL[meta.category]}</span>
        <span className="pill" title={meta.returns === 'distance' ? 'Wrap in fill or band to use as a shade' : 'Already a 0..1 shade'}>
          {meta.returns === 'distance' ? 'returns distance' : 'returns 0..1'}
        </span>
      </div>

      <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
        {meta.summary}
      </p>

      {mine.length > 0 && (
        <ul className="stack" style={{ gap: '0.25rem', margin: 0, paddingLeft: '1rem' }}>
          {mine.map((issue, i) => (
            <li
              key={i}
              className="mono"
              style={{ fontSize: '0.72rem', color: SEVERITY_COLOR[issue.severity] }}
            >
              <strong>{issue.severity}</strong> — {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div className="stack" style={{ gap: '0.45rem' }}>
        {meta.params.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>
            No parameters — this op is defined entirely by its inputs.
          </p>
        ) : (
          meta.params.map((param) => (
            <Control
              key={param.key}
              param={param}
              node={node}
              isSquareTile={isSquareTile}
              onSetParam={onSetParam}
            />
          ))
        )}
      </div>

      <div className="row" style={{ gap: '0.5rem', alignItems: 'end' }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Change op</label>
          <select value={node.op} onChange={(e) => onChangeOp(e.target.value as SdfOp)}>
            {CATEGORY_ORDER.map((category) => (
              <optgroup key={category} label={CATEGORY_LABEL[category]}>
                {opsInCategory(category).map((op) => (
                  <option key={op} value={op}>
                    {OP_META[op].label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Wrap in</label>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onWrap(e.target.value as SdfOp);
            }}
          >
            <option value="">Choose an op…</option>
            {CATEGORY_ORDER.map((category) => {
              const ops = opsInCategory(category).filter((op) => WRAPPABLE.includes(op));
              if (ops.length === 0) return null;
              return (
                <optgroup key={category} label={CATEGORY_LABEL[category]}>
                  {ops.map((op) => (
                    <option key={op} value={op}>
                      {OP_META[op].label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>
        <button type="button" className="btn danger" onClick={onDelete}>
          Remove
        </button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '0.7rem' }}>
        Remove promotes this node&rsquo;s first input into its place.
      </p>
    </div>
  );
}
