export function Lock({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.75" y="7" width="10.5" height="7" rx="2" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" strokeLinecap="round" />
    </svg>
  )
}

export function ScanIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M1.5 5V3a1.5 1.5 0 0 1 1.5-1.5h2M11 1.5h2A1.5 1.5 0 0 1 14.5 3v2M14.5 11v2a1.5 1.5 0 0 1-1.5 1.5h-2M5 14.5H3A1.5 1.5 0 0 1 1.5 13v-2M3.5 8h9" />
    </svg>
  )
}

export function Arrow() {
  return (
    <svg className="arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 7h10M8 3l4 4-4 4" />
    </svg>
  )
}

export function Missing() {
  return (
    <div className="narrow panel empty-state">
      <h2>That worksheet isn't on this device</h2>
      <p>Worksheets are saved in this browser only. It may have been deleted, or made on another computer.</p>
      <a className="btn primary" href="#/">
        Back to worksheets
      </a>
    </div>
  )
}

export function Back({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="back" href={href}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 7H2M6 3L2 7l4 4" />
      </svg>
      {children}
    </a>
  )
}
