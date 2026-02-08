/**
 * Mock for @ssshooter/epubjs
 */

let shouldFailNextOpen = false

export function setShouldFailNextOpen(value: boolean) {
  shouldFailNextOpen = value
}

export class Book {
  packaging = {
    metadata: {
      title: 'Mock Book',
      creator: 'Mock Author'
    }
  }
  loaded = {
    navigation: Promise.resolve({ toc: [] }),
    metadata: Promise.resolve({ title: 'Mock Book', creator: 'Mock Author' }),
    spine: Promise.resolve({ items: [] }),
  }
  spine = {
    each: (fn: (item: unknown, index: number) => void) => {
      void fn
    },
    get: (index: number) => {
      void index
      return null
    },
  }
  archive = {
    zip: {},
  }

  constructor() {}

  async open(arrayBuffer: ArrayBuffer) {
    if (shouldFailNextOpen || arrayBuffer.byteLength === 0) {
      throw new Error('Invalid EPUB')
    }
    return Promise.resolve()
  }

  get ready() {
    return Promise.resolve()
  }

  destroy() {}
}

export class Rendition {
  constructor() {}
  attachTo() {}
  display() {}
}

export interface NavItem {
  id: string
  label: string
  href: string
  subitems?: NavItem[]
}

export default function ePub(data?: unknown) {
  void data
  return new Book()
}
