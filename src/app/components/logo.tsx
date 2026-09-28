/** Inline copy of public/logo.svg; the field outline follows currentColor. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden>
      <rect x="8" y="8" width="12" height="16" rx="1.5" fill="#7a3418" />
      <rect x="8" y="26" width="12" height="16" rx="1.5" fill="#a84e26" />
      <rect x="8" y="44" width="12" height="12" rx="1.5" fill="#d9773a" />
      <rect x="22" y="44" width="16" height="12" rx="1.5" fill="#e49b62" />
      <rect x="40" y="44" width="16" height="12" rx="1.5" fill="#eebf8e" />
      <rect x="23" y="9" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
