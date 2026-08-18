import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import {
  parseSharedStrings,
  parseSheet,
  readWorkbook,
  readZipEntries,
  unescapeXml,
} from './workbook.ts'

/**
 * A real KU export, captured from the live probe (EECS, Fall 2026, term 4269).
 * Synthetic fixtures would only prove the reader agrees with the writer in this
 * same file; the numbers below come from KU's actual generator.
 */
// Resolved from the project root rather than import.meta.url: under Vitest's
// module runner the latter is not a file: URL, so fileURLToPath rejects it.
const FIXTURE = resolve(process.cwd(), 'tests/fixtures/eecs-4269.xlsx')
const eecs = async () => new Uint8Array(await readFile(FIXTURE))

describe('unescapeXml', () => {
  it('resolves the entities KU actually emits', () => {
    // Six of the 292 subject codes contain an ampersand.
    expect(unescapeXml('C&amp;PE')).toBe('C&PE')
    expect(unescapeXml('LA&amp;S')).toBe('LA&S')
    expect(unescapeXml('&lt;tag&gt;')).toBe('<tag>')
    expect(unescapeXml('&quot;q&quot; &apos;a&apos;')).toBe('"q" \'a\'')
  })

  it('resolves numeric references', () => {
    expect(unescapeXml('&#65;&#x42;')).toBe('AB')
  })

  it('leaves unknown entities alone rather than dropping them', () => {
    expect(unescapeXml('&nosuch;')).toBe('&nosuch;')
  })

  it('passes through text with no entities untouched', () => {
    expect(unescapeXml('Introduction to Computing:')).toBe('Introduction to Computing:')
  })
})

describe('parseSharedStrings', () => {
  it('reads plain entries', () => {
    expect(parseSharedStrings('<sst><si><t>Course</t></si><si><t>Number</t></si></sst>')).toEqual([
      'Course',
      'Number',
    ])
  })

  it('concatenates rich-text runs into one string', () => {
    const xml = '<sst><si><r><t>Intro</t></r><r><t> to Computing</t></r></si></sst>'
    expect(parseSharedStrings(xml)).toEqual(['Intro to Computing'])
  })

  it('preserves an empty entry so indexes do not shift', () => {
    // Index alignment is everything: a dropped entry silently reassigns every
    // later string to the wrong cell.
    expect(parseSharedStrings('<sst><si><t/></si><si><t>B</t></si></sst>')).toEqual(['', 'B'])
  })

  it('unescapes entities in shared strings', () => {
    expect(parseSharedStrings('<sst><si><t>C&amp;PE</t></si></sst>')).toEqual(['C&PE'])
  })
})

describe('parseSheet', () => {
  it('keys cells by column letter', () => {
    const xml = '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>7</v></c></row></sheetData>'
    const rows = parseSheet(xml, ['EECS'])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.get('A')).toBe('EECS')
    expect(rows[0]?.get('B')).toBe('7')
  })

  it('handles multi-letter columns', () => {
    const xml = '<sheetData><row r="1"><c r="AF1"><v>0.0</v></c></row></sheetData>'
    expect(parseSheet(xml, [])[0]?.get('AF')).toBe('0.0')
  })

  it('omits absent cells rather than inventing empties', () => {
    const xml = '<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row></sheetData>'
    const row = parseSheet(xml, [])[0]
    expect(row?.has('B')).toBe(false)
    expect(row?.get('C')).toBe('3')
  })

  it('reads inline strings', () => {
    const xml = '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>LAWRENCE</t></is></c></row></sheetData>'
    expect(parseSheet(xml, [])[0]?.get('A')).toBe('LAWRENCE')
  })

  it('reads self-closing empty cells as empty', () => {
    const xml = '<sheetData><row r="1"><c r="A1"/><c r="B1"><v>x</v></c></row></sheetData>'
    const row = parseSheet(xml, [])
    expect(row[0]?.get('A')).toBe('')
    expect(row[0]?.get('B')).toBe('x')
  })

  it('keeps self-closing rows as rows', () => {
    const xml = '<sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="2"/></sheetData>'
    expect(parseSheet(xml, [])).toHaveLength(2)
  })

  it('throws rather than guessing when a shared string index is missing', () => {
    const xml = '<sheetData><row r="1"><c r="A1" t="s"><v>9</v></c></row></sheetData>'
    expect(() => parseSheet(xml, ['only-one'])).toThrow(/shared string 9/)
  })
})

describe('readZipEntries', () => {
  it('rejects input that is not a zip', () => {
    expect(() => readZipEntries(new TextEncoder().encode('not a zip at all'))).toThrow(
      /not a zip archive/,
    )
  })

  it('reads a deflated member', async () => {
    expect(readZipEntries(await eecs()).get('xl/workbook.xml')).toBeDefined()
  })

  it('inflates to well-formed XML', async () => {
    const entry = readZipEntries(await eecs()).get('xl/sharedStrings.xml')
    expect(entry).toBeDefined()
    expect(new TextDecoder().decode(entry!)).toContain('<sst')
  })

  it('reads a stored (uncompressed) member', () => {
    // KU deflates everything, but STORED is legal and cheap to support.
    const zip = buildZip([{ name: 'a.txt', data: new TextEncoder().encode('hello'), store: true }])
    expect(new TextDecoder().decode(readZipEntries(zip).get('a.txt')!)).toBe('hello')
  })

  it('rejects an unsupported compression method loudly', () => {
    const zip = buildZip([{ name: 'a.txt', data: new TextEncoder().encode('x'), method: 99 }])
    expect(() => readZipEntries(zip)).toThrow(/unsupported compression method 99/)
  })
})

describe('readZipEntries — archives that are wrong rather than absent', () => {
  it('refuses two members with the same name instead of keeping the last', () => {
    // Map.set overwrites in silence. Two members named xl/worksheets/sheet1.xml
    // would sail past readWorkbook's single-sheet check and the second would be
    // read as the data — the quietest possible way to read the wrong numbers.
    const zip = buildZip([
      { name: 'xl/worksheets/sheet1.xml', data: new TextEncoder().encode('<real/>') },
      { name: 'xl/worksheets/sheet1.xml', data: new TextEncoder().encode('<decoy/>') },
    ])
    expect(() => readZipEntries(zip)).toThrow(/duplicate zip member/)
  })

  it('refuses an archive that declares no members', () => {
    // Four bytes reading PK\x05\x06 and eighteen zeros is a well-formed record
    // for an empty archive. It used to be accepted and surfaced much later as
    // "workbook contains no worksheet", which points at the wrong problem.
    const emptyEocd = new Uint8Array(22)
    new DataView(emptyEocd.buffer).setUint32(0, 0x06054b50, true)
    expect(() => readZipEntries(emptyEocd)).toThrow(/declares no members/)
  })

  it('refuses trailing bytes after the end-of-central-directory record', () => {
    // The signature is four bytes and occurs in ordinary data. A real record
    // ends the file exactly: its 22 bytes plus the comment length it declares.
    const zip = buildZip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }])
    const withJunk = new Uint8Array(zip.byteLength + 8)
    withJunk.set(zip, 0)
    withJunk.set(new TextEncoder().encode('trailing'), zip.byteLength)

    expect(() => readZipEntries(withJunk)).toThrow(/not a zip archive/)
  })

  it('refuses a stored member that declares more bytes than the archive holds', () => {
    // subarray clamps rather than throwing, so this used to be returned as a
    // short buffer — or one containing the central directory that follows it —
    // with nothing reporting a problem. DEFLATED members fail loudly inside
    // inflate; STORED ones had no check at all.
    const zip = buildZip([
      { name: 'a.txt', data: new TextEncoder().encode('hello'), store: true, declaredSize: 5000 },
    ])
    expect(() => readZipEntries(zip)).toThrow(/past the end of the/)
  })

  it('still reads the real KU export unchanged', async () => {
    // All of the above is worthless if it rejects the one file that matters.
    const entries = readZipEntries(await eecs())
    expect(entries.size).toBe(9)
    expect(entries.get('xl/worksheets/sheet1.xml')?.byteLength).toBeGreaterThan(400_000)
  })
})

describe('XML shapes that used to corrupt silently', () => {
  it('keeps a cell whose attribute contains a literal >', () => {
    // The one failure in this reader that LOSES DATA rather than throwing.
    // '>' is legal inside an attribute value and writers need not escape it;
    // [^>]* ended the tag early, the truncated attributes no longer held r=,
    // and the cell was dropped — a row one column short, silently.
    // The offending attribute comes BEFORE r=, which is where it does damage:
    // the truncated attribute list no longer contains the reference at all.
    // Attribute order is the writer's choice, so this is not a contrived
    // arrangement — it is the half of the cases that lose the cell.
    const xml =
      '<sheetData><row r="1">' +
      '<c s="0" r="A1"><v>1</v></c>' +
      '<c x="a>b" r="B1" t="inlineStr"><is><t>kept</t></is></c>' +
      '<c s="0" r="C1"><v>3</v></c>' +
      '</row></sheetData>'
    const row = parseSheet(xml, [])[0]

    expect([...(row?.keys() ?? [])]).toEqual(['A', 'B', 'C'])
    expect(row?.get('B')).toBe('kept')
  })

  it('keeps a row whose own attribute contains a literal >', () => {
    const xml = '<sheetData><row x="a>b" r="1"><c r="A1"><v>7</v></c></row></sheetData>'
    expect(parseSheet(xml, [])[0]?.get('A')).toBe('7')
  })

  it('refuses a cell with no reference rather than dropping it', () => {
    const xml = '<sheetData><row r="1"><c t="n"><v>7</v></c></row></sheetData>'
    expect(() => parseSheet(xml, [])).toThrow(/no r= reference/)
  })

  it('ignores a commented-out cell instead of reading it as data', () => {
    const xml =
      '<sheetData><row r="1"><c r="A1"><v>real</v></c>' +
      '<!-- <c r="B1"><v>99</v></c> --></row></sheetData>'
    const row = parseSheet(xml, [])[0]

    expect(row?.get('A')).toBe('real')
    expect(row?.has('B')).toBe(false)
  })

  it('refuses CDATA rather than parsing around it', () => {
    // It hides markup characters from every pattern in this file, so the honest
    // answer is that this reader cannot read it.
    const xml = '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t><![CDATA[x]]></t></is></c></row></sheetData>'
    expect(() => parseSheet(xml, [])).toThrow(/CDATA/)
  })

  it('drops phonetic runs instead of appending them to the string', () => {
    // <rPh> carries a pronunciation guide for the text around it, and its <t>
    // elements are indistinguishable from real ones to a pattern match.
    const xml = '<sst><si><t>東京</t><rPh sb="0" eb="2"><t>とうきょう</t></rPh></si></sst>'
    expect(parseSharedStrings(xml)).toEqual(['東京'])
  })

  it('keeps a shared string whose attribute contains a literal >', () => {
    expect(parseSharedStrings('<sst><si x="a>b"><t>Intro</t></si></sst>')).toEqual(['Intro'])
  })

  it('reads a formula cell by its cached value, not its expression', () => {
    const xml = '<sheetData><row r="1"><c r="A1"><f>IF(B1&gt;2,1,0)</f><v>1</v></c></row></sheetData>'
    expect(parseSheet(xml, [])[0]?.get('A')).toBe('1')
  })
})

describe('readWorkbook against the real KU export', () => {
  it('reads the header row exactly as KU emits it', async () => {
    const rows = await readWorkbook(await eecs())
    const header = rows[0]
    expect(header?.get('A')).toBe('Course')
    expect(header?.get('B')).toBe('Number')
    expect(header?.get('F')).toBe('Class nbr')
    expect(header?.get('N')).toBe('Component')
    expect(header?.get('T')).toBe('Meeting days')
    expect(header?.get('AB')).toBe('Comb Sect ID')
  })

  it('finds the 423 data rows verified against the live probe', async () => {
    const rows = await readWorkbook(await eecs())
    // Header is row 1; row 2 is absent from KU's output entirely.
    expect(rows.length - 1).toBe(423)
  })

  it('preserves the leading space in Number', async () => {
    const rows = await readWorkbook(await eecs())
    expect(rows[1]?.get('B')).toBe(' 101')
  })

  it('reads the multi-pattern section that the solver depends on', async () => {
    // Class 22671 (EECS 220) meets MWF 12:00 and Tu 15:30 — two rows, one class.
    const rows = await readWorkbook(await eecs())
    const patterns = rows.filter((r) => r.get('F') === '22671')
    expect(patterns).toHaveLength(2)
    expect(patterns.map((r) => r.get('T')).sort()).toEqual(['MWF', 'Tu'])
  })

  it('surfaces the no-meeting-time sentinels verbatim, without interpreting them', async () => {
    // The reader must not "helpfully" normalize these; classification is the
    // domain layer's job and needs to see exactly what KU sent.
    const rows = await readWorkbook(await eecs())
    const starts = new Set(rows.slice(1).map((r) => r.get('R')))
    expect(starts).toContain('12:00 AM')
    expect(starts).toContain('APPT')
  })

  it('reads floats as the strings they are', async () => {
    const rows = await readWorkbook(await eecs())
    expect(rows[1]?.get('H')).toBe('1.0')
  })
})

/**
 * Minimal zip writer, for cases KU's own file cannot demonstrate.
 *
 * `declaredSize` writes a compressed size the payload does not have, which is
 * what a corrupted or hostile archive looks like from the index.
 */
function buildZip(
  files: {
    name: string
    data: Uint8Array
    store?: boolean
    method?: number
    declaredSize?: number
    /** Override the CRC-32, to build an archive that is corrupt on purpose. */
    crc?: number
    /** Override the declared uncompressed size, likewise. */
    declaredUncompressedSize?: number
  }[],
): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const method = file.method ?? (file.store ? 0 : 8)
    const payload = method === 8 ? new Uint8Array(deflateRawSync(file.data)) : file.data
    const declared = file.declaredSize ?? payload.length
    const crc = file.crc ?? crc32(file.data)
    const uncompressed = file.declaredUncompressedSize ?? file.data.length
    const name = new TextEncoder().encode(file.name)

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, method, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, declared, true)
    lv.setUint32(22, uncompressed, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)

    const entry = new Uint8Array(46 + name.length)
    const cv = new DataView(entry.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, method, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, declared, true)
    cv.setUint32(24, uncompressed, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    entry.set(name, 46)

    chunks.push(local, payload)
    central.push(entry)
    offset += local.length + payload.length
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const all = [...chunks, ...central, eocd]
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of all) {
    out.set(c, at)
    at += c.length
  }
  return out
}

describe('member integrity', () => {
  const hello = new TextEncoder().encode('hello world')

  it('accepts a member whose checksum matches', () => {
    const zip = buildZip([{ name: 'a.txt', data: hello }])
    const member = readZipEntries(zip).get('a.txt')
    expect(new TextDecoder().decode(member)).toBe('hello world')
  })

  it('refuses a member whose checksum does not match', () => {
    // The archive carries the answer eight bytes from the compressed size the
    // reader was already using. Not checking it meant a corrupt file read as a
    // plausible one.
    const zip = buildZip([{ name: 'a.txt', data: hello, crc: 0x12345678 }])
    expect(() => readZipEntries(zip)).toThrow(/a\.txt failed its checksum/)
  })

  it('says the file is corrupt rather than unexpected', () => {
    // The distinction matters operationally: an unexpected file is something to
    // reconcile, a corrupt one is something to delete and re-fetch.
    const zip = buildZip([{ name: 'a.txt', data: hello, crc: 1 }])
    expect(() => readZipEntries(zip)).toThrow(/the file is corrupt, not merely unexpected/)
  })

  it('catches a single flipped bit inside a deflate stream', () => {
    // This is the failure that motivated the check. A deflate stream stays
    // decodable under most single-bit damage, so inflate succeeds and returns a
    // different document: "Location" comes back "LocatLon" with no complaint.
    const data = new TextEncoder().encode('Location'.repeat(64))
    const zip = buildZip([{ name: 'a.txt', data }])
    const flipped = zip.slice()

    // Find a bit whose flip still inflates, then prove the CRC rejects it.
    let corrupted = false
    for (let i = 34; i < flipped.length - 22 && !corrupted; i += 1) {
      for (let bit = 0; bit < 8; bit += 1) {
        const candidate = flipped.slice()
        const byte = candidate[i]
        if (byte === undefined) continue
        candidate[i] = byte ^ (1 << bit)
        try {
          readZipEntries(candidate)
        } catch (error) {
          if (!/failed its checksum/.test((error as Error).message)) continue
          corrupted = true
          break
        }
      }
    }
    expect(corrupted).toBe(true)
  })

  it('refuses a member that unpacks to the wrong length', () => {
    // Cheaper than the CRC and far more legible when the cause is truncation.
    const zip = buildZip([{ name: 'a.txt', data: hello, declaredUncompressedSize: 5 }])
    expect(() => readZipEntries(zip)).toThrow(/unpacked to 11 bytes, but the archive declares 5/)
  })

  it('checks a stored member too, which has no other structural guard', () => {
    const zip = buildZip([{ name: 'a.txt', data: hello, store: true, crc: 0 }])
    expect(() => readZipEntries(zip)).toThrow(/failed its checksum/)
  })

  it('passes the real export unchanged', async () => {
    const bytes = await eecs()
    expect(() => readZipEntries(bytes)).not.toThrow()
  })
})
