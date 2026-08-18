import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readWorkbook } from '../xlsx/workbook.ts'
import { buildSections } from './rows.ts'
import { bundleSubject, bytesOf, sectionsForSubject, subjectsIn } from './bundle.ts'
import { subjectCode, termCode } from '../../src/domain/ids.ts'
import { termCalendar } from '../../src/domain/time.ts'
import type { Section } from '../../src/domain/section.ts'

const FIXTURE = resolve(process.cwd(), 'tests/fixtures/eecs-4269.xlsx')
const fall = termCalendar(termCode('4269'), '2026-08-24', '2026-12-18')

const eecs = async (): Promise<readonly Section[]> =>
  buildSections(readWorkbook(new Uint8Array(await readFile(FIXTURE))).slice(1), fall)

describe('subjectsIn', () => {
  it('lists the subjects present', async () => {
    expect(subjectsIn(await eecs())).toEqual(['EECS'])
  })

  it('sorts, so an unchanged rebuild is byte-identical', async () => {
    // An unsorted set reorders on any upstream reshuffle and turns a no-op
    // rebuild into a diff nobody can read.
    const sections = await eecs()
    expect(subjectsIn([...sections].reverse())).toEqual(subjectsIn(sections))
  })
})

describe('sectionsForSubject', () => {
  it('keeps only that subject, in the export order', async () => {
    const sections = await eecs()
    const picked = sectionsForSubject(sections, subjectCode('EECS'))
    expect(picked).toEqual(sections)
  })

  it('is empty for a subject with nothing in it', async () => {
    expect(sectionsForSubject(await eecs(), subjectCode('MATH'))).toEqual([])
  })

  it('matches the whole subject, never a prefix of one', async () => {
    // 'EE' must not collect EECS. The key is split on its separator rather
    // than compared as text, so this cannot regress into a startsWith.
    expect(sectionsForSubject(await eecs(), subjectCode('EE'))).toEqual([])
  })
})

describe('bundleSubject', () => {
  it('carries the epoch its day offsets are measured from', async () => {
    // A file of integers that does not name its own origin is meaningless, and
    // a client guessing the epoch is wrong in a way nothing throws on.
    const bundle = bundleSubject(await eecs(), subjectCode('EECS'), fall)
    expect(bundle).toMatchObject({
      term: '4269',
      subject: 'EECS',
      startDate: '2026-08-24',
      endDate: '2026-12-18',
    })
  })

  it('bundles every section of the subject', async () => {
    const sections = await eecs()
    const bundle = bundleSubject(sections, subjectCode('EECS'), fall)
    expect(bundle.sections).toHaveLength(sections.length)
  })
})

describe('bytesOf', () => {
  it('round-trips through JSON unchanged', async () => {
    const bundle = bundleSubject(await eecs(), subjectCode('EECS'), fall)
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytesOf(bundle)))
    expect(parsed).toEqual(JSON.parse(JSON.stringify(bundle)))
  })

  it('preserves the values a naive encoder would damage', async () => {
    // Section labels keep leading zeros, day masks and minute offsets are
    // integers, and an absent cross-listing stays null rather than becoming 0.
    const bundle = bundleSubject(await eecs(), subjectCode('EECS'), fall)
    const text = new TextDecoder().decode(bytesOf(bundle))
    const parsed = JSON.parse(text) as { sections: Section[] }
    const first = parsed.sections[0]
    expect(typeof first?.number).toBe('string')
    expect(first?.combSectId === null || typeof first?.combSectId === 'number').toBe(true)
    expect(text).not.toContain('undefined')
  })

  it('is compact and newline-terminated', async () => {
    // Whitespace is a third of a payload of this shape and nothing reads these
    // by eye; the newline is so the files behave in a terminal and in git.
    const text = new TextDecoder().decode(bytesOf(bundleSubject(await eecs(), subjectCode('EECS'), fall)))
    expect(text.endsWith('\n')).toBe(true)
    expect(text).not.toContain('\n  ')
  })

  it('is deterministic', async () => {
    const bundle = bundleSubject(await eecs(), subjectCode('EECS'), fall)
    expect(bytesOf(bundle)).toEqual(bytesOf(bundle))
  })
})
