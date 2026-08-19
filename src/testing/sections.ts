/**
 * Sections built by hand, for tests that need a specific shape.
 *
 * The other way to get a Section in a test is to run the real pipeline over
 * tests/fixtures/eecs-4269.xlsx, and where that works it is better — it proves
 * the generator and the consumer agree. It cannot serve tests about geometry:
 * "three classes overlapping in a chain" is not a thing the live export happens
 * to contain, and pinning a test to a row that does contain it today makes the
 * test fail when KU reschedules something.
 *
 * So these are deliberately synthetic, and everything that CAN be built through
 * a real constructor is — parseCredits, parseDayMask, dateSpan and the rest. A
 * fixture that bypassed them could hold a value the parsers would reject, and
 * then a test would pass on data the app can never actually see.
 *
 * Lives outside src/domain so it does not count toward that layer's coverage
 * bar: a helper exercised by every test would inflate the number without
 * testing anything.
 */

import { classNbr, courseKey, sectionNumber, termCode } from '../domain/ids.ts'
import {
  parseCareer,
  parseComponent,
  parseConsent,
  parseCredits,
  parseEnrollment,
} from '../domain/section.ts'
import { dateSpan, parseClockTime, parseDayMask, termCalendar } from '../domain/time.ts'
import type { ScheduledMeeting, UnscheduledMeeting } from '../domain/meeting.ts'
import type { Section } from '../domain/section.ts'
import type { MinuteOfDay } from '../domain/time.ts'

/** Fall 2026, the term every fixture here belongs to. */
export const FALL_2026 = termCalendar(termCode('4269'), '2026-08-24', '2026-12-18')

/** The full term, which is what all but the partial-term fixtures run for. */
export const WHOLE_TERM = dateSpan(FALL_2026, 'AUG-24', 'DEC-18')

const PLACE = { campus: 'LAWRENCE', room: null }

/** '09:00 AM' as minutes, throwing rather than returning null in a fixture. */
export function at(clock: string): MinuteOfDay {
  const minute = parseClockTime(clock)
  if (minute === null) throw new Error(`not a clock time: ${JSON.stringify(clock)}`)
  return minute
}

/** meets('MWF', '09:00 AM', '09:50 AM') */
export function meets(days: string, start: string, end: string): ScheduledMeeting {
  return {
    kind: 'scheduled',
    days: parseDayMask(days),
    start: at(start),
    end: at(end),
    span: WHOLE_TERM,
    place: PLACE,
  }
}

export function arranged(): UnscheduledMeeting {
  return { kind: 'unscheduled', reason: 'appointment', span: WHOLE_TERM, place: PLACE }
}

export interface SectionSpec {
  /** 'EECS 168'. Split on the space into subject and catalogue number. */
  readonly course: string
  /** Distinct within a test: it is the section's identity everywhere. */
  readonly classNbr: number
  readonly number?: string
  readonly scheduled?: readonly ScheduledMeeting[]
  readonly unscheduled?: readonly UnscheduledMeeting[]
  readonly credits?: readonly [min: string, max: string]
}

export function makeSection(spec: SectionSpec): Section {
  const [subject = 'EECS', number = '100'] = spec.course.split(' ')
  const [min = '3.0', max = '3.0'] = spec.credits ?? []
  return {
    classNbr: classNbr(String(spec.classNbr)),
    courseKey: courseKey(subject, number),
    number: sectionNumber(spec.number ?? '00001'),
    title: spec.course,
    topic: null,
    component: parseComponent('LEC'),
    career: parseCareer('UGDL'),
    consent: parseConsent('None'),
    credits: parseCredits(min, max),
    enrollable: true,
    combSectId: null,
    enrollment: parseEnrollment({
      cap: '30',
      enrolled: '10',
      seatsAvailable: '20',
      waitCap: '0',
      waitTotal: '0',
    }),
    instructors: [],
    scheduled: spec.scheduled ?? [],
    unscheduled: spec.unscheduled ?? [],
  }
}
