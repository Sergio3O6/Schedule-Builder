/**
 * Branded identifiers.
 *
 * The export hands us several numbers that look alike and mean entirely
 * different things: `Class nbr` 17938 identifies a section, `Comb Sect ID` 4950
 * identifies a cross-listing group, `Sec. nbr` 6010 is a label within a course.
 * All three arrive as strings of digits. Branding turns a mix-up from a silent
 * join on the wrong column into a compile error.
 *
 * The smart constructors below are the only VALIDATING way to mint a branded
 * value. They are not the only way: `'anything' as TermCode` compiles wherever
 * it is written, because a brand is a compile-time fiction with no runtime
 * existence. What branding buys is that the mistake has to be deliberate and is
 * visible in review, not that it is impossible.
 *
 * So functions here re-validate what they are handed rather than trusting the
 * type — splitCourseKey runs its subject half back through subjectCode, because
 * the only way to reach it with a malformed key is a cast, and a cast is exactly
 * what the type system cannot stop.
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
/** The `Sec. nbr` label within a course, e.g. "1000". A string, never a number. */
export type SectionNumber = Brand<string, 'SectionNumber'>
/** A registerable unit, the solver's alphabet. */
export type UnitId = Brand<string, 'UnitId'>

/**
 * Plain decimal, which is the only shape this data ever takes.
 *
 * Number() accepts a great deal more than that, and silently: '0x4B6A' becomes
 * 19306, '1e4' becomes 10000, '' becomes 0, and 'Infinity' parses. None can be
 * a real class number, and each would arrive as a plausible-looking integer.
 */
const DECIMAL_PATTERN = /^[+-]?\d+(?:\.\d+)?$/

/**
 * Numbers arrive float-formatted: '3.0', '4950.0', '0.0'. Parsing with
 * parseInt would read '4950.0' as 4950 by luck and '0.5' as 0 by accident, so
 * the whole value is parsed and then required to be integral.
 */
function parseIntegral(raw: string, what: string): number {
  const text = raw.trim()
  if (!DECIMAL_PATTERN.test(text)) {
    throw new Error(`${what} is not a decimal number: ${JSON.stringify(raw)}`)
  }

  const value = Number(text)
  if (!Number.isInteger(value)) {
    throw new Error(`${what} is not an integer: ${JSON.stringify(raw)}`)
  }
  // Past 2^53 the parse is lossy, so the value read back is not the value sent.
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${what} is too large to represent exactly: ${JSON.stringify(raw)}`)
  }
  return value
}

const TERM_PATTERN = /^\d{4}$/
/** Verified across all 292 codes: uppercase letters plus & and -. */
const SUBJECT_PATTERN = /^[A-Z&-]{1,8}$/
/**
 * Course numbers are not all numeric.
 *
 * Measured across all 17,338 rows: 799 distinct values, longest 4 characters,
 * drawn from digits plus W, X and Y — `1W`, `5W`, `7W` are workshop sections and
 * `XXXX`, `YYYY` belong to FRSP. Generous enough to cover any letter, tight
 * enough that a course key can never carry a separator or a path.
 */
const COURSE_NUMBER_PATTERN = /^[0-9A-Z]{1,8}$/

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
  // Both halves are validated, not just the subject. An unchecked number half
  // makes 'EECS|../../etc/passwd' a perfectly constructible CourseKey, and a
  // number containing '|' would split back into the wrong two pieces.
  if (!COURSE_NUMBER_PATTERN.test(trimmedNumber)) {
    throw new Error(`malformed course number: ${JSON.stringify(number)}`)
  }
  return `${subjectCode(subject)}|${trimmedNumber}` as CourseKey
}

/** Splits a course key back into its parts, for display and diagnostics. */
export function splitCourseKey(key: CourseKey): { subject: SubjectCode; number: string } {
  const separator = key.indexOf('|')
  // Without this, a key with no separator returns nonsense rather than failing:
  // indexOf gives −1, slice(0, −1) drops the last character, and
  // splitCourseKey('EECS138') answers { subject: 'EECS13', number: 'EECS138' }.
  // Only a cast can produce such a key, and a cast is exactly what the type
  // system cannot stop.
  if (separator < 0) throw new Error(`not a course key: ${JSON.stringify(key)}`)

  return {
    subject: subjectCode(key.slice(0, separator)),
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
  if (value === 0) return null
  // Held to the same standard as classNbr, which rejects negatives. These two
  // columns exist side by side and the module's whole job is keeping them
  // straight; one of them quietly accepting −5 undoes that.
  if (value < 0) {
    throw new Error(`combined section id must be positive: ${JSON.stringify(raw)}`)
  }
  return value as CombSectId
}

/**
 * Section numbers are strings, and the leading zeros are the reason.
 *
 * Measured across all 17,338 rows: 777 distinct values, all digits, lengths 1,
 * 3 and 4, and 16 of them begin with a zero — ENGL 101 alone runs '0025',
 * '0050', '0075' through '0950', and HEIM 567 has '0002'. Number('0025') is 25,
 * which collides with nothing today but is not the label KU printed and is not
 * what a student sees on their enrolment page.
 *
 * Letters are allowed although none occur. PeopleSoft permits them, and this
 * value is a label rather than an identity — nothing joins on it — so a
 * normalizer that threw on the first 'A01' would turn one unfamiliar section
 * into a dead subject for no benefit. The pattern still refuses whitespace and
 * separators, which is what a label must never carry.
 */
const SECTION_NUMBER_PATTERN = /^[0-9A-Z]{1,6}$/

/** The section label, or null for the 25 rows that publish none. */
export function sectionNumber(raw: string): SectionNumber | null {
  const value = raw.trim()
  if (value === '') return null
  if (!SECTION_NUMBER_PATTERN.test(value)) {
    throw new Error(`malformed section number: ${JSON.stringify(raw)}`)
  }
  return value as SectionNumber
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
