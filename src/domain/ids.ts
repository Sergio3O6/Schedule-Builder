/**
 * Branded identifiers.
 *
 * The export hands us several numbers that look alike and mean entirely
 * different things: `Class nbr` 17938 identifies a section, `Comb Sect ID` 4950
 * identifies a cross-listing group, `Sec. nbr` 6010 is a label within a course.
 * All three arrive as strings of digits. Branding turns a mix-up from a silent
 * join on the wrong column into a compile error.
 *
 * The smart constructors below are the only way to mint a branded value, so
 * every one has been validated at the boundary where raw data enters.
 */

declare const brand: unique symbol
type Brand<T, B extends string> = T & { readonly [brand]: B }

/** PeopleSoft term code, e.g. "4269" = Fall 2026. */
export type TermCode = Brand<string, 'TermCode'>
/** Subject code as KU publishes it, e.g. "EECS", "C&PE". */
export type SubjectCode = Brand<string, 'SubjectCode'>
/** Catalog identity, "SUBJECT|NUMBER" e.g. "EECS|138". */
export type CourseKey = Brand<string, 'CourseKey'>
/** Unique section id within a term. */
export type ClassNbr = Brand<number, 'ClassNbr'>
/** Cross-listing group id. Never zero — absence is null. */
export type CombSectId = Brand<number, 'CombSectId'>
/** A registerable unit, the solver's alphabet. */
export type UnitId = Brand<string, 'UnitId'>

/**
 * Numbers arrive float-formatted: '3.0', '4950.0', '0.0'. Parsing with
 * parseInt would read '4950.0' as 4950 by luck and '0.5' as 0 by accident, so
 * the whole value is parsed and then required to be integral.
 */
function parseIntegral(raw: string, what: string): number {
  const value = Number(raw.trim())
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${what} is not an integer: ${JSON.stringify(raw)}`)
  }
  return value
}

const TERM_PATTERN = /^\d{4}$/
/** Verified across all 292 codes: uppercase letters plus & and -. */
const SUBJECT_PATTERN = /^[A-Z&-]{1,8}$/

export function termCode(raw: string): TermCode {
  const value = raw.trim()
  if (!TERM_PATTERN.test(value)) throw new Error(`malformed term code: ${JSON.stringify(raw)}`)
  return value as TermCode
}

export function subjectCode(raw: string): SubjectCode {
  const value = raw.trim()
  if (!SUBJECT_PATTERN.test(value)) {
    throw new Error(`malformed subject code: ${JSON.stringify(raw)}`)
  }
  return value as SubjectCode
}

/**
 * Builds a course key from the export's Course and Number columns.
 *
 * Number carries a leading space in every row (' 101', ' 138'), so trimming is
 * mandatory rather than defensive: without it every key is distinct from the
 * one a human would write, and cross-listing lookups silently miss.
 */
export function courseKey(subject: string, number: string): CourseKey {
  const trimmedNumber = number.trim()
  if (trimmedNumber === '') throw new Error('course number is empty')
  return `${subjectCode(subject)}|${trimmedNumber}` as CourseKey
}

/** Splits a course key back into its parts, for display and diagnostics. */
export function splitCourseKey(key: CourseKey): { subject: SubjectCode; number: string } {
  const separator = key.indexOf('|')
  return {
    subject: key.slice(0, separator) as SubjectCode,
    number: key.slice(separator + 1),
  }
}

export function classNbr(raw: string): ClassNbr {
  const value = parseIntegral(raw, 'class number')
  if (value <= 0) throw new Error(`class number must be positive: ${JSON.stringify(raw)}`)
  return value as ClassNbr
}

/**
 * A cross-listing id, or null when the section is not cross-listed.
 *
 * The export writes "not combined" as '0.0'. Returning 0 would make an absent
 * grouping look like a real group that every uncombined section belongs to —
 * which would collapse thousands of unrelated sections into one unit.
 */
export function combSectId(raw: string): CombSectId | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = parseIntegral(trimmed, 'combined section id')
  return value === 0 ? null : (value as CombSectId)
}

/**
 * Identity for a registerable unit.
 *
 * Keyed on the section a student actually enrolls in, so two courses that share
 * one physical class (cross-listed EECS 781 and MATH 781) produce the same id
 * and collapse into a single unit.
 */
export function unitId(term: TermCode, enrollClassNbr: ClassNbr): UnitId {
  return `${term}:${enrollClassNbr}` as UnitId
}
