import type { DesignInstanceJson } from '@/domain/instance';
import type { ProjectJointJson } from '@/domain/joint';
import type { MaterialDefinitionJson } from '@/domain/material';
import type { TileDefinitionJson } from '@/domain/tile';
import { Scene3d } from '@/render/r3f/scene';
import type { TileVariationSettings } from '@/render/r3f/tile-instances';
import { Canvas } from '@react-three/fiber';
import { Suspense, useRef, type RefObject } from 'react';
import type { Group } from 'three';

/** The lit 3D scene of a design instance, shared by the 3D view and the project preview. */
export function SceneCanvas({
  instance,
  tiles,
  materials,
  joint,
  variation,
  rootRef,
  exportRootRef,
}: {
  instance: DesignInstanceJson;
  tiles: TileDefinitionJson[];
  materials: MaterialDefinitionJson[];
  joint: ProjectJointJson;
  variation: TileVariationSettings;
  rootRef?: RefObject<Group | null>;
  exportRootRef?: RefObject<Group | null>;
}) {
  const ownRootRef = useRef<Group>(null);
  return (
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
          rootRef={rootRef ?? ownRootRef}
          exportRootRef={exportRootRef}
          instance={instance}
          tiles={tiles}
          materials={materials}
          variation={variation}
          joint={joint}
        />
      </Suspense>
    </Canvas>
  );
}
