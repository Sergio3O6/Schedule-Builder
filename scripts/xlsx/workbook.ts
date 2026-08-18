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

import { crc32, inflateRawSync } from 'node:zlib'

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
 * Ceiling on what one member may inflate to.
 *
 * Measured: the whole-term sheet is 18.2MB inflated from a 1.9MB archive, a
 * ratio of about ten. This leaves seven times that headroom, so it cannot fire
 * on a real export, and it turns the pathological case — a small archive
 * engineered to inflate to hundreds of megabytes — into an error naming the
 * member rather than a process dying of memory exhaustion.
 */
const MAX_MEMBER_BYTES = 128 * 1024 * 1024

/**
 * Cheap check that bytes are plausibly a zip, and therefore plausibly an xlsx.
 *
 * Exists so callers can reject a wrong response *before* storing it. KU answers
 * a search with no results using HTTP 200 and an HTML page, so status codes
 * alone cannot tell an export from an error.
 */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 && // P
    bytes[1] === 0x4b && // K
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  )
}

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

  // Zero entries is the one count that never gets validated by the loop below,
  // because the loop does not run. Four bytes of trailing data reading
  // PK\x05\x06 followed by zeros is a well-formed record describing an empty
  // archive, and it used to be accepted — surfacing much later as the
  // misleading "workbook contains no worksheet". An xlsx always has members.
  if (totalEntries === 0) throw new Error('zip archive declares no members')

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
    const expectedCrc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localHeaderOffset = view.getUint32(cursor + 42, true)

    const nameStart = cursor + CENTRAL_DIR_ENTRY_MIN_SIZE
    if (nameStart + nameLength > bytes.byteLength) {
      throw new Error(`truncated member name at central directory entry ${i}`)
    }
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength))

    // Names are unique in any archive a writer produces on purpose. A duplicate
    // would silently overwrite, and the last one would win — which is exactly
    // how a second xl/worksheets/sheet1.xml would slip past the single-sheet
    // check in readWorkbook and be read instead of the real one.
    if (entries.has(name)) throw new Error(`duplicate zip member: ${name}`)

    entries.set(
      name,
      readMember(bytes, view, {
        offset: localHeaderOffset,
        method,
        compressedSize,
        uncompressedSize,
        expectedCrc,
        name,
      }),
    )
    cursor += CENTRAL_DIR_ENTRY_MIN_SIZE + nameLength + extraLength + commentLength
  }

  return entries
}

function findEndOfCentralDirectory(view: DataView, length: number): number {
  // Scan backwards: the record sits at the very end unless a zip comment follows.
  const earliest = Math.max(0, length - EOCD_MIN_SIZE - 0xffff)
  for (let i = length - EOCD_MIN_SIZE; i >= earliest; i -= 1) {
    if (view.getUint32(i, true) !== EOCD_SIGNATURE) continue

    // The signature alone is four bytes and can occur in ordinary data. A real
    // record ends the file exactly: its own 22 bytes plus the comment it
    // declares. Without this test, trailing bytes that happen to contain
    // PK\x05\x06 are read as an archive of zero entries — no error, just an
    // empty result that surfaces later as the misleading "contains no
    // worksheet".
    const commentLength = view.getUint16(i + 20, true)
    if (i + EOCD_MIN_SIZE + commentLength === length) return i
  }
  throw new Error('not a zip archive: no end-of-central-directory record found')
}

/** What the central directory says about one member. */
interface MemberHeader {
  readonly offset: number
  readonly method: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly expectedCrc: number
  readonly name: string
}

function readMember(bytes: Uint8Array, view: DataView, header: MemberHeader): Uint8Array {
  const { offset, method, compressedSize, name } = header

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

  // subarray CLAMPS rather than throwing, so a declared size that runs past the
  // end of the file yields a short buffer with no complaint. For a DEFLATED
  // member inflate then fails loudly, but a STORED one would be returned as-is:
  // silently short, or silently containing the central directory that follows
  // it. Checking the declared extent is the only place this can be caught.
  if (start + compressedSize > bytes.byteLength) {
    throw new Error(
      `member ${name} declares ${compressedSize} bytes at ${start}, past the end of ` +
        `the ${bytes.byteLength}-byte archive`,
    )
  }
  const payload = bytes.subarray(start, start + compressedSize)

  const content = decompress(payload, method, name)
  verifyIntegrity(content, header)
  return content
}

function decompress(payload: Uint8Array, method: number, name: string): Uint8Array {
  if (method === STORED) return payload
  if (method === DEFLATED) {
    return new Uint8Array(inflateRawSync(payload, { maxOutputLength: MAX_MEMBER_BYTES }))
  }
  throw new Error(`unsupported compression method ${method} for ${name}`)
}

/**
 * The check that makes a corrupted export loud instead of plausible.
 *
 * Every other guard in this reader is structural: it establishes that the bytes
 * are shaped like an archive. None of them says the bytes are the ones the
 * writer produced. Inflate is not that check either — a deflate stream stays
 * decodable under most single-bit damage, so a flipped bit inside it yields a
 * shorter, longer or simply different document with no complaint, and a cell
 * reading "Location" comes back "LocatLon".
 *
 * That failure is uniquely bad here because the export is cached on disk and
 * re-read on every run, so one corrupt byte silently poisons every schedule
 * built from it, indefinitely. The archive already carries the answer: a CRC-32
 * and an uncompressed length sit in the central directory, eight and four bytes
 * from the compressed size this reader was already using.
 *
 * The length is checked as well as the CRC. It costs nothing, it catches the
 * truncation cases a CRC would also catch but reports them far more legibly,
 * and it is the only check a STORED member gets from its own structure.
 */
function verifyIntegrity(content: Uint8Array, header: MemberHeader): void {
  const { uncompressedSize, expectedCrc, name } = header

  if (content.byteLength !== uncompressedSize) {
    throw new Error(
      `member ${name} unpacked to ${content.byteLength} bytes, but the archive ` +
        `declares ${uncompressedSize}`,
    )
  }

  // crc32 returns an unsigned 32-bit value, matching the field's encoding.
  const actual = crc32(content)
  if (actual !== expectedCrc) {
    throw new Error(
      `member ${name} failed its checksum: the archive declares ` +
        `${expectedCrc.toString(16).padStart(8, '0')} and the content is ` +
        `${actual.toString(16).padStart(8, '0')} — the file is corrupt, not merely unexpected`,
    )
  }
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

/**
 * An attribute list, allowing '>' inside a quoted value.
 *
 * `[^>]*` is the obvious way to write this and it is wrong: `>` is perfectly
 * legal inside an attribute value, and XML writers are not required to escape
 * it. When one appears, the tag match ends early, the truncated attributes no
 * longer contain `r=`, and the cell is DROPPED — the only failure in this file
 * that loses data instead of throwing. A row would come back one column short
 * with nothing anywhere reporting a problem.
 */
const ATTRS = String.raw`(?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*`

/**
 * `<tag …/>` or `<tag …>body</tag>`, body in group 1.
 *
 * The attribute pattern spells out name=value structure rather than "quoted
 * strings or anything that is not '>'". The loose version reads plausibly and
 * is catastrophic: from `<row r="1"><c r="A1"` the quoted alternative can pair
 * the closing quote of one attribute with the opening quote of the NEXT
 * element's, stepping over the `>` between them, and from there it consumes the
 * whole document and returns one match. Requiring `>` to appear only inside a
 * value that follows an `=` keeps the escape hatch and closes the hole.
 *
 * No \b after the tag name: an empty attribute list must be followed
 * immediately by `>` or `/>`, so `<rowBreak>` cannot match `<row`.
 */
const bodyOf = (tag: string): RegExp =>
  new RegExp(`<${tag}${ATTRS}/>|<${tag}${ATTRS}>([\\s\\S]*?)</${tag}>`, 'g')

const T_ELEMENT = bodyOf('t')
const SI_ELEMENT = bodyOf('si')
const ROW_ELEMENT = bodyOf('row')
const RPH_ELEMENT = bodyOf('rPh')
const V_ELEMENT = new RegExp(`<v${ATTRS}>([\\s\\S]*?)</v>`)
const CELL_ELEMENT = new RegExp(`<c(${ATTRS})/>|<c(${ATTRS})>([\\s\\S]*?)</c>`, 'g')
const COMMENT = /<!--[\s\S]*?-->/g

/**
 * Removes anything that looks like markup but is not, and refuses what cannot
 * be handled by matching.
 *
 * A comment containing a `<c>` element is read as a real cell by a
 * regex-and-hope reader, and CDATA hides markup characters from every pattern
 * here. Neither appears in KU's output; the point is that if either ever does,
 * this says so rather than quietly returning different numbers.
 */
function prepareXml(xml: string): string {
  if (xml.includes('<![CDATA[')) {
    throw new Error('worksheet XML contains CDATA, which this reader does not parse')
  }
  return xml.includes('<!--') ? xml.replace(COMMENT, '') : xml
}

/**
 * Concatenated text of every <t> in a fragment, rich-text runs included.
 *
 * Phonetic runs are dropped first. `<rPh>` carries a pronunciation guide for
 * the text around it — furigana, in practice — and its `<t>` elements are
 * indistinguishable from real ones here, so leaving them in appends a reading
 * to the string it annotates.
 */
function textOf(fragment: string): string {
  const text = fragment.includes('<rPh') ? fragment.replace(RPH_ELEMENT, '') : fragment

  let out = ''
  for (const match of text.matchAll(T_ELEMENT)) {
    out += unescapeXml(match[1] ?? '')
  }
  return out
}

/** The shared string table, indexed as the sheet references it. */
export function parseSharedStrings(xml: string): string[] {
  return [...prepareXml(xml).matchAll(SI_ELEMENT)].map((m) => textOf(m[1] ?? ''))
}

/** Column letters from a cell reference: "AB12" -> "AB". */
function columnOf(ref: string): string {
  const match = /^([A-Z]+)/.exec(ref)
  if (!match?.[1]) throw new Error(`unparseable cell reference: ${ref}`)
  return match[1]
}

export function parseSheet(xml: string, sharedStrings: readonly string[]): SheetRow[] {
  const rows: SheetRow[] = []

  for (const rowMatch of prepareXml(xml).matchAll(ROW_ELEMENT)) {
    const body = rowMatch[1] ?? ''
    const cells = new Map<string, string>()

    for (const cellMatch of body.matchAll(CELL_ELEMENT)) {
      const attrs = cellMatch[1] ?? cellMatch[2] ?? ''
      const content = cellMatch[3] ?? ''

      const ref = /\br="([^"]+)"/.exec(attrs)?.[1]
      if (ref === undefined) {
        // The spec permits a positional cell with no r=, and KU emits r= on
        // every one of the 17,338 x 32. Skipping was the old behaviour and it
        // silently shifted nothing while quietly losing a value; if the
        // generator ever changes, that is worth hearing about immediately.
        throw new Error(`cell with no r= reference in <c ${attrs.trim()}>`)
      }
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

  const raw = V_ELEMENT.exec(content)?.[1]
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
 * Decodes a member as UTF-8, refusing anything that plainly is not.
 *
 * A UTF-16 part is legal XML and decodes here into text interleaved with NUL
 * bytes, which matches no pattern in this file — the result is not an error but
 * an empty sheet. TextDecoder is also lenient by default, turning invalid bytes
 * into U+FFFD, so a mis-encoded course title would arrive quietly mangled;
 * `fatal` makes that a failure instead.
 */
function decodeUtf8(bytes: Uint8Array, name: string): string {
  const [b0, b1] = bytes
  if ((b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff)) {
    throw new Error(`${name} is UTF-16; this reader handles UTF-8 only`)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${name} is not valid UTF-8`)
  }
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

  const sharedStringsXml = entries.get('xl/sharedStrings.xml')
  const sharedStrings =
    sharedStringsXml === undefined
      ? []
      : parseSharedStrings(decodeUtf8(sharedStringsXml, 'xl/sharedStrings.xml'))

  const sheetXml = entries.get(sheetName)
  if (sheetXml === undefined) throw new Error(`worksheet ${sheetName} is missing its data`)

  return parseSheet(decodeUtf8(sheetXml, sheetName), sharedStrings)
}
