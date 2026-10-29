// 温度输入：本地草稿，失焦或回车时提交；空值 = 跟随默认（optional 时）
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { TEMPERATURE_MAX, TEMPERATURE_MIN, parseTemperatureInput } from './provider-utils'

interface TemperatureInputProps {
  id?: string
  value: number | undefined
  /** optional=true 时允许清空（提交 undefined） */
  optional?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
  onCommit: (value: number | undefined) => void
}

const toText = (v: number | undefined) => (v === undefined ? '' : String(v))

export function TemperatureInput({
  id,
  value,
  optional = false,
  placeholder,
  disabled,
  className,
  onCommit,
  ...aria
}: TemperatureInputProps) {
  const [draft, setDraft] = useState(toText(value))
  // 外部值变化（导入 / 重置）时同步草稿
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setDraft(toText(value))
  }

  const commit = () => {
    const parsed = parseTemperatureInput(draft)
    if (parsed === null || (parsed === undefined && !optional)) {
      setDraft(toText(value)) // 非法输入回滚
      return
    }
    setDraft(toText(parsed))
    if (parsed !== value) onCommit(parsed)
  }

  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      min={TEMPERATURE_MIN}
      max={TEMPERATURE_MAX}
      step={0.1}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
      }}
      className={cn('h-8 text-sm', className)}
      {...aria}
    />
  )
}
