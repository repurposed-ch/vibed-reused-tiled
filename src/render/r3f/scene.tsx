import type { DesignInstanceJson } from '@/domain/instance';
import type { MaterialDefinitionJson } from '@/domain/material';
import type { TileDefinitionJson } from '@/domain/tile';
import { getBakedTexture, setTextureRepeat } from '@/render/materials';
import { OrbitControls } from '@react-three/drei';
import { type RefObject, useLayoutEffect, useMemo, useRef } from 'react';
import {
  DoubleSide,
  Matrix4,
  type Group,
  type Mesh,
  type Texture,
} from 'three';

export function Scene3d({
  instance,
  tiles,
  materials,
  rootRef,
  exportRootRef,
}: {
  instance: DesignInstanceJson;
  tiles: TileDefinitionJson[];
  materials: MaterialDefinitionJson[];
  rootRef: RefObject<Group | null>;
  /** Tile meshes only (no floor/helpers) — used for GLB / USDZ export. */
  exportRootRef?: RefObject<Group | null>;
}) {
  const tileMap = useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles]);
  const materialMap = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials],
  );

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
            const mat = materialMap.get(t.materialId);
            return (
              <TileMesh
                key={pl.id}
                length={t.length}
                width={t.width}
                thickness={t.thickness}
                color={t.color}
                material={mat}
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
  material,
  elements,
}: {
  length: number;
  width: number;
  thickness: number;
  color: string;
  material?: MaterialDefinitionJson;
  elements: readonly [number, number, number, number, number, number, number, number, number];
}) {
  const ref = useRef<Mesh>(null);

  const map = useMemo(() => {
    if (!material) return null;
    const { texture } = getBakedTexture(material, color);
    const cloned = texture.clone();
    cloned.needsUpdate = true;
    setTextureRepeat(cloned, length, width, material.periodMeters);
    return cloned;
  }, [material, color, length, width]);

  useLayoutEffect(() => {
    return () => {
      map?.dispose();
    };
  }, [map]);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const [m00, m10, , m01, m11, , m02, m12] = elements;
    const m = new Matrix4().set(
      m00, m01, 0, m02,
      m10, m11, 0, m12,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    const offset = new Matrix4().makeTranslation(length / 2, width / 2, thickness / 2);
    ref.current.matrixAutoUpdate = false;
    ref.current.matrix.copy(m).multiply(offset);
  }, [elements, length, width, thickness]);

  return (
    <mesh ref={ref} castShadow userData={{ bakedMap: map as Texture | null }}>
      <boxGeometry args={[length, width, thickness]} />
      <meshStandardMaterial color="#ffffff" map={map ?? undefined} />
    </mesh>
  );
}
