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
import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Group } from 'three';
import { useProject } from '../project-context';
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

  // Invalidate cached AR blobs when the design instance changes.
  useEffect(() => {
    setUrls(null, null);
    setError(null);
  }, [project.instance]);

  const ensureExports = async () => {
    const root = exportTarget(exportRootRef.current, rootRef.current);
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
      setUrls(nextGlb, nextUsdz);
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
        <Canvas camera={{ position: [3, 3, 3], fov: 45 }} style={{ width: '100%', height: '100%' }}>
          <color attach="background" args={['#1a1714']} />
          <ambientLight intensity={0.65} />
          <directionalLight position={[5, 8, 3]} intensity={1.1} />
          <Suspense fallback={null}>
            <Scene3d
              rootRef={rootRef}
              exportRootRef={exportRootRef}
              instance={project.instance}
              tiles={project.tileDefinitions}
              materials={project.materials}
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
