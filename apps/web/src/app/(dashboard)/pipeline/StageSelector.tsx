'use client'

import { useState, useTransition } from 'react'
import type { PipelineStageConfig } from '@nuatis/shared'
import { updateContactStage } from './actions'

interface Props {
  contactId: string
  stages: PipelineStageConfig[]
  currentStage: string
}

export default function StageSelector({ contactId, stages, currentStage }: Props) {
  const [value, setValue] = useState(currentStage)
  const [isPending, startTransition] = useTransition()

  return (
    <select
      value={value}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value
        setValue(next)
        startTransition(() => updateContactStage(contactId, next))
      }}
      className="w-full mt-2 text-xs border border-gray-100 rounded-md px-2 py-1 bg-gray-50 text-gray-600 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50 cursor-pointer"
    >
      {stages.map((s) => (
        <option key={s.name} value={s.name}>
          {s.name}
        </option>
      ))}
    </select>
  )
}
