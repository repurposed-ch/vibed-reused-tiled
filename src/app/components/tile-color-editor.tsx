import { DEFAULT_PALETTE_C, tileDisplayColor, type TileColorJson } from '@/domain/tile';

/**
 * Brightness or Quilez-palette colour, as used by tiles and the grout joint.
 * Extracted unchanged from the Tiles page so both edit colour the same way.
 */
export function TileColorEditor({
  value,
  onChange,
  label = 'Color',
}: {
  value: TileColorJson;
  onChange: (color: TileColorJson) => void;
  label?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row" style={{ gap: '0.5rem', marginBottom: '0.5rem' }}>
        <button
          type="button"
          className={value.mode === 'brightness' ? 'btn primary' : 'btn'}
          onClick={() => onChange({ mode: 'brightness', color: tileDisplayColor(value) })}
        >
          Brightness
        </button>
        <button
          type="button"
          className={value.mode === 'palette' ? 'btn primary' : 'btn'}
          onClick={() => {
            const base = tileDisplayColor(value);
            onChange({
              mode: 'palette',
              colors: value.mode === 'palette' ? value.colors : [base, base, base],
              c: value.mode === 'palette' ? value.c : [...DEFAULT_PALETTE_C],
            });
          }}
        >
          Palette (3)
        </button>
      </div>
      {value.mode === 'brightness' ? (
        <div className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="color"
            value={value.color.startsWith('#') ? value.color : '#c4a574'}
            onChange={(e) => onChange({ mode: 'brightness', color: e.target.value })}
          />
          <span className="mono muted">{value.color}</span>
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            SDF → brightness
          </span>
        </div>
      ) : (
        (() => {
          const paletteColors = value.colors;
          const paletteC = value.c ?? DEFAULT_PALETTE_C;
          return (
            <div className="stack" style={{ gap: '0.75rem' }}>
              <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
                {(['a', 'b', 'd'] as const).map((name, i) => {
                  const hex = paletteColors[i]!;
                  return (
                    <div key={name} className="field">
                      <label>palette {name}</label>
                      <input
                        type="color"
                        value={hex.startsWith('#') ? hex : '#c4a574'}
                        onChange={(e) => {
                          const colors: [string, string, string] = [
                            paletteColors[0],
                            paletteColors[1],
                            paletteColors[2],
                          ];
                          colors[i] = e.target.value;
                          onChange({ mode: 'palette', colors, c: paletteC });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="stack" style={{ gap: '0.4rem' }}>
                <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                  Quilez palette(t, a, b, c, d) — adjust c with sliders
                </p>
                {(['x', 'y', 'z'] as const).map((axis, i) => (
                  <div key={axis} className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                    <label className="mono" style={{ width: '2.5rem', margin: 0, fontSize: '0.8rem' }}>
                      c.{axis}
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.01}
                      value={paletteC[i]!}
                      style={{ flex: 1 }}
                      onChange={(e) => {
                        const next: [number, number, number] = [paletteC[0], paletteC[1], paletteC[2]];
                        next[i] = Number(e.target.value);
                        onChange({ mode: 'palette', colors: paletteColors, c: next });
                      }}
                    />
                    <span className="mono muted" style={{ width: '3rem' }}>
                      {paletteC[i]!.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}
