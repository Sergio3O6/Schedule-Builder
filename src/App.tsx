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

import { useCallback, useEffect, useState } from 'react'
import { loadCatalog } from './data/catalog.ts'
import { loadSubject } from './data/bundle.ts'
import { splitCourseKey, termCode } from './domain/ids.ts'
import { vocabularyLabel } from './domain/section.ts'
import { countMatches, searchCourses } from './ui/search.ts'
import { describeUnscheduled, formatCredits } from './ui/format.ts'
import type { Catalog, CourseEntry } from './data/catalog.ts'
import type { SubjectBundle } from './data/bundle.ts'
import type { CourseKey, SubjectCode } from './domain/ids.ts'
import type { Section } from './domain/section.ts'
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

  const sectionsFor = (key: CourseKey): readonly Section[] | undefined => {
    const bundle = bundles.get(splitCourseKey(key).subject)
    return bundle?.sections.filter((section) => section.courseKey === key)
  }

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
