import { describe, expect, it } from 'vitest'
import { countMatches, searchCourses, SEARCH_LIMIT } from './search.ts'
import { courseKey, subjectCode } from '../domain/ids.ts'
import type { CourseEntry } from '../data/catalog.ts'

const course = (subject: string, number: string, title: string): CourseEntry => ({
  key: courseKey(subject, number),
  subject: subjectCode(subject),
  number,
  title,
  sectionCount: 1,
})

const catalog: readonly CourseEntry[] = [
  course('EECS', '101', 'New Student Seminar'),
  course('EECS', '168', 'Programming I'),
  course('EECS', '169', 'Programming I Laboratory'),
  course('EECS', '268', 'Programming II'),
  course('CHEM', '130', 'General Chemistry I'),
  course('CHEM', '624', 'Organic Chemistry Lab'),
  course('MATH', '125', 'Calculus I'),
]

describe('searchCourses', () => {
  it('shows nothing until something is typed', () => {
    // The catalogue stays hidden by default; that is the whole point.
    for (const empty of ['', '   ', '\t']) {
      expect(searchCourses(catalog, empty)).toEqual([])
    }
  })

  it('finds a course whether or not the space is typed', () => {
    // The one thing people are genuinely inconsistent about.
    for (const query of ['EECS 168', 'eecs168', '  eecs  168 ', 'EeCs168']) {
      expect(searchCourses(catalog, query).map((c) => c.key), query).toContain('EECS|168')
    }
  })

  it('puts the exact code first, ahead of a longer code that starts with it', () => {
    // Typing a full course number and getting its neighbour first is the
    // fastest way to make search feel broken.
    expect(searchCourses(catalog, 'EECS 16')[0]?.key).toBe('EECS|168')
    expect(searchCourses(catalog, 'EECS 168')[0]?.key).toBe('EECS|168')
  })

  it('ranks a code match above a title match', () => {
    // 'EECS 1' should reach EECS 101 before anything merely titled that way.
    const results = searchCourses(catalog, 'EECS 1')
    expect(results.slice(0, 3).every((c) => c.subject === 'EECS')).toBe(true)
  })

  it('lists a whole subject when only the subject is typed', () => {
    // The one case where showing many courses is what was actually asked for.
    const results = searchCourses(catalog, 'EECS')
    expect(results).toHaveLength(4)
  })

  it('searches titles, for the student who knows the name not the number', () => {
    expect(searchCourses(catalog, 'organic').map((c) => c.key)).toEqual(['CHEM|624'])
    expect(searchCourses(catalog, 'calculus').map((c) => c.key)).toEqual(['MATH|125'])
  })

  it('matches titles case-insensitively and mid-word', () => {
    expect(searchCourses(catalog, 'CHEMISTRY')).toHaveLength(2)
  })

  it('returns nothing rather than something close', () => {
    // A student who types a number and gets a plausible different course has
    // no way to notice, so near-misses are worse than no result.
    expect(searchCourses(catalog, 'EECS 999')).toEqual([])
    expect(searchCourses(catalog, 'zzzz')).toEqual([])
  })

  it('caps what it returns', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      course('EECS', String(100 + i), `Course ${i}`),
    )
    expect(searchCourses(many, 'EECS')).toHaveLength(SEARCH_LIMIT)
    expect(searchCourses(many, 'EECS', 5)).toHaveLength(5)
  })

  it('keeps catalogue order within a rank, so results do not reshuffle', () => {
    // As the query grows by a character, results should settle rather than
    // rearrange under the cursor.
    expect(searchCourses(catalog, 'EECS').map((c) => c.number)).toEqual(['101', '168', '169', '268'])
  })
})

describe('countMatches', () => {
  it('counts past the cap, so the UI can say there are more', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      course('EECS', String(100 + i), `Course ${i}`),
    )
    expect(countMatches(many, 'EECS')).toBe(200)
    expect(searchCourses(many, 'EECS')).toHaveLength(SEARCH_LIMIT)
  })
})
