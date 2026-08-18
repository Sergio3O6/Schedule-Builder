/**
 * The attributes of one section, and the parsers that read them.
 *
 * Every shape here is decided by what the data does rather than by what the
 * column name suggests: vocabularies that are open because KU extends them, a
 * credit range because half the catalogue has no single credit value, seat
 * counts recorded rather than reconciled because they contradict each other,
 * and a Section keyed on Class nbr because a section is not a row.
 *
 * ## Open vocabularies
 *
 * `Component`, `Acad career` and `Consent` are PeopleSoft vocabularies. KU
 * configures them, KU extends them, and the export is the only place we learn
 * what is in them. A closed union plus a throwing parser produces a normalizer
 * that dies partway through the alphabet on a code nobody anticipated, which
 * turns every rebuild into whack-a-mole against a source we do not control.
 *
 * So each is a discriminated union with an `other` arm carrying the raw text.
 * An unrecognised code costs one section its nice label; it does not cost the
 * run. The measured alphabets below are the current state of those vocabularies,
 * not a specification of them — the three-subject probe that preceded this
 * listed ten components, and the full term has sixteen.
 *
 * A blank is a different thing and is refused. An unknown code means the
 * vocabulary grew, which is expected. An absent value means a column this model
 * depends on stopped being published, which is a change in the export's shape;
 * degrading it to `{kind:'other', raw:''}` would hand every consumer a value
 * that says nothing while reporting success.
 */

import { anyMeetingConflicts } from './meeting.ts'
import { parseDecimal, parseIntegral } from './number.ts'
import type { ClassNbr, CombSectId, CourseKey, SectionNumber } from './ids.ts'
import type { ScheduledMeeting, UnscheduledMeeting } from './meeting.ts'

/**
 * All 16 component codes in the Fall 2026 export, with live row counts:
 * LEC 5522 · IND 2589 · RSH 2158 · CLN 2045 · THE 1751 · LAB 820 · LBN 763 ·
 * FLD 696 · DIS 335 · ACT 234 · SEM 153 · PRA 143 · INT 111 · WKS 15 · RSC 2 ·
 * STU 1. RSC and STU together are three rows, which is exactly the kind of tail
 * a per-subject probe misses and a closed union would have died on.
 */
export const COMPONENT_CODES = [
  'ACT',
  'CLN',
  'DIS',
  'FLD',
  'IND',
  'INT',
  'LAB',
  'LBN',
  'LEC',
  'PRA',
  'RSC',
  'RSH',
  'SEM',
  'STU',
  'THE',
  'WKS',
] as const

/** The 6 careers present: UGDL 7630 · GRDL 5780 · MED 2538 · GRDK 1004 · UGDK 254 · LAW 132. */
export const CAREER_CODES = ['GRDK', 'GRDL', 'LAW', 'MED', 'UGDK', 'UGDL'] as const

/** The 3 consent values: None 12004 · Instructor 3739 · Department 1595. */
export const CONSENT_CODES = ['Department', 'Instructor', 'None'] as const

export type KnownComponent = (typeof COMPONENT_CODES)[number]
export type KnownCareer = (typeof CAREER_CODES)[number]
export type KnownConsent = (typeof CONSENT_CODES)[number]

/**
 * An open vocabulary value.
 *
 * Generic so the three columns share one shape and one narrowing idiom, rather
 * than three near-identical unions a reader has to compare to be sure they
 * behave alike.
 */
export type Vocabulary<K extends string> =
  | { readonly kind: 'known'; readonly code: K }
  | { readonly kind: 'other'; readonly raw: string }

export type Component = Vocabulary<KnownComponent>
export type Career = Vocabulary<KnownCareer>
export type Consent = Vocabulary<KnownConsent>

/**
 * Matches case-insensitively and answers with the canonical spelling.
 *
 * The export is consistent today — components and careers upper, consent title
 * case — so this costs nothing now. It buys the case where KU's generator
 * changes its mind about capitalisation, which would otherwise silently move
 * every row in the file into the `other` arm while every value in it stayed
 * perfectly recognisable to a human.
 */
function parseVocabulary<K extends string>(
  codes: readonly K[],
  raw: string,
  column: string,
): Vocabulary<K> {
  const value = raw.trim()
  if (value === '') throw new Error(`${column} is blank`)

  const folded = value.toUpperCase()
  const known = codes.find((code) => code.toUpperCase() === folded)
  return known === undefined ? { kind: 'other', raw: value } : { kind: 'known', code: known }
}

export function parseComponent(raw: string): Component {
  return parseVocabulary(COMPONENT_CODES, raw, 'component')
}

export function parseCareer(raw: string): Career {
  return parseVocabulary(CAREER_CODES, raw, 'academic career')
}

export function parseConsent(raw: string): Consent {
  return parseVocabulary(CONSENT_CODES, raw, 'consent')
}

/** What to show a student, for either arm. Unknown codes still have a name. */
export function vocabularyLabel<K extends string>(value: Vocabulary<K>): string {
  return value.kind === 'known' ? value.code : value.raw
}

/**
 * Enrollable is closed, unlike the three above, and deliberately.
 *
 * It is a flag, not a vocabulary — there is no third answer for KU to add, and
 * `other` would be unusable anyway, since every consumer of this field has to
 * decide yes or no. Guessing either default is worse than stopping: defaulting
 * to true offers students sections they cannot register for, and defaulting to
 * false hides 16,906 sections that they can.
 *
 * 432 rows say No, concentrated in LEC (225) and LBN (151) — the parent
 * lectures whose children are the actual enrolment point. That is the shape
 * linkage derivation will need, so a wrong value here is not cosmetic.
 */
export function parseEnrollable(raw: string): boolean {
  const value = raw.trim().toUpperCase()
  if (value === 'YES') return true
  if (value === 'NO') return false
  throw new Error(`enrollable is neither Yes nor No: ${JSON.stringify(raw)}`)
}

/**
 * Credit hours, as a range.
 *
 * Not a single number: 8,378 of the 17,338 rows publish a Min below their Max,
 * which is nearly half the file. A student registering for one of those picks a
 * value at enrolment, so a model that collapsed the range would be stating a
 * credit total the student has not chosen yet — and would do it for half the
 * catalogue.
 *
 * The bounds are wider than they look. Min runs 0 to 14 and Max 0 to 16; 89
 * rows have a Max of 0, which is a real zero-credit section rather than a
 * missing value; and 22 rows are fractional (0.25, 0.5, 1.5), which is why this
 * parses as a decimal and not as a count.
 */
export interface Credits {
  readonly min: number
  readonly max: number
}

export function parseCredits(min: string, max: string): Credits {
  const low = parseDecimal(min, 'minimum credit hours')
  const high = parseDecimal(max, 'maximum credit hours')

  // Negative credit is not a thing, and reading the wrong column is.
  if (low < 0) throw new Error(`minimum credit hours is negative: ${JSON.stringify(min)}`)
  if (high < 0) throw new Error(`maximum credit hours is negative: ${JSON.stringify(max)}`)
  // Holds in all 17,338 rows today. If it ever stops holding, the range is
  // empty and every consumer that renders or sums it is showing nonsense.
  if (low > high) {
    throw new Error(
      `minimum credit hours exceeds maximum: ${JSON.stringify(min)} > ${JSON.stringify(max)}`,
    )
  }

  return { min: low, max: high }
}

/** True for the 8,378 rows where the student chooses the credit at enrolment. */
export function isVariableCredit(credits: Credits): boolean {
  return credits.max > credits.min
}

/**
 * Seat counts, recorded rather than reconciled.
 *
 * These four numbers do not agree with each other and are not expected to.
 * `cap - enrolled === seatsAvailable` fails in 1,048 rows; 375 rows enrol more
 * students than their cap allows; and 431 report a negative `seatsAvailable`,
 * down to -104. Reserved-capacity rules, permission overrides and a feed that
 * snapshots each column at its own moment all produce this legitimately.
 *
 * So there is no derived `isFull` here and no arithmetic check in the parser.
 * Each field is a separate thing KU published, and any conclusion drawn by
 * combining them would be a guess presented as a fact. Bounds are enforced only
 * where a value cannot mean anything otherwise.
 */
export interface Enrollment {
  readonly cap: number
  readonly enrolled: number
  /** Signed on purpose: 431 rows are negative. */
  readonly seatsAvailable: number
  readonly waitCap: number
  readonly waitTotal: number
}

/**
 * Named fields, not positional arguments.
 *
 * Five small non-negative integers in a row is the exact shape where a
 * transposed pair reads as perfectly normal data and no test notices. The
 * caller has to say which column is which.
 */
export interface RawEnrollment {
  readonly cap: string
  readonly enrolled: string
  readonly seatsAvailable: string
  readonly waitCap: string
  readonly waitTotal: string
}

export function parseEnrollment(raw: RawEnrollment): Enrollment {
  const count = (value: string, what: string): number => {
    const parsed = parseIntegral(value, what)
    if (parsed < 0) throw new Error(`${what} is negative: ${JSON.stringify(value)}`)
    return parsed
  }

  return {
    cap: count(raw.cap, 'enrollment cap'),
    enrolled: count(raw.enrolled, 'total enrolled'),
    // The one field that is allowed below zero, because the feed really does
    // publish it that way when a section is over-enrolled.
    seatsAvailable: parseIntegral(raw.seatsAvailable, 'seats available'),
    waitCap: count(raw.waitCap, 'waitlist cap'),
    waitTotal: count(raw.waitTotal, 'waitlist total'),
  }
}

/**
 * Free text as the export publishes it, cleaned only where it is broken.
 *
 * Two repairs, each earned by something in the file. A zero-width space
 * (U+200B) sits inside GEOL 591's topic, between 'Quantitat' and 'ive' — the
 * only non-ASCII character in all 17,338 rows. It is invisible, and it defeats
 * any search for 'Quantitative'. And 59 titles carry a run of internal spaces,
 * which is a formatting artefact of a field the feed truncates to 30 characters.
 *
 * Nothing else is touched. Case, punctuation and abbreviation are KU's to
 * choose, and a normalizer that improved them would be inventing course names.
 */
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g

function cleanText(raw: string): string {
  return raw.replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim()
}

/** The course title. Never blank in any of the 17,338 rows, so a blank throws. */
export function parseTitle(raw: string): string {
  const value = cleanText(raw)
  if (value === '') throw new Error('course title is blank')
  return value
}

/** The topic of a topics course, or null. 764 rows carry one, 449 distinct. */
export function parseTopic(raw: string): string | null {
  const value = cleanText(raw)
  return value === '' ? null : value
}

/**
 * One section: everything KU publishes about a single thing on the timetable.
 *
 * A section is one `Class nbr`, which is not one row. 588 class numbers span
 * two to ten rows each, 1,912 rows in total — most of them a second meeting
 * pattern (a lecture that meets MWF and also Th), some of them exact
 * duplicates. Every one of the eleven identity columns agrees across the rows
 * of a class number, with zero exceptions across the export, so assembling a
 * section means taking those fields from any row and unioning the meetings.
 *
 * A naive dedupe by row would destroy the 459 genuine extra patterns; keying on
 * `Class nbr` keeps them, and it is what a student is enrolling in anyway.
 *
 * The two meeting arrays are separate rather than one `Meeting[]` so that
 * conflict code can take `readonly ScheduledMeeting[]` and be structurally
 * unable to receive a TBA section. An empty `scheduled` is the honest, correct
 * representation of a section that conflicts with nothing.
 */
export interface Section {
  readonly classNbr: ClassNbr
  readonly courseKey: CourseKey
  /** The Sec. nbr label, or null for the 25 rows that publish none. */
  readonly number: SectionNumber | null
  readonly title: string
  readonly topic: string | null
  readonly component: Component
  readonly career: Career
  readonly consent: Consent
  readonly credits: Credits
  /** False for 432 rows — mostly parent lectures enrolled through a child. */
  readonly enrollable: boolean
  /** The cross-listing group, or null when the section is not combined. */
  readonly combSectId: CombSectId | null
  readonly enrollment: Enrollment
  /**
   * Always empty, and kept anyway.
   *
   * The Instructor column is blank in 100% of rows here and in Fall 2025, a
   * term that has already finished — so this is CAS gating, not staff who have
   * yet to be assigned. The anonymous feed will never populate it; the HTML
   * view renders a login link in its place.
   *
   * `[]` is a truthful value rather than a placeholder, so no consumer can
   * mistake missing data for real data. Keeping the field makes an
   * authenticated ingest a populate-only change instead of a schema migration
   * through the wire format, the loader and every fixture.
   */
  readonly instructors: readonly string[]
  readonly scheduled: readonly ScheduledMeeting[]
  readonly unscheduled: readonly UnscheduledMeeting[]
}

/**
 * Do two sections collide?
 *
 * Reaches only for the scheduled arrays, so a section with nothing scheduled is
 * naturally free of conflicts and needs no special case. This is the altitude
 * callers actually work at — asking them to reach into `.scheduled` themselves
 * is asking them to remember which array is the safe one.
 */
export function sectionsConflict(a: Section, b: Section): boolean {
  return anyMeetingConflicts(a.scheduled, b.scheduled)
}
