/**
 * The first thing that puts real data on screen.
 *
 * One subject, listed. No selection, no solver, no calendar — those are the
 * next commits, and each of them is easier to judge against something visible
 * than against a description. What this proves is that the whole pipeline
 * lines up end to end: a crawl of KU's export, a normalizer, a bundle on disk,
 * and a loader that agrees with all three.
 */

import { useEffect, useState } from 'react'
import { loadSubject } from './data/bundle.ts'
import { subjectCode, termCode } from './domain/ids.ts'
import { groupByCourse } from './ui/courses.ts'
import { vocabularyLabel } from './domain/section.ts'
import { describeUnscheduled, formatCredits } from './ui/format.ts'
import type { SubjectBundle } from './data/bundle.ts'
import type { Section } from './domain/section.ts'
import './ui/app.css'

/** Hard-coded until there is a subject picker. One term, one subject. */
const TERM = termCode('4269')
const SUBJECT = subjectCode('EECS')

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly bundle: SubjectBundle }
  | { readonly kind: 'failed'; readonly message: string }

function MeetingList({ section }: { section: Section }) {
  const meetings = [...section.scheduled, ...section.unscheduled]
  return (
    <ul className="meetings">
      {meetings.map((meeting, index) => (
        <li key={index} className={meeting.kind === 'scheduled' ? 'meeting' : 'meeting unscheduled'}>
          {describeUnscheduled(meeting)}
        </li>
      ))}
    </ul>
  )
}

function SectionRow({ section }: { section: Section }) {
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
      <MeetingList section={section} />
    </li>
  )
}

/** Injected so tests need neither a network nor a generated bundle on disk. */
export type LoadSubject = typeof loadSubject

export function App({ load = loadSubject }: { load?: LoadSubject } = {}) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    // Guarded because StrictMode runs effects twice in development, and because
    // a slow load that resolves after unmount would otherwise set state on a
    // component nobody is looking at.
    let cancelled = false
    load(TERM, SUBJECT).then(
      (bundle) => {
        if (!cancelled) setState({ kind: 'ready', bundle })
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [load])

  return (
    <main>
      <h1>KU Schedule Builder</h1>
      {state.kind === 'loading' && <p className="status">Loading {SUBJECT}…</p>}
      {state.kind === 'failed' && (
        <div className="status error">
          <p>{state.message}</p>
          <p>
            Bundles are generated, not committed. Run{' '}
            <code>npm run normalize -- --term={TERM}</code> first.
          </p>
        </div>
      )}
      {state.kind === 'ready' && <SubjectListing bundle={state.bundle} />}
    </main>
  )
}

function SubjectListing({ bundle }: { bundle: SubjectBundle }) {
  const courses = groupByCourse(bundle.sections)
  return (
    <>
      <p className="status">
        {bundle.subject} · {courses.length} courses · {bundle.sections.length} sections ·{' '}
        {bundle.startDate} to {bundle.endDate}
      </p>
      <ol className="courses">
        {courses.map((course) => (
          <li key={course.key} className="course">
            <h2>
              {bundle.subject} {course.number}
            </h2>
            <p className="course-title">{course.sections[0]?.title}</p>
            <ol className="sections">
              {course.sections.map((section) => (
                <SectionRow key={section.classNbr} section={section} />
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </>
  )
}
