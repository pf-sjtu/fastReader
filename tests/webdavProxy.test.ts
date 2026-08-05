import { describe, it, expect } from 'vitest'
import {
  buildWebdavProxyUrl,
  buildWebdavPath,
  normalizeDavPath,
  isValidUpstreamBase,
  isBlockedUpstreamHostname,
  encodeDavHeaderPath,
} from '../src/services/webdavProxyUtils'

describe('WebDAV proxy URL helpers', () => {
  it('normalizes legacy webdav prefixes', () => {
    expect(normalizeDavPath('/api/webdav/foo/bar')).toBe('/foo/bar')
    expect(normalizeDavPath('/webdav/foo')).toBe('/foo')
    expect(normalizeDavPath('/dav/foo')).toBe('/foo')
    expect(normalizeDavPath('/dav')).toBe('/')
    expect(normalizeDavPath('../dav/foo')).toBe('/foo')
    expect(normalizeDavPath('/../dav/foo')).toBe('/foo')
  })

  it('normalizes missing leading slash', () => {
    expect(normalizeDavPath('foo')).toBe('/foo')
    expect(normalizeDavPath('')).toBe('/')
  })

  it('removes path traversal segments', () => {
    expect(normalizeDavPath('/fastReader/../../')).toBe('/')
    expect(normalizeDavPath('/fastReader/../notes')).toBe('/notes')
  })

  it('builds proxy URL with base and folder', () => {
    const url = buildWebdavProxyUrl({
      baseUrl: 'https://example.com/dav/',
      folder: '/Books',
      path: '/'
    })

    expect(url).toBe('/api/dav?base=https%3A%2F%2Fexample.com%2Fdav%2F&path=%2FBooks%2F')
  })

  it('encodes path segments safely', () => {
    const url = buildWebdavProxyUrl({
      baseUrl: 'https://example.com/dav/',
      folder: '/Books',
      path: '/My File.txt'
    })

    expect(url).toBe('/api/dav?base=https%3A%2F%2Fexample.com%2Fdav%2F&path=%2FBooks%2FMy%20File.txt')
  })

  it('joins folder and nested path', () => {
    const url = buildWebdavProxyUrl({
      baseUrl: 'https://example.com/dav/',
      folder: '/Books',
      path: '/dir/Report.pdf'
    })

    expect(url).toBe('/api/dav?base=https%3A%2F%2Fexample.com%2Fdav%2F&path=%2FBooks%2Fdir%2FReport.pdf')
  })

  it('builds webdav path header', () => {
    const path = buildWebdavPath({
      folder: '/Books',
      path: '/My File.txt'
    })

    expect(path).toBe('/Books/My File.txt')
  })

  it('defaults browse path to root', () => {
    const path = buildWebdavPath({
      folder: '/',
      path: ''
    })

    expect(path).toBe('/')
  })

  it('encodes header paths safely', () => {
    const encoded = encodeDavHeaderPath('/EBooks/一个叫欧维的男人决定去死.epub')
    expect(encoded).toContain('%')
    expect(encoded).not.toContain('一个叫欧维')
  })

  it('encodes header paths safely', () => {
    const encoded = encodeDavHeaderPath('/EBooks/一个叫欧维的男人决定去死.epub')
    expect(encoded).toContain('%')
    expect(encoded).not.toContain('一个叫欧维')
  })
})

describe('Cloudflare WebDAV proxy guards', () => {
  it('validates https upstream base', () => {
    expect(isValidUpstreamBase('https://example.com/dav/')).toBe(true)
    expect(isValidUpstreamBase('http://example.com/dav/')).toBe(false)
    expect(isValidUpstreamBase('https://user:pass@example.com/dav/')).toBe(false)
    expect(isValidUpstreamBase('not-a-url')).toBe(false)
  })

  it('blocks private / localhost upstream hosts (SSRF)', () => {
    expect(isBlockedUpstreamHostname('localhost')).toBe(true)
    expect(isBlockedUpstreamHostname('127.0.0.1')).toBe(true)
    expect(isBlockedUpstreamHostname('10.0.0.5')).toBe(true)
    expect(isBlockedUpstreamHostname('192.168.1.1')).toBe(true)
    expect(isBlockedUpstreamHostname('172.16.0.1')).toBe(true)
    expect(isBlockedUpstreamHostname('169.254.169.254')).toBe(true)
    expect(isBlockedUpstreamHostname('dav.jianguoyun.com')).toBe(false)

    expect(isValidUpstreamBase('https://127.0.0.1/dav/')).toBe(false)
    expect(isValidUpstreamBase('https://192.168.0.10/dav/')).toBe(false)
    expect(isValidUpstreamBase('https://localhost/dav/')).toBe(false)
    expect(isValidUpstreamBase('https://dav.jianguoyun.com/dav/')).toBe(true)
  })
})


