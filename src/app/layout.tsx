import { NavLink, Outlet } from 'react-router-dom';
import './layout.css';

const links = [
  { to: '/', label: 'Project', end: true },
  { to: '/tiles', label: 'Tiles' },
  { to: '/stock', label: 'Stock' },
  { to: '/design-family', label: 'Design family' },
  { to: '/boundaries', label: 'Boundaries' },
  { to: '/solve', label: 'Solve' },
  { to: '/view/2d', label: '2D' },
  { to: '/view/3d', label: '3D' },
  { to: '/settings', label: 'Settings' },
] as const;

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">VRT</span>
          <div>
            <p className="brand-title">Vibed · Reused · Tiled</p>
            <p className="brand-sub">Design families under uncertain stock</p>
          </div>
        </div>
        <nav className="app-nav" aria-label="Workflow">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={'end' in link ? link.end : false}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
