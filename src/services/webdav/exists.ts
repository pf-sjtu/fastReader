import { normalizeDavPath } from '../webdavProxyUtils'
import {
  EXISTS_MAX_ATTEMPTS,
  EXISTS_RETRY_BASE_MS,
  classifyExistsStatus,
  describeProxyError,
  getDavErrorStatus,
  getProxyErrorReason,
  isProxyErrorResponse
} from './errors'
import type { DavContext, DavExistsStatus, ProbeResult } from './types'
import { buildHeaderPath, sleep } from './utils'

/**
 * 单次探测路径的 HTTP 状态（PROPFIND Depth:0）；网络错误 status 为 undefined。
 * 不加锁：调用方需已在 runExclusive 内。
 */
export async function probeStatus(ctx: DavContext, path: string): Promise<ProbeResult> {
  const normalizedPath = normalizeDavPath(path)
  try {
    if (ctx.isBrowserProxyMode()) {
      const res = await ctx.proxyFetch('PROPFIND', normalizedPath, {
        extraHeaders: { Depth: '0' },
      })
      return isProxyErrorResponse(res)
        ? { status: res.status, proxyError: describeProxyError(res.status) }
        : { status: res.status }
    }
    ctx.setDavHeader(buildHeaderPath(normalizedPath))
    await ctx.client!.stat('/')
    return { status: 207 }
  } catch (error) {
    return { status: getDavErrorStatus(error), proxyError: getProxyErrorReason(error) }
  }
}

export interface ExistsDetail {
  status: DavExistsStatus
  httpStatus?: number
  /** 失败原因（代理拒绝 / HTTP 状态 / 网络错误），exists/missing 时为空 */
  reason?: string
}

/** existsStatus 的详细版：5xx/429/网络错误指数退避重试，附带最后一次状态与原因 */
export async function existsDetail(ctx: DavContext, path: string): Promise<ExistsDetail> {
  if (!ctx.client || !ctx.config) return { status: 'unknown', reason: '客户端未初始化' }
  for (let attempt = 1; ; attempt++) {
    const probe = await ctx.runExclusive(() => probeStatus(ctx, path))
    const kind = classifyExistsStatus(probe.status, !!probe.proxyError)
    if (kind === 'exists' || kind === 'missing') return { status: kind, httpStatus: probe.status }
    if (kind === 'unknown' || attempt >= EXISTS_MAX_ATTEMPTS) {
      const reason =
        probe.proxyError ?? (probe.status === undefined ? '网络错误' : `HTTP ${probe.status}`)
      return { status: 'unknown', httpStatus: probe.status, reason }
    }
    // 退避期间不占锁，其他 DAV 操作可继续
    await sleep(EXISTS_RETRY_BASE_MS * 2 ** (attempt - 1))
  }
}
