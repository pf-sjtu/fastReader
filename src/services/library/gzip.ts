/** gzip 文本压缩（浏览器/Node 18+ 内置 CompressionStream）。书库索引是几百本书的 JSON，压缩后通常只剩 1/5–1/8 */

/** 经 writer 喂数据：只依赖 Uint8Array，不用 Blob.stream()（旧 Safari / jsdom 没有） */
export async function pipeBytes(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<ArrayBuffer> {
  const writer = stream.writable.getWriter()
  void writer.write(data as unknown as BufferSource).then(() => writer.close())
  return new Response(stream.readable).arrayBuffer()
}

export const gzipText = (text: string): Promise<ArrayBuffer> => pipeBytes(new TextEncoder().encode(text), new CompressionStream('gzip'))

export async function gunzipToText(buf: ArrayBuffer): Promise<string> {
  return new TextDecoder().decode(await pipeBytes(new Uint8Array(buf), new DecompressionStream('gzip')))
}

/** gzip 魔数 1f 8b：用来判断读到的是压缩文件还是旧的明文 JSON */
export function isGzip(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength))
  return b.length === 2 && b[0] === 0x1f && b[1] === 0x8b
}
