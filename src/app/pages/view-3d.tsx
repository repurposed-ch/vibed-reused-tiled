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
import { MAX_TINT, type TileVariationSettings } from '@/render/r3f/tile-instances';
import { useEffect, useRef, useState } from 'react';
import type { Group } from 'three';
import { CogIcon, DownloadIcon } from '../components/icons';
import { SceneCanvas } from '../components/scene-canvas';
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

  /** Hand the scene to the platform's AR viewer: Quick Look on iOS, Scene Viewer on Android. */
  const viewInAr = async () => {
    const urls = await ensureExports();
    if (profile === 'ios') {
      if (urls.usdzUrl) {
        const a = document.createElement('a');
        a.rel = 'ar';
        a.href = urls.usdzUrl;
        a.download = 'tiling.usdz';
        a.click();
      } else {
        await downloadGlb(exportTarget(exportRootRef.current, rootRef.current), 'tiling.glb');
      }
      return;
    }
    const mv = modelViewerRef.current;
    if (mv?.activateAR) {
      try {
        await mv.activateAR();
        return;
      } catch {
        /* fall through */
      }
    }
    if (profile === 'android' && urls.glbUrl) {
      window.location.href = androidSceneViewerUrl(urls.glbUrl);
      return;
    }
    setError('AR not available in this browser — download .glb or .usdz instead.');
  };

  const downloadGlbFile = async () => {
    try {
      await downloadGlb(exportTarget(exportRootRef.current, rootRef.current), 'tiling.glb');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GLB export failed');
    }
  };

  const downloadUsdzFile = async () => {
    try {
      await downloadUsdz(exportTarget(exportRootRef.current, rootRef.current), 'tiling.usdz');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'USDZ export failed');
    }
  };

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
      <div className="view3d-ar no-print">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void viewInAr()}>
          {busy ? 'Preparing…' : 'View in AR'}
        </button>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="view3d-downloads no-print">
        <button type="button" className="btn-link" onClick={() => void downloadGlbFile()}>
          <DownloadIcon /> .glb
        </button>
        <button type="button" className="btn-link" onClick={() => void downloadUsdzFile()}>
          <DownloadIcon /> .usdz
        </button>
      </div>

      <div className="view3d-settings no-print">
        <button
          type="button"
          className="btn-icon"
          popoverTarget="view3d-settings"
          aria-label="Scene settings"
          title="Scene settings"
        >
          <CogIcon />
        </button>
        <div id="view3d-settings" popover="auto" className="view3d-popover">
          <div className="stack gap-1">
            <label className="row tight m-0">
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
                  <div key={c.key} className="row tight">
                    <span className="readout">
                      {c.label}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={c.max}
                      step={c.step}
                      value={variation[c.key]}
                      className="range"
                      onChange={(e) => setVariation({ [c.key]: Number(e.target.value) })}
                    />
                    <span className="readout">
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
            <p className="muted tiny m-0">
              Continuous tiles only — tiles with an edge rhythm must match their neighbours.
            </p>
          </div>
        </div>
      </div>

      <div className="view3d-canvas">
        <SceneCanvas
          rootRef={rootRef}
          exportRootRef={exportRootRef}
          instance={project.instance}
          tiles={project.tileDefinitions}
          materials={project.materials}
          variation={variation}
          joint={project.joint}
        />
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
