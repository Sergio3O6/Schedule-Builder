/**
 * Builds the KU Schedule of Classes export request.
 *
 * Pure and network-free on purpose: every trap in this file is a value choice,
 * so the whole thing is assertable without touching KU's servers.
 *
 * Source of truth is `loadSearchOptions` in classes.js (the site's own search
 * form serializer). The export URL it produces is:
 *
 *   GET /Classes/CreateXLS.action?<params>&oneRowLimit=false
 *
 * `CreateXLS.action` is the site's published "Excel file" output option, not an
 * undocumented endpoint. It emits OOXML (.xlsx) despite the "XLS" name.
 */

export const CREATE_XLS_URL = 'https://classes.ku.edu/Classes/CreateXLS.action'

/**
 * Identifies the crawler and gives KU a way to ask us to stop. An anonymous UA
 * is worse etiquette, not better: it leaves a block as their only lever.
 */
export const USER_AGENT =
  'KU-Schedule-Builder/0.1 (student course-planning project; contact 24smedrano@gmail.com)'

/** PeopleSoft term code, e.g. "4269" = Fall 2026. */
export type TermCode = string

/** Subject code as it appears in the search form, e.g. "EECS". */
export type SubjectCode = string

export interface SearchScope {
  readonly term: TermCode
  /** Omit to request the whole term in one file. Subject is not server-required. */
  readonly subject?: SubjectCode
}

/**
 * Three checkboxes whose labels invert their sense. Each drops rows when true,
 * so all three are pinned false and none may be flipped without re-reading this.
 *
 *   searchClosed        "Don't show full and unopened sections"
 *                       -> true silently drops full sections. Verified: EECS
 *                          Fall 2026 returns 381 rows at true against 423 at
 *                          false, hiding e.g. EECS 138 section 6010 entirely.
 *   searchShortClasses  "Only sections that are not full term"
 *                       -> true drops every full-term section.
 *   searchHonorsClasses "Only honors courses"
 *                       -> true drops everything that is not honors.
 */
const INVERTED_FLAGS = {
  searchClosed: 'false',
  searchShortClasses: 'false',
  searchHonorsClasses: 'false',
} as const

/**
 * Careers are an explicit list with no "any" option. UndergraduateGraduate
 * expands server-side to UGDL + GRDL — Lawrence and Edwards, undergraduate and
 * graduate. The K codes are Med Center, not Edwards, so excluding them drops
 * KU Med, Law and Jayhawk Flex only.
 */
const CAREER = 'UndergraduateGraduate'

/**
 * jQuery's $.param serializes booleans as the strings "true"/"false", and the
 * form posts every field including the empty ones. Mirroring that exactly keeps
 * us on the path the server actually sees from a browser.
 */
export function buildSearchParams(scope: SearchScope): URLSearchParams {
  return new URLSearchParams({
    classesSearchText: '',
    searchCareer: CAREER,
    searchTerm: scope.term,
    searchSchool: '',
    searchDept: '',
    searchSubject: scope.subject ?? '',
    searchCode: '',
    textbookOptions: '',
    searchCampus: '',
    searchBuilding: '',
    searchCourseNumberMin: '',
    searchCourseNumberMax: '',
    searchCreditHours: '',
    searchInstructor: '',
    searchStartTime: '',
    searchEndTime: '',
    ...INVERTED_FLAGS,
    searchOnlineClasses: '',
    searchIncludeExcludeDays: 'include',
    searchDays: '',
    // false = the "XLS-multiple" branch: one row per meeting pattern rather than
    // one row per section. Sections that meet at two different times (e.g. class
    // 22671, MWF 12:00 plus Tu 15:30) would otherwise lose a pattern, and a lost
    // pattern is a conflict the solver cannot see.
    oneRowLimit: 'false',
  })
}

/** Full export URL for a scope. */
export function buildExportUrl(scope: SearchScope): string {
  return `${CREATE_XLS_URL}?${buildSearchParams(scope).toString()}`
}
