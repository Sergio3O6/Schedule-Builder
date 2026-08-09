/**
 * The subject catalogue.
 *
 * The committed list below is the *expectation*, not merely a convenience. Two
 * things depend on having a fixed number to check against:
 *
 *   - The whole-term export must be proven uncapped. A silent server-side cap
 *     truncates the tail, so "did every subject come back?" is the only check
 *     that catches it — and that question needs a known answer.
 *   - The per-subject fallback loop needs something to iterate that does not
 *     itself depend on a request succeeding.
 *
 * Because a hardcoded list rots, the crawl also parses the live form and refuses
 * to run on drift. Silently under-crawling a subject KU added is exactly the
 * failure mode that produces a dataset which looks complete and is not.
 *
 * Captured 2026-08-08 from the search form on classes.ku.edu.
 */

/** Sorted, HTML-unescaped. 292 codes. */
export const SUBJECT_CODES: readonly string[] = [
  'AAAS', 'ABSC', 'ACCT', 'ACED', 'ACMP', 'ADS', 'AE', 'AEC',
  'AECL', 'AECR', 'AESP', 'AIR', 'AMS', 'ANAT', 'ANES', 'ANIM',
  'ANSL', 'ANTH', 'ARAB', 'ARCE', 'ARCH', 'ARMY', 'ART', 'ASLD',
  'ASTR', 'ATMO', 'ATTR', 'AUD', 'BAND', 'BASN', 'BBA', 'BCHM',
  'BCMS', 'BCRS', 'BDS', 'BE', 'BINF', 'BIOC', 'BIOE', 'BIOL',
  'BIOS', 'BLAW', 'BRSS', 'BSAN', 'BSCI', 'BTEC', 'BUS', 'C&PE',
  'C&T', 'CARI', 'CBIO', 'CCP', 'CCSL', 'CE', 'CEAS', 'CER',
  'CHAM', 'CHEM', 'CHIN', 'CHOR', 'CHUR', 'CLAR', 'CLDP', 'CLS',
  'CLSX', 'CMGT', 'COMS', 'COND', 'CRIM', 'CT-C', 'CTSU', 'CVS',
  'CZCH', 'DANC', 'DASC', 'DATA', 'DBBS', 'DCLS', 'DHUM', 'DIAG',
  'DIET', 'DN', 'DRWG', 'DXSC', 'EALC', 'ECIV', 'ECON', 'EDUC',
  'EECS', 'ELPS', 'EMGT', 'ENGL', 'ENGR', 'ENTR', 'EPHX', 'EPSY',
  'ERMD', 'EUPH', 'EURS', 'EVRN', 'EXM', 'FAPR', 'FCMD', 'FELW',
  'FIN', 'FLUT', 'FMS', 'FREN', 'FRHN', 'FRSP', 'GENC', 'GEOG',
  'GEOL', 'GERM', 'GIST', 'GRK', 'GSMC', 'GUIT', 'GYNO', 'HA',
  'HAIT', 'HARP', 'HDSC', 'HEBR', 'HEIF', 'HEIM', 'HIST', 'HMGT',
  'HNDI', 'HNRS', 'HP&M', 'HPCD', 'HPMD', 'HSCI', 'HSES', 'HU-C',
  'HUM', 'HUOP', 'IA', 'IBUS', 'ICM', 'IDSP', 'ILLU', 'INDD',
  'INMD', 'IPHI', 'ISP', 'IST', 'ITAL', 'ITEC', 'IXD', 'JAZZ',
  'JMC', 'JPN', 'JWSH', 'KISW', 'KOR', 'KQKL', 'LA&S', 'LAC',
  'LAT', 'LAW', 'LD-C', 'LDST', 'LING', 'LWS', 'MATH', 'MBIO',
  'MCOR', 'MDCM', 'ME', 'MED', 'MEMT', 'METL', 'MGMT', 'MICR',
  'MKTG', 'MTHC', 'MUS', 'MUSC', 'MUSE', 'NAVY', 'NEUR', 'NEUS',
  'NMED', 'NROL', 'NRSG', 'NURA', 'NURO', 'NURS', 'OBGN', 'OBOE',
  'OMGT', 'OPTH', 'ORCH', 'ORGN', 'OTD', 'OTDE', 'OTMS', 'OTOR',
  'P&TX', 'PALO', 'PAON', 'PATH', 'PCS', 'PCUS', 'PDRC', 'PED',
  'PENS', 'PERS', 'PFS', 'PHAR', 'PHCH', 'PHCL', 'PHIL', 'PHOT',
  'PHPR', 'PHRM', 'PHSL', 'PHSX', 'PHTO', 'PIAN', 'PLSH', 'PM-C',
  'PMED', 'PMGT', 'PNTG', 'POLS', 'PORT', 'PRNT', 'PRVM', 'PSCR',
  'PSYC', 'PTOX', 'PTRS', 'PUAD', 'PVMD', 'PYCH', 'QUEC', 'RAD',
  'RADO', 'REC', 'REES', 'REHB', 'REHS', 'REL', 'RESP', 'RLMD',
  'RSDT', 'RUSS', 'SAXO', 'SCM', 'SCUL', 'SGRY', 'SLAV', 'SLPD',
  'SOC', 'SPAA', 'SPAN', 'SPCP', 'SPED', 'SPLH', 'SPPR', 'STAT',
  'STRG', 'SURG', 'SW', 'SWWD', 'TD', 'THR', 'TIB', 'TROM',
  'TRUM', 'TS', 'TUBA', 'TUEU', 'TURK', 'UBPL', 'UKRA', 'UNIV',
  'UTEC', 'UYGR', 'VAE', 'VIOA', 'VION', 'VISC', 'VNCL', 'VOIC',
  'W&P', 'WENS', 'WGSS', 'WOLO',
]

/** The search form page, whose <select> is the live source of truth. */
export const SEARCH_FORM_URL = 'https://classes.ku.edu/Classes/Display.action'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function unescapeHtml(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    }
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    return ENTITIES[body] ?? match
  })
}

/**
 * Subject codes from the live search form, sorted and deduplicated.
 *
 * Scoped to the subject <select> rather than scanning the page for anything
 * that looks like a code: the page carries several other dropdowns, and a loose
 * match would quietly fold school and department codes into the catalogue.
 */
export function parseSubjectCodes(html: string): string[] {
  const select = /id="classesSearchSubject"[\s\S]*?<\/select>/.exec(html)?.[0]
  if (select === undefined) {
    throw new Error('subject <select> not found: the search form markup has changed')
  }

  const codes = new Set<string>()
  for (const match of select.matchAll(/value="([^"]*)"/g)) {
    const code = unescapeHtml(match[1] ?? '').trim()
    if (code !== '') codes.add(code) // the placeholder option carries an empty value
  }

  return [...codes].sort()
}

export interface SubjectDrift {
  /** Present live, missing from the committed list. Crawling would skip these. */
  readonly added: readonly string[]
  /** In the committed list, gone from the form. Crawling these would 404. */
  readonly removed: readonly string[]
}

export function diffSubjects(
  expected: readonly string[],
  actual: readonly string[],
): SubjectDrift {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  return {
    added: actual.filter((c) => !expectedSet.has(c)),
    removed: expected.filter((c) => !actualSet.has(c)),
  }
}

export function hasDrift(drift: SubjectDrift): boolean {
  return drift.added.length > 0 || drift.removed.length > 0
}

/**
 * Human-readable drift report. Deliberately prescriptive: the fix is to update
 * SUBJECT_CODES and re-run, and whoever hits this should not have to work that
 * out from a diff.
 */
export function describeDrift(drift: SubjectDrift): string {
  const parts = [
    `KU's subject catalogue no longer matches the committed list (${SUBJECT_CODES.length} codes).`,
  ]
  if (drift.added.length > 0) parts.push(`Added upstream: ${drift.added.join(', ')}`)
  if (drift.removed.length > 0) parts.push(`Removed upstream: ${drift.removed.join(', ')}`)
  parts.push('Update SUBJECT_CODES in scripts/fetch/subjects.ts, then re-run.')
  return parts.join('\n')
}
