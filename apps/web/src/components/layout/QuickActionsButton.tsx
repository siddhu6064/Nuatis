'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

const ACTIONS = [
  {
    label: 'Add Contact',
    href: '/contacts/new',
    icon: (
      <svg
        className="w-4 h-4 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 8v6M22 11h-6" />
      </svg>
    ),
  },
  {
    label: 'Book Appointment',
    href: '/appointments/new',
    icon: (
      <svg
        className="w-4 h-4 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <rect
          x="3"
          y="4"
          width="18"
          height="18"
          rx="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4"
        />
      </svg>
    ),
  },
  {
    label: 'Create Deal',
    href: '/pipeline?new=true',
    icon: (
      <svg
        className="w-4 h-4 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
  {
    label: 'Log Note',
    href: '/contacts?note=true',
    icon: (
      <svg
        className="w-4 h-4 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    ),
  },
]

export default function QuickActionsButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function navigate(href: string) {
    setOpen(false)
    router.push(href)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="h-8 w-8 flex items-center justify-center rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition-colors"
        aria-label="Quick actions"
        title="Quick actions"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16M4 12h16" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-white rounded-lg shadow-lg border border-rule min-w-[192px] overflow-hidden">
          {ACTIONS.map(({ label, href, icon }) => (
            <button
              key={href}
              onClick={() => navigate(href)}
              className="flex items-center gap-2 w-full py-2 px-3 text-sm text-ink2 hover:bg-paper transition-colors"
            >
              <span className="text-ink4">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
