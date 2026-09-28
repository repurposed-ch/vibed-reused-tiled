import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createTileDefinition, innermostTileGrid } from '@/domain/project';
import { TileEditor } from '../components/tile-editor';
import { tileFitStatus } from '../components/tile-fit';
import { TilePreview, tileDimensions, tileUvLabel } from '../components/tile-preview';
import { useProject } from '../project-context';

/**
 * Tiles as a gallery: a card per tile, and the editor only once one is opened.
 *
 * The editor lives on its own route so the browser's back button leaves it, and so a reload
 * comes back to the tile being worked on.
 */
export function TilesPage() {
  const { project, updateProject } = useProject();
  const navigate = useNavigate();
  const { tileId } = useParams();
  const selected = project.tileDefinitions.find((t) => t.id === tileId);
  const grid = project.tileSchema ? innermostTileGrid(project.tileSchema) : undefined;

  // A deleted tile, or a link to one that never existed, falls back to the gallery.
  useEffect(() => {
    if (tileId && !selected) navigate('/tiles', { replace: true });
  }, [tileId, selected, navigate]);

  if (selected) {
    return (
      <div className="page">
        <p className="crumbs no-print">
          <Link to="/tiles">Tile definitions</Link> / <span>{selected.name}</span>
        </p>
        <TileEditor tile={selected} onClose={() => navigate('/tiles')} />
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Tile definitions</h1>
      <p className="lede">
        Geometry, SDF material, brightness or palette color, and optional edge rhythm (all four
        sides or none). Open a tile to edit it. Edit materials on the{' '}
        <Link to="/materials">Materials</Link> page.
      </p>
      <div className="card-grid">
        {project.tileDefinitions.map((tile) => {
          const fit = tileFitStatus(tile, grid);
          return (
            <button
              key={tile.id}
              type="button"
              className="card"
              onClick={() => navigate(`/tiles/${tile.id}`)}
            >
              <TilePreview
                tile={tile}
                material={project.materials.find((m) => m.id === tile.materialId)}
                showRhythm={false}
                aspect={4 / 3}
                maxWidth="100%"
              />
              <span className="card-title">{tile.name}</span>
              <span className="card-meta muted mono">
                {tileDimensions(tile)} · {tileUvLabel(tile)}
              </span>
              {fit && fit.kind !== 'ok' && (
                <span className={`card-meta mono sev-${fit.kind}`} title={fit.message}>
                  {fit.short}
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          className="card card-add"
          onClick={() => {
            const tile = createTileDefinition({
              materialId: project.materials[0]?.id ?? 'material-ceramic',
            });
            updateProject((p) => ({ ...p, tileDefinitions: [...p.tileDefinitions, tile] }));
            navigate(`/tiles/${tile.id}`);
          }}
        >
          + New tile
        </button>
      </div>
    </div>
  );
}
