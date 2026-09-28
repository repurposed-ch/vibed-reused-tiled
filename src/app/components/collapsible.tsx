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
      className="panel no-print collapsible"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        {title}
        {note !== undefined && note !== null && (
          <span className="muted small collapsible-note">
            {note}
          </span>
        )}
      </summary>
      {open && <div className="mt-3">{children}</div>}
    </details>
  );
}
