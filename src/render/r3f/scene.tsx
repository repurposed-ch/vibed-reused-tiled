import type { DesignInstanceJson } from '@/domain/instance';
import type { TileDefinitionJson } from '@/domain/tile';
import { OrbitControls } from '@react-three/drei';
import { type RefObject, useLayoutEffect, useMemo, useRef } from 'react';
import { DoubleSide, Matrix4, type Group, type Mesh } from 'three';

export function Scene3d({
  instance,
  tiles,
  rootRef,
  exportRootRef,
}: {
  instance: DesignInstanceJson;
  tiles: TileDefinitionJson[];
  rootRef: RefObject<Group | null>;
  /** Tile meshes only (no floor/helpers) — used for GLB / USDZ export. */
  exportRootRef?: RefObject<Group | null>;
}) {
  const tileMap = useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles]);

  return (
    <>
      <group ref={rootRef} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh position={[2, 1.5, -0.001]} receiveShadow userData={{ export: false }}>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#2a241e" side={DoubleSide} />
        </mesh>
        <group ref={exportRootRef}>
          {instance.placements.map((pl) => {
            const t = tileMap.get(pl.tileDefinitionId);
            if (!t) return null;
            return (
              <TileMesh
                key={pl.id}
                length={t.length}
                width={t.width}
                thickness={t.thickness}
                color={t.color}
                elements={pl.mat3.elements}
              />
            );
          })}
        </group>
      </group>
      <OrbitControls makeDefault />
    </>
  );
}

function TileMesh({
  length,
  width,
  thickness,
  color,
  elements,
}: {
  length: number;
  width: number;
  thickness: number;
  color: string;
  elements: readonly [number, number, number, number, number, number, number, number, number];
}) {
  const ref = useRef<Mesh>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const [m00, m10, , m01, m11, , m02, m12] = elements;
    const m = new Matrix4().set(
      m00, m01, 0, m02,
      m10, m11, 0, m12,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    // Offset so local tile corner stays at frame origin: center the box in local XY
    const offset = new Matrix4().makeTranslation(length / 2, width / 2, thickness / 2);
    ref.current.matrixAutoUpdate = false;
    ref.current.matrix.copy(m).multiply(offset);
  }, [elements, length, width, thickness]);

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[length, width, thickness]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}
