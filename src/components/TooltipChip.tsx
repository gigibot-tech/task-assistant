import { useId, useState } from 'react'

interface TooltipChipProps {
  label: string
  tooltip: string
  active?: boolean
  onClick?: () => void
}

export default function TooltipChip({ label, tooltip, active, onClick }: TooltipChipProps) {
  const [open, setOpen] = useState(false)
  const tooltipId = useId()

  const Tag = onClick ? 'button' : 'span'

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`relative inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
        active
          ? 'bg-indigo-900/50 border-indigo-600 text-indigo-200'
          : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500 hover:bg-gray-750'
      } ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
      aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={onClick}
    >
      {label}
      {open && (
        <div
          id={tooltipId}
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 max-w-[min(16rem,calc(100vw-2rem))] px-3 py-2 rounded-lg bg-gray-950 border border-gray-600 text-xs text-gray-200 shadow-xl z-50 whitespace-pre-line pointer-events-none"
        >
          {tooltip}
          <span
            className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-600"
            aria-hidden
          />
        </div>
      )}
    </Tag>
  )
}
