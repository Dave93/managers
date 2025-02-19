import React from 'react'
import { useDebugMode } from '@admin/store/debug-mode'
import { Popover, PopoverContent, PopoverTrigger } from "@admin/components/ui/popover"
import { Clock } from 'lucide-react'

interface DebugInfoProps {
  sqlQueryTime: number
  apiTime: number
}

export const DebugInfo: React.FC<DebugInfoProps> = ({ sqlQueryTime, apiTime }) => {
  const { isDebugMode } = useDebugMode()

  if (!isDebugMode) return null

  return (
    <Popover>
      <PopoverTrigger>
        <Clock className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent>
        <div className="space-y-2">
          <p>SQL Query Time: {sqlQueryTime.toFixed(2)} ms</p>
          <p>API Time: {apiTime.toFixed(2)} ms</p>
        </div>
      </PopoverContent>
    </Popover>
  )
}