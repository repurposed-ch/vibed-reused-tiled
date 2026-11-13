/** Inline copy of public/logo.svg; the field outline follows currentColor. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden>
      <rect x="9" y="9" width="14" height="14" rx="1.5" fill="#7a3418" />
      <rect x="9" y="25" width="14" height="14" rx="1.5" fill="#a84e26" />
      <rect x="9" y="41" width="14" height="14" rx="1.5" fill="#d9773a" />
      <rect x="25" y="41" width="14" height="14" rx="1.5" fill="#e49b62" />
      <rect x="41" y="41" width="14" height="14" rx="1.5" fill="#eebf8e" />
      <rect x="26" y="10" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
