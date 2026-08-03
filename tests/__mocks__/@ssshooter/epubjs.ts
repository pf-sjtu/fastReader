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
  /** 与真实 epubjs 一致：同步可读 navigation.toc（避免 book.navigation 为 undefined） */
  navigation = {
    toc: [] as NavItem[]
  }
  loaded = {
    navigation: Promise.resolve({ toc: [] as NavItem[] }),
    metadata: Promise.resolve({ title: 'Mock Book', creator: 'Mock Author' }),
    spine: Promise.resolve({ items: [] as unknown[] }),
  }
  spine = {
    spineItems: [] as Array<{ href: string; idref?: string }>,
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
