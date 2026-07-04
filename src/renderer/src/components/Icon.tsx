/* Line icons, Covo style: 24x24 viewBox, fill:none, stroke:currentColor.
   Sizing/stroke come from .ic / .ic-sm in covo.css. */
import React from 'react'

const PATHS: Record<string, React.ReactNode> = {
  check: <path d="M4.5 12.5l5 5 10-11" />,
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  bolt: <path d="M13 3L5 13.5h6L10.5 21 19 10.5h-6L13 3z" />,
  wave: (
    <>
      <path d="M3 12h2" />
      <path d="M7 8v8" />
      <path d="M11 5v14" />
      <path d="M15 8v8" />
      <path d="M19 10v4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </>
  ),
  play: <path d="M8 5.5l11 6.5-11 6.5V5.5z" />
}

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  name: keyof typeof PATHS | string
}

export function Icon({ name, className = 'ic', ...rest }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...rest}>
      {PATHS[name] ?? null}
    </svg>
  )
}
