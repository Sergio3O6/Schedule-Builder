import { describe, expect, it } from 'vitest'
import {
  buildExportUrl,
  buildSearchParams,
  CREATE_XLS_URL,
  USER_AGENT,
} from './request.ts'

describe('buildSearchParams', () => {
  it('pins all three inverted flags to false', () => {
    // The whole point of the file. If any of these flips, rows vanish silently
    // and every downstream count is quietly wrong.
    const p = buildSearchParams({ term: '4269', subject: 'EECS' })
    expect(p.get('searchClosed')).toBe('false')
    expect(p.get('searchShortClasses')).toBe('false')
    expect(p.get('searchHonorsClasses')).toBe('false')
  })

  it('requests every meeting pattern, not one row per section', () => {
    const p = buildSearchParams({ term: '4269', subject: 'EECS' })
    expect(p.get('oneRowLimit')).toBe('false')
  })

  it('serializes booleans as strings, the way jQuery $.param does', () => {
    const p = buildSearchParams({ term: '4269' })
    for (const key of ['searchClosed', 'searchShortClasses', 'searchHonorsClasses']) {
      expect(p.get(key)).toMatch(/^(true|false)$/)
    }
  })

  it('scopes to a subject when one is given', () => {
    expect(buildSearchParams({ term: '4269', subject: 'BIOL' }).get('searchSubject')).toBe('BIOL')
  })

  it('sends an empty subject for a whole-term request', () => {
    // Subject is not server-required; the "large search" guard is a client-side
    // confirm() only. An empty string is what the form itself submits.
    const p = buildSearchParams({ term: '4269' })
    expect(p.get('searchSubject')).toBe('')
    expect(p.has('searchSubject')).toBe(true)
  })

  it('requests both careers, since there is no "any" option', () => {
    expect(buildSearchParams({ term: '4269' }).get('searchCareer')).toBe('UndergraduateGraduate')
  })

  it('carries the term through', () => {
    expect(buildSearchParams({ term: '4266' }).get('searchTerm')).toBe('4266')
  })

  it('includes every field the form posts, empty ones included', () => {
    const p = buildSearchParams({ term: '4269' })
    for (const key of [
      'classesSearchText',
      'searchSchool',
      'searchDept',
      'searchCode',
      'textbookOptions',
      'searchCampus',
      'searchBuilding',
      'searchCourseNumberMin',
      'searchCourseNumberMax',
      'searchCreditHours',
      'searchInstructor',
      'searchStartTime',
      'searchEndTime',
      'searchOnlineClasses',
      'searchDays',
    ]) {
      expect(p.has(key), `missing form field: ${key}`).toBe(true)
    }
  })
})

describe('buildExportUrl', () => {
  it('targets the published export endpoint', () => {
    expect(buildExportUrl({ term: '4269', subject: 'EECS' }).startsWith(`${CREATE_XLS_URL}?`)).toBe(
      true,
    )
  })

  it('produces a parseable absolute URL', () => {
    const url = new URL(buildExportUrl({ term: '4269', subject: 'EECS' }))
    expect(url.host).toBe('classes.ku.edu')
    expect(url.pathname).toBe('/Classes/CreateXLS.action')
    expect(url.searchParams.get('searchSubject')).toBe('EECS')
  })
})

describe('USER_AGENT', () => {
  it('carries a contact address so KU can ask us to stop', () => {
    expect(USER_AGENT).toMatch(/@/)
    expect(USER_AGENT).toMatch(/KU-Schedule-Builder/)
  })
})
