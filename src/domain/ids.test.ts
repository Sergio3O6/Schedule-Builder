import { describe, expect, it } from 'vitest'
import {
  classNbr,
  combSectId,
  courseKey,
  sectionNumber,
  splitCourseKey,
  subjectCode,
  termCode,
  unitId,
} from './ids.ts'
import type { CourseKey } from './ids.ts'

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

  it('accepts the non-numeric course numbers the export really contains', () => {
    // Measured across 17,338 rows: 799 distinct values, longest 4 characters,
    // digits plus W, X and Y. 1W/5W/7W are workshops, XXXX/YYYY belong to FRSP.
    for (const number of [' 1W', ' 5W', ' XXXX', ' YYYY', ' 002', ' 6']) {
      expect(() => courseKey('EECS', number), number).not.toThrow()
    }
  })

  it('validates the number half, not only the subject', () => {
    // 'EECS|../../etc/passwd' used to be a perfectly constructible CourseKey,
    // and a number containing '|' splits back into the wrong two pieces.
    for (const bad of ['../../etc/passwd', 'A|B', '138 ext', 'eecs', 'TOOLONGNUMBER']) {
      expect(() => courseKey('EECS', bad), bad).toThrow(/malformed course number/)
    }
  })
})

describe('splitCourseKey', () => {
  it('refuses a key with no separator instead of answering nonsense', () => {
    // indexOf gives −1 and slice(0, −1) drops the last character, so this
    // answered { subject: 'EECS13', number: 'EECS138' } — a subject that does
    // not exist, reported with total confidence. Only a cast can get here, and
    // a cast is exactly what the type system cannot stop.
    expect(() => splitCourseKey('EECS138' as CourseKey)).toThrow(/not a course key/)
  })

  it('refuses a key whose subject half is not a subject', () => {
    expect(() => splitCourseKey('eecs|138' as CourseKey)).toThrow(/malformed subject code/)
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

  it('rejects notations Number() would quietly accept', () => {
    // Each of these came back as a plausible integer: '0x4B6A' as 19306, '1e4'
    // as 10000, '' as 0, and Infinity as a finite-looking failure downstream.
    for (const bad of ['0x4B6A', '1e4', 'Infinity', '  ', '1_000', '+ 5']) {
      expect(() => classNbr(bad), bad).toThrow(/not a decimal number/)
    }
  })

  it('rejects a value too large to survive the round trip', () => {
    // Past 2^53 the number read back is not the number sent.
    expect(() => classNbr('99999999999999999999')).toThrow(/too large/)
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

  it('rejects a negative id, as classNbr does', () => {
    // These two columns sit side by side and this module exists to keep them
    // straight; one of them quietly accepting −5 undoes that.
    expect(() => combSectId('-5')).toThrow(/must be positive/)
    expect(() => combSectId('-5.0')).toThrow(/must be positive/)
  })
})

describe('unitId', () => {
  it('is stable for the same term and sections', () => {
    const term = termCode('4269')
    expect(unitId(term, [classNbr('17939')])).toBe(unitId(term, [classNbr('17939')]))
  })

  it('separates the same class number across terms', () => {
    expect(unitId(termCode('4269'), [classNbr('17939')])).not.toBe(
      unitId(termCode('4259'), [classNbr('17939')]),
    )
  })

  it('depends on the set of sections, not the order they arrive in', () => {
    // A unit is assembled component-group by component-group, and two call
    // paths can reach the same combination in different orders. If the id
    // disagreed, React would re-mount a row that had not changed.
    const term = termCode('4269')
    const lecture = classNbr('14508')
    const lab = classNbr('17939')
    expect(unitId(term, [lecture, lab])).toBe(unitId(term, [lab, lecture]))
  })

  it('separates a lecture-plus-lab unit from the lab alone', () => {
    const term = termCode('4269')
    expect(unitId(term, [classNbr('14508'), classNbr('17939')])).not.toBe(
      unitId(term, [classNbr('17939')]),
    )
  })

  it('refuses a unit with no sections', () => {
    expect(() => unitId(termCode('4269'), [])).toThrow(/at least one section/)
  })
})

describe('sectionNumber', () => {
  it('keeps the leading zeros the export really publishes', () => {
    // Sixteen live rows start with a zero — ENGL 101 runs '0025' through '0950'
    // and HEIM 567 is '0002'. Number('0025') is 25, which is not the label KU
    // printed and not what the student sees on their enrolment page.
    expect(sectionNumber('0025')).toBe('0025')
    expect(sectionNumber('0002')).toBe('0002')
    expect(sectionNumber('0950')).toBe('0950')
  })

  it('accepts every length the export uses', () => {
    // Measured: lengths 1, 3 and 4. AEC 30 numbers its sections '1'.
    for (const s of ['1', '100', '1000']) expect(sectionNumber(s)).toBe(s)
  })

  it('treats a blank label as absent rather than as an empty string', () => {
    // 25 rows publish no Sec. nbr. An empty string would be a section whose
    // label is the empty label, which is a different claim from having none.
    expect(sectionNumber('')).toBeNull()
    expect(sectionNumber('   ')).toBeNull()
  })

  it('trims the padding the export puts on its cells', () => {
    expect(sectionNumber(' 1000 ')).toBe('1000')
  })

  it('rejects anything a label must never carry', () => {
    for (const bad of ['10 00', '1|0', '../x', '10.0', '-5', 'a01', '1234567']) {
      expect(() => sectionNumber(bad), bad).toThrow(/malformed section number/)
    }
  })
})
