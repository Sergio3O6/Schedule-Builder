/**
 * Finding one course among 4,412.
 *
 * The catalogue is never shown. A student arrives knowing what they want —
 * "EECS 168", or "organic chemistry" — and listing everything else is both
 * useless to them and slow. So this returns nothing until asked, and returns
 * few results when it is.
 *
 * Matching is deliberately forgiving about the one thing people are
 * inconsistent about, which is the space in 'EECS 168', and strict about
 * everything else. Fuzzy matching would be worse than no matching here: a
 * student who types a course number and gets a plausible but different course
 * has no way to notice.
 */

import type { CourseEntry } from '../data/catalog.ts'

/** How many results are worth showing. Beyond this, refine the query. */
export const SEARCH_LIMIT = 25

/**
 * Ranks, best first. Lower is better.
 *
 * The order matters more than it looks: a student typing 'EECS 1' wants EECS
 * 101 before a course whose *title* happens to contain 'eecs 1'. Code matches
 * always outrank title matches, and an exact code outranks a prefix.
 */
const EXACT_CODE = 0
const CODE_PREFIX = 1
const SUBJECT_ONLY = 2
const TITLE_MATCH = 3

/** 'EECS 168' and 'eecs168' are the same query; nothing else is normalised. */
function normalize(text: string): string {
  return text.trim().toUpperCase().replace(/\s+/g, '')
}

function rank(course: CourseEntry, query: string, rawQuery: string): number | null {
  const code = `${course.subject}${course.number}`
  if (code === query) return EXACT_CODE
  if (code.startsWith(query)) return CODE_PREFIX
  // A bare subject lists that subject, which is the one case where showing a
  // lot of courses is what was actually asked for.
  if (course.subject === query) return SUBJECT_ONLY
  if (course.title.toLowerCase().includes(rawQuery)) return TITLE_MATCH
  return null
}

/**
 * Courses matching a query, best first, capped.
 *
 * Empty for an empty query — the catalogue stays hidden until something is
 * typed, which is the whole point.
 */
export function searchCourses(
  courses: readonly CourseEntry[],
  query: string,
  limit: number = SEARCH_LIMIT,
): readonly CourseEntry[] {
  const normalized = normalize(query)
  if (normalized === '') return []

  const rawQuery = query.trim().toLowerCase()
  const ranked: { course: CourseEntry; rank: number }[] = []
  for (const course of courses) {
    const score = rank(course, normalized, rawQuery)
    if (score !== null) ranked.push({ course, rank: score })
  }

  // Stable within a rank, so results keep the catalogue's subject/number order
  // rather than reshuffling as the query grows by one character.
  ranked.sort((a, b) => a.rank - b.rank)
  return ranked.slice(0, limit).map((entry) => entry.course)
}

/** Whether more matched than were shown, so the UI can say so. */
export function countMatches(courses: readonly CourseEntry[], query: string): number {
  return searchCourses(courses, query, Number.MAX_SAFE_INTEGER).length
}
