/**
 * A deliberately small .xlsx reader: enough to read KU's export, and nothing else.
 *
 * Why hand-rolled rather than a library: the input is one generator producing one
 * shape — a single sheet, shared strings, no formulas, no styles we care about —
 * and every full-featured parser is a megabyte of surface area for the 32 columns
 * we actually want. Node ships inflate, and the ZIP container is a fixed format.
 * The tradeoff is that bugs here are ours; the upside is that fixes here are ours
 * too, and there is no supply chain on a project that is meant to cost $0.
 *
 * Anything outside the narrow shape we expect throws loudly rather than being
 * guessed at. A silently misread spreadsheet is the worst possible failure for
 * this project: it produces schedules that look plausible and are wrong.
 */

import { inflateRawSync } from 'node:zlib'

/** One row, keyed by column letter: "A" -> "EECS". Absent cells are absent. */
export type SheetRow = ReadonlyMap<string, string>

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIR_SIGNATURE = 0x02014b50
const LOCAL_HEADER_SIGNATURE = 0x04034b50

/** End-of-central-directory record, without a zip comment. */
const EOCD_MIN_SIZE = 22
const CENTRAL_DIR_ENTRY_MIN_SIZE = 46
const LOCAL_HEADER_MIN_SIZE = 30

const STORED = 0
const DEFLATED = 8

/** Sentinels meaning "the real value lives in a zip64 record". */
const ZIP64_U16 = 0xffff
const ZIP64_U32 = 0xffffffff

/**
 * Extracts the zip members by name.
 *
 * Reads the central directory rather than walking local headers: local headers
 * may carry zero sizes with the real values in a trailing data descriptor, so
 * the central directory is the only index that can be trusted without guessing.
 */
export function readZipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEndOfCentralDirectory(view, bytes.byteLength)

  const totalEntries = view.getUint16(eocd + 10, true)
  const centralDirOffset = view.getUint32(eocd + 16, true)
  if (totalEntries === ZIP64_U16 || centralDirOffset === ZIP64_U32) {
    throw new Error('zip64 archives are not supported (KU exports are far below the limit)')
  }

  const entries = new Map<string, Uint8Array>()
  let cursor = centralDirOffset

  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + CENTRAL_DIR_ENTRY_MIN_SIZE > bytes.byteLength) {
      throw new Error(`truncated central directory at entry ${i}`)
    }
    if (view.getUint32(cursor, true) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`bad central directory signature at entry ${i}`)
    }

    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localHeaderOffset = view.getUint32(cursor + 42, true)

    const name = new TextDecoder().decode(
      bytes.subarray(cursor + CENTRAL_DIR_ENTRY_MIN_SIZE, cursor + CENTRAL_DIR_ENTRY_MIN_SIZE + nameLength),
    )

    entries.set(name, readMember(bytes, view, localHeaderOffset, method, compressedSize, name))
    cursor += CENTRAL_DIR_ENTRY_MIN_SIZE + nameLength + extraLength + commentLength
  }

  return entries
}

function findEndOfCentralDirectory(view: DataView, length: number): number {
  // Scan backwards: the record sits at the very end unless a zip comment follows.
  const earliest = Math.max(0, length - EOCD_MIN_SIZE - 0xffff)
  for (let i = length - EOCD_MIN_SIZE; i >= earliest; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i
  }
  throw new Error('not a zip archive: no end-of-central-directory record found')
}

function readMember(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  method: number,
  compressedSize: number,
  name: string,
): Uint8Array {
  if (offset + LOCAL_HEADER_MIN_SIZE > bytes.byteLength) {
    throw new Error(`truncated local header for ${name}`)
  }
  if (view.getUint32(offset, true) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error(`bad local header signature for ${name}`)
  }

  // Name and extra lengths are re-read here: the central directory's extra field
  // and the local header's are allowed to differ in length.
  const nameLength = view.getUint16(offset + 26, true)
  const extraLength = view.getUint16(offset + 28, true)
  const start = offset + LOCAL_HEADER_MIN_SIZE + nameLength + extraLength
  const payload = bytes.subarray(start, start + compressedSize)

  if (method === STORED) return payload
  if (method === DEFLATED) return new Uint8Array(inflateRawSync(payload))
  throw new Error(`unsupported compression method ${method} for ${name}`)
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/**
 * Resolves XML entities in text content.
 *
 * Not optional: six of KU's 292 subject codes contain an ampersand and arrive as
 * `C&amp;PE`. Skipping this stage yields subject codes that match nothing.
 */
export function unescapeXml(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    }
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    return ENTITIES[body] ?? match
  })
}

/** Concatenated text of every <t> in a fragment, runs included. */
function textOf(fragment: string): string {
  let out = ''
  for (const match of fragment.matchAll(/<t\b[^>]*\/>|<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
    out += unescapeXml(match[1] ?? '')
  }
  return out
}

/** The shared string table, indexed as the sheet references it. */
export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*\/>|<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    textOf(m[1] ?? ''),
  )
}

/** Column letters from a cell reference: "AB12" -> "AB". */
function columnOf(ref: string): string {
  const match = /^([A-Z]+)/.exec(ref)
  if (!match?.[1]) throw new Error(`unparseable cell reference: ${ref}`)
  return match[1]
}

export function parseSheet(xml: string, sharedStrings: readonly string[]): SheetRow[] {
  const rows: SheetRow[] = []

  for (const rowMatch of xml.matchAll(/<row\b[^>]*\/>|<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const body = rowMatch[1] ?? ''
    const cells = new Map<string, string>()

    for (const cellMatch of body.matchAll(/<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] ?? cellMatch[2] ?? ''
      const content = cellMatch[3] ?? ''

      const ref = /\br="([^"]+)"/.exec(attrs)?.[1]
      if (ref === undefined) continue // a cell with no reference has no column to live in
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n'

      cells.set(columnOf(ref), cellValue(type, content, sharedStrings, ref))
    }

    rows.push(cells)
  }

  return rows
}

function cellValue(
  type: string,
  content: string,
  sharedStrings: readonly string[],
  ref: string,
): string {
  if (type === 'inlineStr') return textOf(content)

  const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(content)?.[1]
  if (raw === undefined) return ''

  if (type === 's') {
    const index = Number.parseInt(raw, 10)
    const resolved = sharedStrings[index]
    if (resolved === undefined) {
      throw new Error(`cell ${ref} references shared string ${index}, which does not exist`)
    }
    return resolved
  }

  return unescapeXml(raw)
}

/**
 * Every row of the workbook's only sheet.
 *
 * KU's export is single-sheet. If that ever changes we want to know rather than
 * silently reading whichever one sorted first.
 */
export function readWorkbook(bytes: Uint8Array): SheetRow[] {
  const entries = readZipEntries(bytes)

  const sheetNames = [...entries.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  const sheetName = sheetNames[0]
  if (sheetName === undefined) throw new Error('workbook contains no worksheet')
  if (sheetNames.length > 1) {
    throw new Error(`expected a single-sheet workbook, found ${sheetNames.length}`)
  }

  const decoder = new TextDecoder()
  const sharedStringsXml = entries.get('xl/sharedStrings.xml')
  const sharedStrings =
    sharedStringsXml === undefined ? [] : parseSharedStrings(decoder.decode(sharedStringsXml))

  const sheetXml = entries.get(sheetName)
  if (sheetXml === undefined) throw new Error(`worksheet ${sheetName} is missing its data`)

  return parseSheet(decoder.decode(sheetXml), sharedStrings)
}
