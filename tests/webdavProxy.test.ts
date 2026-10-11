import { describe, it, expect } from 'vitest'
import {
  buildWebdavProxyUrl,
  buildWebdavPath,
  normalizeDavPath,
  isValidUpstreamBase,
  isBlockedUpstreamHostname,
  encodeDavHeaderPath,
  resolveScopedUpstreamUrl,
  isWithinUpstreamScope,
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

  it('blocks IPv6 literals: loopback / unspecified / mapped / link-local / ULA / multicast', () => {
    for (const h of [
      '[::1]', '::1', '[::]', '::', '[0:0:0:0:0:0:0:1]',
      '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::ffff:8.8.8.8]', '[::7f00:1]',
      '[fe80::1]', '[febf::1]', '[fc00::1]', '[fd12:3456::1]', '[ff02::1]',
    ]) {
      expect(isBlockedUpstreamHostname(h), h).toBe(true)
    }
    expect(isBlockedUpstreamHostname('[2606:4700:4700::1111]')).toBe(false)
    expect(isValidUpstreamBase('https://[::ffff:127.0.0.1]/dav/')).toBe(false)
    expect(isValidUpstreamBase('https://[::]/dav/')).toBe(false)
    expect(isValidUpstreamBase('https://[2606:4700:4700::1111]/dav/')).toBe(true)
  })

  it('does not treat fc/fd/fe80 prefixed DNS names as IPv6', () => {
    expect(isBlockedUpstreamHostname('fd.example.com')).toBe(false)
    expect(isBlockedUpstreamHostname('fc-dav.example.com')).toBe(false)
    expect(isBlockedUpstreamHostname('fe80.example.com')).toBe(false)
  })

  it('blocks IPv4 in non-canonical forms (decimal / octal / hex / short)', () => {
    for (const h of ['2130706433', '017700000001', '0x7f000001', '127.1', '0.0.0.0', '0.1.2.3', '10.1', '0300.0250.0.1']) {
      expect(isBlockedUpstreamHostname(h), h).toBe(true)
    }
    expect(isValidUpstreamBase('https://2130706433/dav/')).toBe(false)
    expect(isValidUpstreamBase('https://0x7f.1/dav/')).toBe(false)
    expect(isBlockedUpstreamHostname('8.8.8.8')).toBe(false)
  })

  it('blocks reserved names incl. trailing dot and empty / unparsable', () => {
    for (const h of ['localhost.', 'LOCALHOST', 'a.localhost', 'nas.local', 'svc.internal', 'x.intranet', '', 'bad host']) {
      expect(isBlockedUpstreamHostname(h), h).toBe(true)
    }
    for (const h of ['100.64.0.1', '172.31.255.255', '224.0.0.1', '255.255.255.255']) {
      expect(isBlockedUpstreamHostname(h), h).toBe(true)
    }
    expect(isBlockedUpstreamHostname('172.32.0.1')).toBe(false)
  })
})

describe('resolveScopedUpstreamUrl', () => {
  const base = 'https://dav.example.com/dav/'

  it('resolves normal relative paths under base', () => {
    expect(resolveScopedUpstreamUrl(base, '/Books/a.epub')).toBe('https://dav.example.com/dav/Books/a.epub')
    expect(resolveScopedUpstreamUrl('https://dav.example.com/dav', '/x')).toBe('https://dav.example.com/dav/x')
    expect(resolveScopedUpstreamUrl(base, '/')).toBe('https://dav.example.com/dav/')
    expect(resolveScopedUpstreamUrl(base, '')).toBe('https://dav.example.com/dav/')
    expect(resolveScopedUpstreamUrl(base, '/%E4%B8%AD.md')).toBe('https://dav.example.com/dav/%E4%B8%AD.md')
    expect(resolveScopedUpstreamUrl('https://api.example.com/v1', 'chat/completions?alt=sse'))
      .toBe('https://api.example.com/v1/chat/completions?alt=sse')
  })

  it('rejects absolute / protocol-relative / backslash / traversal escapes', () => {
    for (const p of [
      'http://evil.com/x', 'https://evil.com/x', '///evil.com/x', '//evil.com/x',
      '\\\\evil.com\\x', '/\\\\evil.com/x', '\\/evil.com/x', '../x', '/../../etc', '/%2e%2e/x',
      'https://dav.example.com:8443/dav/x', 'http://dav.example.com/dav/x',
      'https://user:pw@dav.example.com/dav/x', 'javascript:alert(1)',
    ]) {
      expect(resolveScopedUpstreamUrl(base, p), p).toBeNull()
    }
  })

  it('rejects invalid base', () => {
    expect(resolveScopedUpstreamUrl('https://127.0.0.1/dav/', '/x')).toBeNull()
    expect(resolveScopedUpstreamUrl('not a url', '/x')).toBeNull()
  })

  it('isWithinUpstreamScope checks origin + path prefix', () => {
    expect(isWithinUpstreamScope(base, 'https://dav.example.com/dav/a/b')).toBe(true)
    expect(isWithinUpstreamScope(base, 'https://dav.example.com/other')).toBe(false)
    expect(isWithinUpstreamScope(base, 'https://dav.example.com/dav')).toBe(false)
    expect(isWithinUpstreamScope(base, 'https://evil.com/dav/a')).toBe(false)
    expect(isWithinUpstreamScope(base, 'not a url')).toBe(false)
  })
})


