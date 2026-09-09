import { downloadGlb, downloadUsdzPlaceholder } from '@/export/gltf';
import { Scene3d } from '@/render/r3f/scene';
import { Canvas } from '@react-three/fiber';
import { Suspense, useRef } from 'react';
import type { Group } from 'three';
import { useProject } from '../project-context';

export function View3dPage() {
  const { project } = useProject();
  const rootRef = useRef<Group>(null);

  return (
    <div className="page">
      <h1>3D view</h1>
      <p className="lede">
        React Three Fiber scene from the design instance. Export GLB for interchange; USDZ export
        downloads GLB plus an AR readme for converter workflows.
      </p>

      <div className="row no-print" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className="btn primary"
          disabled={!project.instance}
          onClick={() => {
            if (rootRef.current) void downloadGlb(rootRef.current, 'tiling.glb');
          }}
        >
          Export GLB
        </button>
        <button
          type="button"
          className="btn"
          disabled={!project.instance}
          onClick={() => {
            if (rootRef.current) void downloadUsdzPlaceholder(rootRef.current, 'tiling');
          }}
        >
          Export USDZ (via GLB)
        </button>
      </div>

      {!project.instance && <p className="muted">No instance yet — run Solve first.</p>}

      {project.instance && (
        <section className="panel" style={{ padding: 0, overflow: 'hidden', height: '28rem' }}>
          <Canvas camera={{ position: [3, 3, 3], fov: 45 }}>
            <color attach="background" args={['#1a1714']} />
            <ambientLight intensity={0.65} />
            <directionalLight position={[5, 8, 3]} intensity={1.1} />
            <Suspense fallback={null}>
              <Scene3d
                rootRef={rootRef}
                instance={project.instance}
                tiles={project.tileDefinitions}
              />
            </Suspense>
          </Canvas>
        </section>
      )}
    </div>
  );
}
