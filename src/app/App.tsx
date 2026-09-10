import { HashRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layout';
import { ProjectProvider } from './project-context';
import { UiStateProvider } from './ui-state';
import { AutoSolve } from './auto-solve';
import { OverviewPage } from './pages/overview';
import { TilesPage } from './pages/tiles';
import { MaterialsPage } from './pages/materials';
import { StockPage } from './pages/stock';
import { DesignFamilyPage } from './pages/design-family';
import { BoundariesPage } from './pages/boundaries';
import { TileSchemaPage } from './pages/tile-schema';
import { SolvePage } from './pages/solve';
import { View2dPage } from './pages/view-2d';
import { View3dPage } from './pages/view-3d';
import { SettingsPage } from './pages/settings';

export function App() {
  return (
    <UiStateProvider>
      <ProjectProvider>
        {/* Keeps the solved instance in step with every edit. Must sit inside
            both providers; renders nothing. */}
        <AutoSolve />
        <HashRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="tiles" element={<TilesPage />} />
            <Route path="materials" element={<MaterialsPage />} />
            <Route path="stock" element={<StockPage />} />
            <Route path="design-family" element={<DesignFamilyPage />} />
            <Route path="tile-schema" element={<TileSchemaPage />} />
            <Route path="boundaries" element={<BoundariesPage />} />
            <Route path="solve" element={<SolvePage />} />
            <Route path="view/2d" element={<View2dPage />} />
            <Route path="view/3d" element={<View3dPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
        </HashRouter>
      </ProjectProvider>
    </UiStateProvider>
  );
}
