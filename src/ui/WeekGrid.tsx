/**
 * The week grid itself.
 *
 * All the arithmetic lives in calendar.ts; this file only turns the numbers
 * into boxes. The one judgement it makes is visual: a block is positioned as a
 * PERCENTAGE of the grid's span rather than in fixed pixels per minute, so the
 * whole thing scales with one height and a 25-minute recitation stays legible
 * next to a three-hour lab.
 *
 * Colour is assigned by course, not by section, and comes from the order the
 * courses were picked in. Two sections of the same course therefore look the
 * same, which is what a student comparing them needs.
 */

import { hourMarks, weekLayout } from './calendar.ts'
import { formatMinuteOfDay, formatTimeRange } from './format.ts'
import type { CalendarSource } from './calendar.ts'

/** Vertical scale. The grid is this tall per hour it spans. */
const HOUR_HEIGHT_REM = 3.25

/** Enough hues to keep a realistic load distinguishable; it wraps after this. */
const PALETTE_SIZE = 8

const percent = (value: number): string => `${value * 100}%`

export function WeekGrid({ sources }: { sources: readonly CalendarSource[] }) {
  const layout = weekLayout(sources)
  const span = layout.endMinute - layout.startMinute
  const height = `${(span / 60) * HOUR_HEIGHT_REM}rem`

  // Colour follows the order courses were picked, so adding a fourth course
  // never recolours the first three.
  const hues = new Map<string, number>()
  for (const source of sources) {
    if (!hues.has(source.id)) hues.set(source.id, hues.size % PALETTE_SIZE)
  }

  const marks = hourMarks(layout)

  return (
    <section className="week" aria-label="Weekly schedule">
      <div className="week-grid">
        <div className="week-gutter">
          <div className="week-heading" aria-hidden="true" />
          <div className="week-track" style={{ height }}>
            {marks.map((minute) => (
              <span
                key={minute}
                className="week-mark"
                style={{ top: percent((minute - layout.startMinute) / span) }}
              >
                {formatMinuteOfDay(minute)}
              </span>
            ))}
          </div>
        </div>

        {layout.days.map((day, dayIndex) => (
          <div className="week-day" key={day.token}>
            <div className="week-heading">{day.heading}</div>
            <div className="week-track" style={{ height }}>
              {marks.slice(1, -1).map((minute) => (
                <div
                  key={minute}
                  className="week-rule"
                  style={{ top: percent((minute - layout.startMinute) / span) }}
                />
              ))}

              {layout.blocks
                .filter((block) => block.dayIndex === dayIndex)
                .map((block) => (
                  <div
                    key={block.key}
                    className={`week-block hue-${hues.get(block.id) ?? 0}`}
                    style={{
                      top: percent((block.start - layout.startMinute) / span),
                      height: percent((block.end - block.start) / span),
                      left: percent(block.column / block.columns),
                      width: percent(1 / block.columns),
                    }}
                  >
                    <span className="week-block-label">{block.label}</span>
                    <span className="week-block-time">
                      {formatTimeRange(block.start, block.end)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      {layout.unplaced.length > 0 && (
        <div className="week-unplaced">
          {/* Not decoration. These sections have no published meeting time, and
              a grid that simply omitted them would read as free time. */}
          <h3>Not on the grid</h3>
          <ul>
            {layout.unplaced.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.label}</strong> — no meeting time published
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
