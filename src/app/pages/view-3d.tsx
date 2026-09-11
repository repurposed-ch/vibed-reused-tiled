import {
  downloadGlb,
  downloadUsdz,
  exportGlbBlob,
  exportUsdzBlob,
} from '@/export/gltf';
import {
  androidSceneViewerUrl,
  detectClientArProfile,
  type ArClientProfile,
} from '@/export/user-agent';
import { Scene3d } from '@/render/r3f/scene';
import { MAX_TINT, type TileVariationSettings } from '@/render/r3f/tile-instances';
import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Group } from 'three';
import { useProject } from '../project-context';
import { useUiState } from '../ui-state';
import '@google/model-viewer';

type ModelViewerEl = HTMLElement & {
  activateAR?: () => Promise<void>;
};

function exportTarget(exportRoot: Group | null, visualRoot: Group | null): Group {
  const root = exportRoot ?? visualRoot;
  if (!root) throw new Error('3D scene is not ready');
  return root;
}

export function View3dPage() {
  const { project } = useProject();
  const { ui, patchUi } = useUiState();
  const variation = ui.tileVariation;
  const setVariation = (patch: Partial<TileVariationSettings>) =>
    patchUi({ tileVariation: { ...ui.tileVariation, ...patch } });
  /** Bumped whenever the exported scene would change; an export that outlives it is stale. */
  const exportGeneration = useRef(0);
  const rootRef = useRef<Group>(null);
  const exportRootRef = useRef<Group>(null);
  const modelViewerRef = useRef<ModelViewerEl | null>(null);
  const glbUrlRef = useRef<string | null>(null);
  const usdzUrlRef = useRef<string | null>(null);
  const [profile] = useState<ArClientProfile>(() => detectClientArProfile());
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [usdzUrl, setUsdzUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasInstance = Boolean(project.instance);

  const setUrls = (nextGlb: string | null, nextUsdz: string | null) => {
    if (glbUrlRef.current) URL.revokeObjectURL(glbUrlRef.current);
    if (usdzUrlRef.current) URL.revokeObjectURL(usdzUrlRef.current);
    glbUrlRef.current = nextGlb;
    usdzUrlRef.current = nextUsdz;
    setGlbUrl(nextGlb);
    setUsdzUrl(nextUsdz);
  };

  useEffect(() => {
    return () => {
      if (glbUrlRef.current) URL.revokeObjectURL(glbUrlRef.current);
      if (usdzUrlRef.current) URL.revokeObjectURL(usdzUrlRef.current);
    };
  }, []);

  // Invalidate cached AR blobs whenever anything that ends up in the export changes — the
  // layout, the tiles, the materials, or the tile variation. Watching only the instance left
  // a variation change serving the previous export.
  useEffect(() => {
    exportGeneration.current += 1;
    setUrls(null, null);
    setError(null);
  }, [project.instance, project.tileDefinitions, project.materials, project.joint, ui.tileVariation]);

  const ensureExports = async () => {
    const root = exportTarget(exportRootRef.current, rootRef.current);
    const generation = exportGeneration.current;
    setBusy(true);
    setError(null);
    try {
      const glbBlob = await exportGlbBlob(root);
      const nextGlb = URL.createObjectURL(glbBlob);
      let nextUsdz: string | null = null;
      try {
        const usdzBlob = await exportUsdzBlob(root);
        nextUsdz = URL.createObjectURL(usdzBlob);
      } catch (err) {
        console.warn('USDZ export failed', err);
        if (profile === 'ios') {
          setError(
            err instanceof Error
              ? `USDZ export failed: ${err.message}. GLB is still available.`
              : 'USDZ export failed. GLB is still available.',
          );
        }
      }
      if (generation === exportGeneration.current) {
        setUrls(nextGlb, nextUsdz);
      } else {
        // The scene changed while exporting: hand these to the action that asked for them,
        // but do not cache them, and release them once that action has had time to use them.
        window.setTimeout(() => {
          URL.revokeObjectURL(nextGlb);
          if (nextUsdz) URL.revokeObjectURL(nextUsdz);
        }, 60_000);
      }
      return { glbUrl: nextGlb, usdzUrl: nextUsdz };
    } finally {
      setBusy(false);
    }
  };

  const primaryLabel = useMemo(() => {
    if (profile === 'ios') return 'Download USDZ';
    if (profile === 'android') return 'Download GLB';
    return null;
  }, [profile]);

  if (!hasInstance || !project.instance) {
    return (
      <div className="page" style={{ padding: '1.25rem' }}>
        <h1>3D view</h1>
        <p className="lede">
          Fullscreen scene of the design instance. Export format follows your device (USDZ on
          Apple, GLB on Android).
        </p>
        <p className="muted">No instance yet — run Solve first.</p>
      </div>
    );
  }

  return (
    <div className="view3d-fullscreen">
      <div className="view3d-overlay no-print">
        <h1>3D · AR</h1>
        <div className="row">
          {profile === 'ios' && (
            <>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={async () => {
                  const urls = await ensureExports();
                  if (urls.usdzUrl) {
                    const a = document.createElement('a');
                    a.rel = 'ar';
                    a.href = urls.usdzUrl;
                    a.download = 'tiling.usdz';
                    a.click();
                  } else {
                    await downloadGlb(exportTarget(exportRootRef.current, rootRef.current), 'tiling.glb');
                  }
                }}
              >
                {busy ? 'Preparing…' : 'View in AR'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  const urls = await ensureExports();
                  if (urls.usdzUrl) {
                    const a = document.createElement('a');
                    a.href = urls.usdzUrl;
                    a.download = 'tiling.usdz';
                    a.click();
                  }
                }}
              >
                {primaryLabel}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  await downloadGlb(exportTarget(exportRootRef.current, rootRef.current), 'tiling.glb');
                }}
              >
                Download GLB
              </button>
            </>
          )}
          {profile === 'android' && (
            <>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={async () => {
                  const urls = await ensureExports();
                  const mv = modelViewerRef.current;
                  if (mv?.activateAR) {
                    try {
                      await mv.activateAR();
                      return;
                    } catch {
                      /* fall through to intent */
                    }
                  }
                  if (urls.glbUrl) {
                    window.location.href = androidSceneViewerUrl(urls.glbUrl);
                  }
                }}
              >
                {busy ? 'Preparing…' : 'View in AR'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  await downloadGlb(exportTarget(exportRootRef.current, rootRef.current), 'tiling.glb');
                }}
              >
                Download GLB
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  try {
                    await downloadUsdz(exportTarget(exportRootRef.current, rootRef.current), 'tiling.usdz');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'USDZ export failed');
                  }
                }}
              >
                Download USDZ
              </button>
            </>
          )}
          {profile === 'other' && (
            <>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={async () => {
                  await ensureExports();
                  const mv = modelViewerRef.current;
                  if (mv?.activateAR) {
                    try {
                      await mv.activateAR();
                      return;
                    } catch {
                      /* fall through */
                    }
                  }
                  setError('AR not available in this browser — download GLB or USDZ instead.');
                }}
              >
                {busy ? 'Preparing…' : 'View in AR'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  await downloadGlb(exportTarget(exportRootRef.current, rootRef.current), 'tiling.glb');
                }}
              >
                Download GLB
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  try {
                    await downloadUsdz(exportTarget(exportRootRef.current, rootRef.current), 'tiling.usdz');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'USDZ export failed');
                  }
                }}
              >
                Download USDZ
              </button>
            </>
          )}
        </div>
        <div className="stack" style={{ gap: '0.35rem', marginTop: '0.5rem', maxWidth: '18rem' }}>
          <label className="row" style={{ gap: '0.45rem', alignItems: 'center', margin: 0 }}>
            <input
              type="checkbox"
              checked={variation.enabled}
              onChange={(e) => setVariation({ enabled: e.target.checked })}
            />
            <span>Tile variation</span>
          </label>
          {variation.enabled && (
            <>
              {(
                [
                  { key: 'offset', label: 'Offset', max: 1, step: 0.05 },
                  { key: 'tint', label: 'Tint', max: MAX_TINT, step: 0.01 },
                ] as const
              ).map((c) => (
                <div
                  key={c.key}
                  className="row"
                  style={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'nowrap' }}
                >
                  <span className="mono muted" style={{ width: '3.5rem', fontSize: '0.75rem' }}>
                    {c.label}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={c.max}
                    step={c.step}
                    value={variation[c.key]}
                    style={{ flex: 1, accentColor: '#d9773a', background: 'transparent' }}
                    onChange={(e) => setVariation({ [c.key]: Number(e.target.value) })}
                  />
                  <span className="mono muted" style={{ width: '2.5rem', fontSize: '0.75rem' }}>
                    {variation[c.key].toFixed(2)}
                  </span>
                </div>
              ))}
              <button
                type="button"
                className="btn"
                onClick={() => setVariation({ seed: (Math.random() * 2 ** 32) >>> 0 })}
              >
                Reseed
              </button>
            </>
          )}
          <p className="muted" style={{ margin: 0, fontSize: '0.7rem' }}>
            Continuous tiles only — tiles with an edge rhythm must match their neighbours.
          </p>
        </div>
      </div>

      {error && (
        <p
          className="error"
          style={{
            position: 'absolute',
            zIndex: 3,
            left: '0.75rem',
            right: '0.75rem',
            bottom: '0.75rem',
          }}
        >
          {error}
        </p>
      )}

      <div className="view3d-canvas">
        <Canvas shadows camera={{ position: [3, 3, 3], fov: 45 }} style={{ width: '100%', height: '100%' }}>
          <color attach="background" args={['#1a1714']} />
          {/* Lower ambient than before: a normal map only reads under directional light, and
              0.65 ambient washed the baked relief back out. The dim opposing fill keeps the
              side facing away from the key light from going black. */}
          <ambientLight intensity={0.35} />
          <directionalLight
            position={[5, 8, 3]}
            intensity={1.35}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0005}
          />
          <directionalLight position={[-4, 3, -5]} intensity={0.3} />
          <Suspense fallback={null}>
            <Scene3d
              rootRef={rootRef}
              exportRootRef={exportRootRef}
              instance={project.instance}
              tiles={project.tileDefinitions}
              materials={project.materials}
              variation={variation}
              joint={project.joint}
            />
          </Suspense>
        </Canvas>
      </div>

      <div className="view3d-ar-host" aria-hidden>
        {glbUrl && (
          <model-viewer
            ref={modelViewerRef as never}
            src={glbUrl}
            ios-src={usdzUrl ?? undefined}
            ar
            ar-modes="webxr scene-viewer quick-look"
            camera-controls
            touch-action="none"
            alt="Tiling design for AR"
          />
        )}
        {usdzUrl && (
          <a rel="ar" href={usdzUrl} download="tiling.usdz">
            USDZ AR
          </a>
        )}
        {glbUrl && profile === 'android' && (
          <a href={androidSceneViewerUrl(glbUrl)}>GLB Scene Viewer</a>
        )}
      </div>
    </div>
  );
}
