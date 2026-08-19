/**
 * Search, select, and see the sections of what was selected.
 *
 * The catalogue is never listed. 4,412 courses is not a browsing experience,
 * and a student arrives knowing what they want — so nothing is shown until
 * something is typed, and a course's sections appear only once it is picked.
 *
 * Bundles load per subject, on demand, when a course from that subject is
 * selected. The index that search reads is the only thing fetched up front.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadCatalog } from './data/catalog.ts'
import { loadSubject } from './data/bundle.ts'
import { splitCourseKey, termCode } from './domain/ids.ts'
import { vocabularyLabel } from './domain/section.ts'
import { courseUnits } from './domain/unit.ts'
import { solveSchedules } from './domain/solve.ts'
import { rankSchedules } from './domain/preferences.ts'
import { countMatches, searchCourses } from './ui/search.ts'
import { describeUnscheduled, formatCredits, formatMinuteOfDay } from './ui/format.ts'
import { WeekGrid } from './ui/WeekGrid.tsx'
import type { Catalog, CourseEntry } from './data/catalog.ts'
import type { SubjectBundle } from './data/bundle.ts'
import type { CourseKey, SubjectCode } from './domain/ids.ts'
import type { Section } from './domain/section.ts'
import type { RankedSchedule } from './domain/preferences.ts'
import type { CalendarSource } from './ui/calendar.ts'
import './ui/app.css'

/** Hard-coded until there is a term picker. */
const TERM = termCode('4269')

export interface Loaders {
  readonly catalog: typeof loadCatalog
  readonly subject: typeof loadSubject
}

const DEFAULT_LOADERS: Loaders = { catalog: loadCatalog, subject: loadSubject }

function SearchResults({
  matches,
  total,
  selected,
  onPick,
}: {
  matches: readonly CourseEntry[]
  total: number
  selected: ReadonlySet<CourseKey>
  onPick: (course: CourseEntry) => void
}) {
  if (matches.length === 0) return <p className="status">No course matches that.</p>

  return (
    <>
      <ul className="results">
        {matches.map((course) => (
          <li key={course.key}>
            <button type="button" onClick={() => onPick(course)} disabled={selected.has(course.key)}>
              <span className="result-code">
                {course.subject} {course.number}
              </span>
              <span className="result-title">{course.title}</span>
              <span className="result-count">
                {course.sectionCount} {course.sectionCount === 1 ? 'section' : 'sections'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {total > matches.length && (
        <p className="status">
          {total - matches.length} more match — keep typing to narrow it down.
        </p>
      )}
    </>
  )
}

function SectionRow({ section }: { section: Section }) {
  const meetings = [...section.scheduled, ...section.unscheduled]
  return (
    <li className="section">
      <div className="section-head">
        <span className="section-number">{section.number ?? '—'}</span>
        <span className="section-component">{vocabularyLabel(section.component)}</span>
        <span className="section-credits">{formatCredits(section.credits)}</span>
        {!section.enrollable && <span className="section-flag">not directly enrollable</span>}
        {section.consent.kind === 'known' && section.consent.code !== 'None' && (
          <span className="section-flag">{section.consent.code} consent</span>
        )}
      </div>
      <ul className="meetings">
        {meetings.map((meeting, index) => (
          <li
            key={index}
            className={meeting.kind === 'scheduled' ? 'meeting' : 'meeting unscheduled'}
          >
            {describeUnscheduled(meeting)}
          </li>
        ))}
      </ul>
    </li>
  )
}

function SelectedCourse({
  course,
  sections,
  onRemove,
}: {
  course: CourseEntry
  sections: readonly Section[] | undefined
  onRemove: () => void
}) {
  return (
    <li className="course">
      <div className="course-head">
        <h2>
          {course.subject} {course.number}
        </h2>
        <button type="button" className="remove" onClick={onRemove}>
          Remove
        </button>
      </div>
      <p className="course-title">{course.title}</p>
      {sections === undefined ? (
        <p className="status">Loading sections…</p>
      ) : (
        <ol className="sections">
          {sections.map((section) => (
            <SectionRow key={section.classNbr} section={section} />
          ))}
        </ol>
      )}
    </li>
  )
}

/** 'EECS 168' from a course key, for a grid block and a heading alike. */
function courseLabel(key: CourseKey): string {
  const { subject, number } = splitCourseKey(key)
  return `${subject} ${number}`
}

/**
 * Every section of every unit, as blocks for the grid.
 *
 * Keyed on the COURSE rather than the unit so that a lecture and its lab share
 * one colour — they are one course to a student, and colouring them separately
 * would imply they were separate choices.
 */
function sourcesFor(ranked: RankedSchedule): readonly CalendarSource[] {
  return ranked.schedule.units.flatMap((unit) =>
    unit.sections.map((section) => ({
      id: unit.courseKey,
      label: courseLabel(unit.courseKey),
      section,
    })),
  )
}

/** 'Mon, Wed, Fri · 2h 10m of gaps · first class 9:00 AM'. */
function describeShape(ranked: RankedSchedule): string {
  const parts: string[] = []
  const dayCount = ranked.shape.days.length
  parts.push(`${dayCount} ${dayCount === 1 ? 'day' : 'days'} on campus`)

  const gap = ranked.shape.gapMinutes
  if (gap > 0) {
    const hours = Math.floor(gap / 60)
    const minutes = gap % 60
    parts.push(`${hours > 0 ? `${hours}h ` : ''}${minutes}m between classes`)
  } else {
    parts.push('no gaps')
  }

  const earliest = ranked.shape.days.reduce<number | null>(
    (soonest, day) => (soonest === null ? day.firstStart : Math.min(soonest, day.firstStart)),
    null,
  )
  if (earliest !== null) parts.push(`starts ${formatMinuteOfDay(earliest as never)}`)

  return parts.join(' · ')
}

/**
 * The generated schedules, and a way through them.
 *
 * A count alone would be useless — "37 schedules" is not an answer — so the
 * best one is drawn immediately and the rest are paged, in ranked order. The
 * shape line under the controls is why this one came first, because a ranked
 * list with no stated reason reads as arbitrary.
 */
function Schedules({
  ranked,
  index,
  onIndex,
  truncated,
}: {
  ranked: readonly RankedSchedule[]
  index: number
  onIndex: (next: number) => void
  truncated: boolean
}) {
  const current = ranked[index]
  if (current === undefined) return null

  return (
    <section className="schedules" aria-label="Generated schedules">
      <div className="schedule-bar">
        <div className="schedule-nav">
          <button type="button" onClick={() => onIndex(index - 1)} disabled={index === 0}>
            Previous
          </button>
          <span className="schedule-count">
            Schedule {index + 1} of {ranked.length}
            {truncated && '+'}
          </span>
          <button
            type="button"
            onClick={() => onIndex(index + 1)}
            disabled={index >= ranked.length - 1}
          >
            Next
          </button>
        </div>
        <p className="schedule-why">{describeShape(current)}</p>
      </div>

      <WeekGrid sources={sourcesFor(current)} />

      <ul className="schedule-picks">
        {current.schedule.units.map((unit) => (
          <li key={unit.id}>
            <strong>{courseLabel(unit.courseKey)}</strong>{' '}
            {/* What to actually register for, which is not always what is drawn:
                a parent lecture appears on the grid but is enrolled through its
                child. Saying only "section 1100" would send a student to the
                wrong row on their enrolment page. */}
            <span className="schedule-enroll">
              {unit.enroll.length === 0
                ? 'no directly enrollable section'
                : `enroll in ${unit.enroll.map((s) => s.number ?? '—').join(' + ')}`}
            </span>
            {unit.sections.length > unit.enroll.length && (
              <span className="schedule-attached">
                {' '}
                (also attends{' '}
                {unit.sections
                  .filter((s) => !s.enrollable)
                  .map((s) => `${vocabularyLabel(s.component)} ${s.number ?? '—'}`)
                  .join(', ')}
                )
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function App({ loaders = DEFAULT_LOADERS }: { loaders?: Loaders } = {}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<readonly CourseEntry[]>([])
  const [bundles, setBundles] = useState<ReadonlyMap<SubjectCode, SubjectBundle>>(new Map())

  useEffect(() => {
    let cancelled = false
    loaders.catalog(TERM).then(
      (loaded) => {
        if (!cancelled) setCatalog(loaded)
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      },
    )
    return () => {
      cancelled = true
    }
  }, [loaders])

  const pick = useCallback(
    (course: CourseEntry) => {
      setPicked((current) =>
        current.some((c) => c.key === course.key) ? current : [...current, course],
      )
      setQuery('')

      // Fetch the subject's bundle the first time one of its courses is
      // picked. Selecting a second course from the same subject costs no
      // request, which is why bundles are keyed on subject rather than course.
      const subject = course.subject
      setBundles((current) => {
        if (current.has(subject)) return current
        loaders.subject(TERM, subject).then(
          (bundle) => setBundles((next) => new Map(next).set(subject, bundle)),
          (failure: unknown) =>
            setError(failure instanceof Error ? failure.message : String(failure)),
        )
        return current
      })
    },
    [loaders],
  )

  const sectionsFor = useCallback(
    (key: CourseKey): readonly Section[] | undefined => {
      const bundle = bundles.get(splitCourseKey(key).subject)
      return bundle?.sections.filter((section) => section.courseKey === key)
    },
    [bundles],
  )

  // Nothing can be solved until every picked course's bundle has arrived;
  // solving a subset would present a schedule that silently omits a course.
  const options = useMemo(() => {
    const ready = picked.map((course) => sectionsFor(course.key))
    if (ready.some((sections) => sections === undefined)) return null
    return picked.map((course, at) => ({
      courseKey: course.key,
      units: courseUnits(TERM, ready[at] ?? []),
    }))
  }, [picked, sectionsFor])

  const solved = useMemo(
    () => (options === null ? null : solveSchedules(options)),
    [options],
  )
  const ranked = useMemo(
    () => (solved === null ? [] : rankSchedules(solved.schedules)),
    [solved],
  )

  const [index, setIndex] = useState(0)
  // The ranking changes whenever the courses do, so a held index would point at
  // an unrelated schedule — or past the end of a shorter list.
  useEffect(() => setIndex(0), [ranked])

  if (error !== null) {
    return (
      <main>
        <h1>KU Schedule Builder</h1>
        <div className="status error">
          <p>{error}</p>
          <p>
            Data is generated, not committed. Run <code>npm run normalize -- --term={TERM}</code>{' '}
            first.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main>
      <h1>KU Schedule Builder</h1>

      <label className="search">
        <span>Add a course</span>
        <input
          type="search"
          value={query}
          placeholder="EECS 168, or calculus"
          autoComplete="off"
          disabled={catalog === null}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {catalog === null && <p className="status">Loading the course index…</p>}

      {catalog !== null && query.trim() !== '' && (
        <SearchResults
          matches={searchCourses(catalog.courses, query)}
          total={countMatches(catalog.courses, query)}
          selected={new Set(picked.map((c) => c.key))}
          onPick={pick}
        />
      )}

      {picked.length > 0 && solved === null && (
        <p className="status">Loading sections…</p>
      )}

      {solved !== null && ranked.length > 0 && (
        <Schedules
          ranked={ranked}
          index={Math.min(index, ranked.length - 1)}
          onIndex={setIndex}
          truncated={solved.truncated}
        />
      )}

      {/* A bare "no schedule works" is the least useful thing to say, so the
          two failures that can be named are named. */}
      {solved !== null && ranked.length === 0 && solved.empty.length > 0 && (
        <div className="status error">
          <p>
            {solved.empty.map(courseLabel).join(', ')} has no sections in this term, so nothing can
            be built around it.
          </p>
        </div>
      )}

      {solved !== null && ranked.length === 0 && solved.empty.length === 0 && (
        <div className="status error">
          {solved.blockers.length > 0 ? (
            <p>
              No schedule works. {solved.blockers.map(([a, b]) => `${courseLabel(a)} and ${courseLabel(b)}`).join('; ')}{' '}
              cannot be taken together — every section of one clashes with every section of the
              other.
            </p>
          ) : (
            <p>
              No schedule works. No single pair is to blame; the courses only conflict once they
              are combined, so try dropping any one of them.
            </p>
          )}
        </div>
      )}

      {picked.length === 0 ? (
        <p className="status empty">
          Nothing selected yet. Search above to add the courses you are considering.
        </p>
      ) : (
        <ol className="courses">
          {picked.map((course) => (
            <SelectedCourse
              key={course.key}
              course={course}
              sections={sectionsFor(course.key)}
              onRemove={() => setPicked((current) => current.filter((c) => c.key !== course.key))}
            />
          ))}
        </ol>
      )}
    </main>
  )
}
