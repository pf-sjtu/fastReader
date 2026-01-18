import { describe, it, expect } from 'vitest'
import { buildWebdavProxyUrl, buildWebdavPath, normalizeDavPath, isValidUpstreamBase } from '../src/services/webdavProxyUtils'

describe('WebDAV proxy URL helpers', () => {
  it('normalizes legacy webdav prefixes', () => {
    expect(normalizeDavPath('/api/webdav/foo/bar')).toBe('/foo/bar')
    expect(normalizeDavPath('/webdav/foo')).toBe('/foo')
    expect(normalizeDavPath('../dav/foo')).toBe('/foo')
    expect(normalizeDavPath('/../dav/foo')).toBe('/foo')
  })

  it('normalizes missing leading slash', () => {
    expect(normalizeDavPath('foo')).toBe('/foo')
    expect(normalizeDavPath('')).toBe('/')
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
})

describe('Cloudflare WebDAV proxy guards', () => {
  it('validates https upstream base', () => {
    expect(isValidUpstreamBase('https://example.com/dav/')).toBe(true)
    expect(isValidUpstreamBase('http://example.com/dav/')).toBe(false)
    expect(isValidUpstreamBase('https://user:pass@example.com/dav/')).toBe(false)
    expect(isValidUpstreamBase('not-a-url')).toBe(false)
  })
})

