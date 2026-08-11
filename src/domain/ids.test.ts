import { describe, expect, it } from 'vitest'
import {
  classNbr,
  combSectId,
  courseKey,
  splitCourseKey,
  subjectCode,
  termCode,
  unitId,
} from './ids.ts'

describe('termCode', () => {
  it('accepts the live term codes', () => {
    for (const t of ['4269', '4266', '4262', '4259']) expect(termCode(t)).toBe(t)
  })

  it('rejects anything that is not four digits', () => {
    for (const bad of ['426', '42690', 'FALL', '', '426a']) {
      expect(() => termCode(bad), bad).toThrow(/malformed term code/)
    }
  })
})

describe('subjectCode', () => {
  it('accepts the real alphabet, ampersands and hyphens included', () => {
    for (const s of ['EECS', 'C&PE', 'HP&M', 'LA&S', 'CT-C', 'PM-C', 'AE']) {
      expect(subjectCode(s)).toBe(s)
    }
  })

  it('rejects lowercase and separators that could escape a path', () => {
    for (const bad of ['eecs', '../x', 'A/B', '', 'TOOLONGCODE']) {
      expect(() => subjectCode(bad), bad).toThrow(/malformed subject code/)
    }
  })
})

describe('courseKey', () => {
  it('strips the leading space the export puts on every Number', () => {
    // Without this the key never matches one a human would write, and
    // cross-listing lookups silently miss.
    expect(courseKey('EECS', ' 138')).toBe('EECS|138')
    expect(courseKey('EECS', ' 101')).toBe('EECS|101')
  })

  it('round-trips through splitCourseKey', () => {
    const key = courseKey('C&PE', ' 511')
    expect(splitCourseKey(key)).toEqual({ subject: 'C&PE', number: '511' })
  })

  it('keeps course numbers as strings, preserving any leading zeros', () => {
    expect(courseKey('MATH', ' 002')).toBe('MATH|002')
  })

  it('rejects an empty number', () => {
    expect(() => courseKey('EECS', '   ')).toThrow(/course number is empty/)
  })
})

describe('classNbr', () => {
  it('parses the plain integers the export emits', () => {
    expect(classNbr('17938')).toBe(17938)
    expect(classNbr('22671')).toBe(22671)
  })

  it('parses float-formatted integers', () => {
    expect(classNbr('17938.0')).toBe(17938)
  })

  it('rejects a fractional value rather than truncating it', () => {
    // parseInt would silently read '17938.5' as 17938 and lose the problem.
    expect(() => classNbr('17938.5')).toThrow(/not an integer/)
  })

  it('rejects non-numbers and non-positive values', () => {
    for (const bad of ['', 'APPT', '0', '-5']) {
      expect(() => classNbr(bad), bad).toThrow()
    }
  })
})

describe('combSectId', () => {
  it('reads a real cross-listing group', () => {
    // 4950 ties EECS 140 s1000 to EECS 141 s1000.
    expect(combSectId('4950.0')).toBe(4950)
  })

  it("maps the export's '0.0' to null, never to zero", () => {
    // Returning 0 would make "not combined" look like one enormous group that
    // every uncombined section belongs to.
    expect(combSectId('0.0')).toBeNull()
    expect(combSectId('0')).toBeNull()
  })

  it('treats blank as absent', () => {
    expect(combSectId('')).toBeNull()
    expect(combSectId('   ')).toBeNull()
  })
})

describe('unitId', () => {
  it('is stable for the same term and enrolment section', () => {
    const term = termCode('4269')
    expect(unitId(term, classNbr('17939'))).toBe(unitId(term, classNbr('17939')))
  })

  it('separates the same class number across terms', () => {
    expect(unitId(termCode('4269'), classNbr('17939'))).not.toBe(
      unitId(termCode('4259'), classNbr('17939')),
    )
  })
})
