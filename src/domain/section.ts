/**
 * The enum-like columns, and why they are open rather than closed.
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
