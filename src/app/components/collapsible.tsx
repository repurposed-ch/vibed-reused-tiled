import { useState, type ReactNode } from 'react';

/**
 * A collapsible panel.
 *
 * Children are mounted only while open: `<details>` keeps closed content in the DOM and
 * runs its effects, and the op gallery costs ~85 ms of CPU evaluation for its 35
 * thumbnails — not something to pay on every page load and reseed for a closed panel.
 */
export function Collapsible({
  title,
  note,
  defaultOpen = false,
  children,
}: {
  title: string;
  note?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="panel no-print"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 600, listStyle: 'revert' }}>
        {title}
        {note !== undefined && note !== null && (
          <span className="muted" style={{ fontWeight: 400, marginLeft: '0.5rem', fontSize: '0.8rem' }}>
            {note}
          </span>
        )}
      </summary>
      {open && <div style={{ marginTop: '0.75rem' }}>{children}</div>}
    </details>
  );
}
