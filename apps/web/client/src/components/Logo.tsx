// Inline SVG mark: a 24px rounded square holding a terminal prompt ">" on the
// left and a stylized triangular dispatch/play arrow on the right. Monochrome,
// driven by currentColor so it adapts to theme.
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="GHA Dispatcher"
      className={className}
    >
      <rect
        x="1"
        y="1"
        width="22"
        height="22"
        rx="5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* terminal prompt > */}
      <path
        d="M6 8.5L9 12L6 15.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* dispatch arrow (play triangle) */}
      <path
        d="M12.5 8.25L18 12L12.5 15.75V8.25Z"
        fill="currentColor"
      />
    </svg>
  );
}
