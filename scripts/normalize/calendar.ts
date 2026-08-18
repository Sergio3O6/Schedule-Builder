/**
 * Where the term's epoch comes from.
 *
 * Every DayOffset in the app is measured from one pinned date, and that date
 * has to be a fact about the term rather than a constant someone typed. So it
 * is read out of the export: the Begin/End pair that the most sections share is
 * the term's own span.
 *
 * Taken as a PAIR, not as two independent modes. The most common Begin and the
 * most common End could in principle belong to different parts of term, and the
 * pair they form would then be a span no section actually has — an epoch
 * describing a term that does not exist. They agree in Fall 2026, which is
 * exactly when the choice is free to make on principle.
 */

import { monthDayToIso, termCalendar, termYear } from '../../src/domain/time.ts'
import type { TermCalendar } from '../../src/domain/time.ts'
import type { TermCode } from '../../src/domain/ids.ts'

/** One row's dates, as the export writes them: 'AUG-24', 'DEC-18', or blank. */
export interface RawDateSpan {
  readonly begin: string
  readonly end: string
}

export interface ModalSpan extends RawDateSpan {
  /** How many rows carry this exact pair. */
  readonly rows: number
  /** How many rows were eligible to vote. */
  readonly voted: number
}

/**
 * The Begin/End pair the most rows share.
 *
 * Rows missing either date do not vote. 25 rows publish neither, and a row with
 * only one of the two is malformed — neither can tell us where the term starts,
 * and letting them vote would mean counting a partial answer as an answer.
 *
 * A tie throws. Two spans with equal claim to being "the term" means the file
 * is not one term's worth of sections, and picking whichever the iteration
 * order reached first would silently pin the epoch on a coin flip.
 *
 * There is no minimum share, deliberately. Any floor would be a knob with no
 * principled value; the share is reported instead, so a human reads it and a
 * caller can act on it.
 */
export function modalDateSpan(spans: Iterable<RawDateSpan>): ModalSpan {
  const votes = new Map<string, { readonly span: RawDateSpan; count: number }>()
  let voted = 0

  for (const raw of spans) {
    const begin = raw.begin.trim()
    const end = raw.end.trim()
    if (begin === '' || end === '') continue

    voted += 1
    const key = `${begin}..${end}`
    const seen = votes.get(key)
    if (seen === undefined) votes.set(key, { span: { begin, end }, count: 1 })
    else seen.count += 1
  }

  if (voted === 0) throw new Error('no row carries both a begin and an end date')

  let best: { readonly span: RawDateSpan; count: number } | null = null
  let tied = false
  for (const entry of votes.values()) {
    if (best === null || entry.count > best.count) {
      best = entry
      tied = false
    } else if (entry.count === best.count) {
      tied = true
    }
  }
  if (best === null) throw new Error('no row carries both a begin and an end date')
  if (tied) {
    throw new Error(
      `no single term span: ${votes.size} distinct spans, ${best.count} rows each at the top`,
    )
  }

  return { ...best.span, rows: best.count, voted }
}

/**
 * The term calendar, derived from the export rather than configured.
 *
 * The begin takes the term's own year. The end takes the next one when it falls
 * earlier in the calendar than the begin — a term that starts in August and
 * ends in May is a full-year span, not an inverted one.
 */
export function deriveTermCalendar(term: TermCode, spans: Iterable<RawDateSpan>): TermCalendar {
  const modal = modalDateSpan(spans)
  const year = termYear(term)

  const startDate = monthDayToIso(modal.begin, year)
  const sameYearEnd = monthDayToIso(modal.end, year)
  const endDate = sameYearEnd < startDate ? monthDayToIso(modal.end, year + 1) : sameYearEnd

  return termCalendar(term, startDate, endDate)
}

/** One line a human can check against KU's academic calendar. */
export function describeCalendar(term: TermCode, modal: ModalSpan): string {
  const share = ((modal.rows / modal.voted) * 100).toFixed(1)
  return `Term ${term}: ${modal.begin}..${modal.end} on ${modal.rows} of ${modal.voted} dated rows (${share}%)`
}
