import { render, screen, waitFor } from '@testing-library/react'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { App } from './App'
import { groupByCourse } from './ui/courses.ts'
import { subjectCode, termCode } from './domain/ids.ts'
import { termCalendar } from './domain/time.ts'
import { readWorkbook } from '../scripts/xlsx/workbook.ts'
import { buildSections } from '../scripts/normalize/rows.ts'
import { bundleSubject } from '../scripts/normalize/bundle.ts'
import type { SubjectBundle } from './data/bundle.ts'
import type { LoadSubject } from './App'

const term = termCode('4269')
const eecs = subjectCode('EECS')
const fall = termCalendar(term, '2026-08-24', '2026-12-18')

/** The real normalizer over the real export fixture — no snapshot, no network. */
const realBundle = async (): Promise<SubjectBundle> => {
  const rows = readWorkbook(
    new Uint8Array(await readFile(resolve(process.cwd(), 'tests/fixtures/eecs-4269.xlsx'))),
  ).slice(1)
  return bundleSubject(buildSections(rows, fall), eecs, fall)
}

const serving = (bundle: SubjectBundle): LoadSubject => () => Promise.resolve(bundle)
const failing = (message: string): LoadSubject => () => Promise.reject(new Error(message))

describe('groupByCourse', () => {
  it('gathers the sections of a course under it', async () => {
    const bundle = await realBundle()
    const courses = groupByCourse(bundle.sections)

    expect(courses.length).toBeGreaterThan(0)
    expect(courses.length).toBeLessThan(bundle.sections.length)
    // Nothing is lost or duplicated on the way into the groups.
    expect(courses.reduce((n, c) => n + c.sections.length, 0)).toBe(bundle.sections.length)
    expect(new Set(courses.map((c) => c.key)).size).toBe(courses.length)
  })

  it('keeps the bundle order rather than forming a second opinion', async () => {
    // The export is already in catalogue order; sorting here would be an
    // opinion with nothing to base it on.
    const bundle = await realBundle()
    const first = bundle.sections[0]
    expect(groupByCourse(bundle.sections)[0]?.key).toBe(first?.courseKey)
  })

  it('carries the course number for display', async () => {
    const courses = groupByCourse((await realBundle()).sections)
    expect(courses.every((c) => c.number !== '' && !c.number.includes('|'))).toBe(true)
  })
})

describe('App', () => {
  it('says it is loading before anything arrives', () => {
    render(<App load={() => new Promise(() => undefined)} />)
    expect(screen.getByText(/Loading EECS/)).toBeInTheDocument()
  })

  it('lists the real courses once the bundle loads', async () => {
    const bundle = await realBundle()
    render(<App load={serving(bundle)} />)

    const heading = await screen.findByRole('heading', { name: 'EECS 168' })
    expect(heading).toBeInTheDocument()
    expect(screen.getByText(/sections/)).toBeInTheDocument()
  })

  it('shows a meeting the way the schedule prints it', async () => {
    render(<App load={serving(await realBundle())} />)
    await screen.findByRole('heading', { name: 'EECS 168' })
    // At least one real meeting line, days followed by a time range.
    expect(screen.getAllByText(/^[MTuWThFSa]+ \d{1,2}:\d{2} [AP]M\u2013/).length).toBeGreaterThan(0)
  })

  it('names the unscheduled sections instead of hiding them', async () => {
    // 260 of the EECS fixture's rows publish no real meeting time. Dropping
    // them would silently remove sections a student can still enroll in.
    render(<App load={serving(await realBundle())} />)
    await screen.findByRole('heading', { name: 'EECS 168' })
    expect(screen.getAllByText(/By appointment|No meeting time published|TBA/).length).toBeGreaterThan(0)
  })

  it('explains a failure and says what to run', async () => {
    // The overwhelmingly likely cause is that the bundles were never
    // generated, since they are not committed.
    render(<App load={failing('could not load /bundles/4269/EECS.json: HTTP 404')} />)

    await waitFor(() => {
      expect(screen.getByText(/HTTP 404/)).toBeInTheDocument()
    })
    expect(screen.getByText(/npm run normalize/)).toBeInTheDocument()
  })

  it('keeps its heading whatever the state', async () => {
    render(<App load={failing('boom')} />)
    expect(screen.getByRole('heading', { name: 'KU Schedule Builder' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
  })
})
