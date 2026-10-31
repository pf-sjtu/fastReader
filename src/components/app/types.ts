import type { useBookProcessing } from '@/hooks/useBookProcessing'

/** useBookProcessing 的返回值：拆出来的子视图按需 Pick，不再逐项透传 */
export type BookProcessing = ReturnType<typeof useBookProcessing>
