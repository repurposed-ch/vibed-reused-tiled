import { useEffect, useId, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import './layout.css';

const DESKTOP_MQ = '(min-width: 1081px)';

const links = [
  { to: '/', label: 'Project', end: true },
  { to: '/tiles', label: 'Tiles' },
  { to: '/materials', label: 'Materials' },
  { to: '/stock', label: 'Stock' },
  { to: '/design-family', label: 'Design family' },
  { to: '/tile-schema', label: 'Tile schema' },
  { to: '/boundaries', label: 'Boundaries' },
  { to: '/solve', label: 'Solve' },
  { to: '/view/2d', label: '2D' },
  { to: '/view/3d', label: '3D' },
  { to: '/settings', label: 'Settings' },
] as const;

function linkClassName(variant: 'inline' | 'drawer') {
  return ({ isActive }: { isActive: boolean }) => {
    const base = variant === 'inline' ? 'nav-link inline-link' : 'nav-link drawer-link';
    return isActive ? `${base} active` : base;
  };
}

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const menuId = useId();
  const flush3d = location.pathname === '/view/3d';

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const onChange = () => {
      if (mq.matches) setMenuOpen(false);
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

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

        <nav className="app-nav-inline" aria-label="Workflow stages">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={'end' in link ? link.end : false}
              className={linkClassName('inline')}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <button
          type="button"
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-label={menuOpen ? 'Close stages menu' : 'Open stages menu'}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className={menuOpen ? 'menu-toggle-icon open' : 'menu-toggle-icon'} aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </button>
      </header>

      {menuOpen && (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <nav
        id={menuId}
        className={menuOpen ? 'app-nav-drawer open' : 'app-nav-drawer'}
        aria-label="Workflow stages"
        aria-hidden={!menuOpen}
        inert={menuOpen ? undefined : true}
      >
        <p className="nav-drawer-label">Stages</p>
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={'end' in link ? link.end : false}
            className={linkClassName('drawer')}
            onClick={() => setMenuOpen(false)}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <main className={flush3d ? 'app-main app-main--flush' : 'app-main'}>
        <Outlet />
      </main>
    </div>
  );
}
