import type { DesignInstanceJson } from '@/domain/instance';
import type { MaterialDefinitionJson } from '@/domain/material';
import { defaultJoint, type ProjectJointJson } from '@/domain/joint';
import { cornerRadiusMetres, type TileDefinitionJson } from '@/domain/tile';
import { bakeInputFromTile, getBakedTexture } from '@/render/materials';
import { OrbitControls } from '@react-three/drei';
import { type RefObject, useEffect, useLayoutEffect, useMemo } from 'react';
import { DoubleSide, type Group } from 'three';
import {
  buildTileInstances,
  DEFAULT_TILE_VARIATION,
  materialAllowsOffset,
  type TileInstanceData,
  type TileVariationSettings,
} from './tile-instances';
import {
  buildGroutGeometry,
  createGroutMaterial,
  GROUT_BAKE_PERIOD,
  groutPlan,
} from './grout-geometry';
import {
  createTileInstanceGeometry,
  createTileInstancedMesh,
  createTileInstanceMaterial,
  writeTileInstances,
} from './tile-instanced-mesh';

/** Used when no joint is passed, so the default does not churn memos on every render. */
const FALLBACK_JOINT = defaultJoint();

export function Scene3d({
  instance,
  tiles,
  materials,
  rootRef,
  exportRootRef,
  variation = DEFAULT_TILE_VARIATION,
  joint = FALLBACK_JOINT,
}: {
  instance: DesignInstanceJson;
  tiles: TileDefinitionJson[];
  materials: MaterialDefinitionJson[];
  rootRef: RefObject<Group | null>;
  /** Tile meshes only (no floor/helpers) — used for GLB / USDZ export. */
  exportRootRef?: RefObject<Group | null>;
  /** Per-tile UV offset and tint for continuous tiles. */
  variation?: TileVariationSettings;
  /** Grout appearance; its width comes from the instance's grid. */
  joint?: ProjectJointJson;
}) {
  const tileMap = useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles]);
  const materialMap = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials],
  );

  // One InstancedMesh per tile type: every placement of a type shares its dimensions,
  // material and bake, so N draw calls become one per type and no textures are cloned.
  const groups = useMemo(
    () =>
      buildTileInstances(instance.placements, tileMap, variation, (tile) =>
        materialAllowsOffset(materialMap.get(tile.materialId), tile),
      ),
    [instance.placements, tileMap, materialMap, variation],
  );

  return (
    <>
      <group ref={rootRef} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh position={[2, 1.5, -0.001]} receiveShadow userData={{ export: false }}>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#2a241e" side={DoubleSide} />
        </mesh>
        <group ref={exportRootRef}>
          <GroutMesh
            instance={instance}
            tileMap={tileMap}
            materialMap={materialMap}
            joint={joint}
          />
          {[...groups.values()].map((data) => {
            const tile = tileMap.get(data.tileDefinitionId);
            if (!tile) return null;
            return (
              <TileInstances
                key={data.tileDefinitionId}
                tile={tile}
                material={materialMap.get(tile.materialId)}
                data={data}
              />
            );
          })}
        </group>
      </group>
      <OrbitControls makeDefault />
    </>
  );
}

function TileInstances({
  tile,
  material,
  data,
}: {
  tile: TileDefinitionJson;
  material?: MaterialDefinitionJson;
  data: TileInstanceData;
}) {
  // Tile objects get new identities on every project write, but the texture cache returns the
  // same entry for the same content, so everything keyed on `baked` stays put across edits.
  const baked = useMemo(
    () => (material ? getBakedTexture(bakeInputFromTile(tile, material)) : null),
    [tile, material],
  );

  // The cache owns the textures, so only the material is disposed here — never its maps.
  const threeMaterial = useMemo(
    () =>
      createTileInstanceMaterial(
        baked
          ? {
              map: baked.texture,
              normalMap: baked.normalTexture,
              roughnessMap: baked.roughnessTexture,
            }
          : null,
      ),
    [baked],
  );
  useEffect(
    () => () => {
      threeMaterial.dispose();
    },
    [threeMaterial],
  );

  const { length, width, thickness } = tile;
  const radius = cornerRadiusMetres(tile);
  const geometry = useMemo(
    () => createTileInstanceGeometry(length, width, thickness, data.count, radius),
    [length, width, thickness, data.count, radius],
  );
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );

  // Built here and rendered as a primitive: R3F reconstructs an <instancedMesh args> whenever
  // any argument's identity changes, which would drop the instance buffers on every edit.
  const mesh = useMemo(
    () => createTileInstancedMesh(geometry, threeMaterial, data.count, tile.id),
    [geometry, threeMaterial, data.count, tile.id],
  );
  useEffect(
    () => () => {
      mesh.dispose();
    },
    [mesh],
  );

  useLayoutEffect(() => {
    writeTileInstances(mesh, data);
  }, [mesh, data]);

  return <primitive object={mesh} />;
}

/**
 * All grout as one mesh: a surface with the tiles cut out, recessed by the joint depth. It sits
 * in the export root, so GLB and USDZ carry it too.
 */
function GroutMesh({
  instance,
  tileMap,
  materialMap,
  joint,
}: {
  instance: DesignInstanceJson;
  tileMap: ReadonlyMap<string, TileDefinitionJson>;
  materialMap: ReadonlyMap<string, MaterialDefinitionJson>;
  joint: ProjectJointJson;
}) {
  const geometry = useMemo(
    () => buildGroutGeometry(groutPlan(instance, tileMap, joint.depth)),
    [instance, tileMap, joint.depth],
  );
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );

  // The joint's colour object is recreated on every project write, but the texture cache
  // returns the same entry for the same content, so the material below stays put.
  const jointMaterial = materialMap.get(joint.materialId);
  const baked = useMemo(
    () =>
      jointMaterial
        ? getBakedTexture({
            material: jointMaterial,
            color: joint.color,
            length: GROUT_BAKE_PERIOD,
            width: GROUT_BAKE_PERIOD,
          })
        : null,
    [jointMaterial, joint.color],
  );
  const material = useMemo(
    () =>
      createGroutMaterial(
        baked
          ? { map: baked.texture, normalMap: baked.normalTexture, roughnessMap: baked.roughnessTexture }
          : null,
      ),
    [baked],
  );
  useEffect(
    () => () => {
      material.dispose();
    },
    [material],
  );

  // Square tiles with no joint leave no grout; an empty mesh would export as empty accessors.
  if ((geometry.index?.count ?? 0) === 0) return null;
  return (
    <mesh
      geometry={geometry}
      material={material}
      castShadow
      receiveShadow
      name="grout"
      userData={{ grout: true }}
      dispose={null}
    />
  );
}
