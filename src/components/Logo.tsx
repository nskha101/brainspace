export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="#D6246E" />
      <g fill="none" stroke="#fff" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 14.8a5.6 5.6 0 0 0-9.5 0 6.7 6.7 0 0 0-7.8 7.8 6.7 6.7 0 0 0-1.7 11.8 6.7 6.7 0 0 0 4.5 10.1 6.7 6.7 0 0 0 8.4 6.2 5 5 0 0 0 6.1-2.8V14.8a5.6 5.6 0 0 1 9.5 0 6.7 6.7 0 0 1 7.8 7.8 6.7 6.7 0 0 1 1.7 11.8 6.7 6.7 0 0 1-4.5 10.1 6.7 6.7 0 0 1-8.4 6.2 5 5 0 0 1-6.1-2.8" />
        <path d="M32 27.1c-3.4 0-5.6-1.8-6.3-4.5M14.8 32.7c3.6-.4 6.3.9 7.6 3.6M32 39.4c-3.8 0-5.8 2-6.3 5.2M32 27.1c3.4 0 5.6-1.8 6.3-4.5M49.2 32.7c-3.6-.4-6.3.9-7.6 3.6M32 39.4c3.8 0 5.8 2 6.3 5.2" />
      </g>
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-[-0.01em]">brainspace</span>
    </span>
  )
}
