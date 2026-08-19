import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { App } from './App'
import { subjectCode, termCode } from './domain/ids.ts'
import { termCalendar } from './domain/time.ts'
import { readWorkbook } from '../scripts/xlsx/workbook.ts'
import { buildSections } from '../scripts/normalize/rows.ts'
import { bundleSubject } from '../scripts/normalize/bundle.ts'
import { buildCatalog, catalogBytes } from '../scripts/normalize/catalog.ts'
import { makeSection, meets } from './testing/sections.ts'
import type { Loaders } from './App'
import type { Catalog } from './data/catalog.ts'
import type { SubjectBundle } from './data/bundle.ts'
import type { CourseKey } from './domain/ids.ts'
import type { Section } from './domain/section.ts'

const term = termCode('4269')
const eecs = subjectCode('EECS')
const fall = termCalendar(term, '2026-08-24', '2026-12-18')

/** The real pipeline over the real export fixture: no snapshot, no network. */
const realSections = async (): Promise<readonly Section[]> => {
  const rows = readWorkbook(
    new Uint8Array(await readFile(resolve(process.cwd(), 'tests/fixtures/eecs-4269.xlsx'))),
  ).slice(1)
  return buildSections(rows, fall)
}

const realData = async (): Promise<{ catalog: Catalog; bundle: SubjectBundle }> => {
  const sections = await realSections()
  const file = JSON.parse(new TextDecoder().decode(catalogBytes(buildCatalog(sections, fall)))) as {
    courses: [string, string, number][]
  }
  const catalog: Catalog = {
    term,
    startDate: '2026-08-24',
    endDate: '2026-12-18',
    courses: file.courses.map(([key, title, sectionCount]) => ({
      key: key as CourseKey,
      subject: eecs,
      number: key.slice(key.indexOf('|') + 1),
      title,
      sectionCount,
    })),
  }
  return { catalog, bundle: bundleSubject(sections, eecs, fall) }
}

const loaders = (catalog: Catalog, bundle: SubjectBundle, onSubject?: () => void): Loaders => ({
  catalog: () => Promise.resolve(catalog),
  subject: () => {
    onSubject?.()
    return Promise.resolve(bundle)
  },
})

const failing = (message: string): Loaders => ({
  catalog: () => Promise.reject(new Error(message)),
  subject: () => Promise.reject(new Error(message)),
})

describe('App', () => {
  it('shows no courses at all before anything is typed', async () => {
    // The whole point: 4,412 courses is not a browsing experience, so the
    // catalogue stays hidden until the student says what they want.
    const { catalog, bundle } = await realData()
    render(<App loaders={loaders(catalog, bundle)} />)

    await screen.findByText(/Nothing selected yet/)
    expect(screen.queryByRole('heading', { name: /EECS 168/ })).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('offers matches once a query is typed, and still no sections', async () => {
    const { catalog, bundle } = await realData()
    render(<App loaders={loaders(catalog, bundle)} />)
    await screen.findByText(/Nothing selected yet/)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'EECS 168' } })

    expect(await screen.findByRole('button', { name: /EECS 168/ })).toBeInTheDocument()
    // A match is not a selection: sections appear only after a click.
    expect(screen.queryByText(/credits/)).not.toBeInTheDocument()
  })

  it('reveals the sections only after the course is picked', async () => {
    const { catalog, bundle } = await realData()
    render(<App loaders={loaders(catalog, bundle)} />)
    await screen.findByText(/Nothing selected yet/)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'EECS 168' } })
    fireEvent.click(await screen.findByRole('button', { name: /EECS 168/ }))

    expect(await screen.findByRole('heading', { name: 'EECS 168' })).toBeInTheDocument()
    expect(screen.getAllByText(/credit/).length).toBeGreaterThan(0)
  })

  it('clears the query after picking, so the results collapse', async () => {
    const { catalog, bundle } = await realData()
    render(<App loaders={loaders(catalog, bundle)} />)
    await screen.findByText(/Nothing selected yet/)

    const box = screen.getByRole('searchbox')
    fireEvent.change(box, { target: { value: 'EECS 168' } })
    fireEvent.click(await screen.findByRole('button', { name: /EECS 168/ }))

    await waitFor(() => expect(box).toHaveValue(''))
  })

  it('fetches a subject once, however many of its courses are picked', async () => {
    // Bundles are keyed on subject precisely so a second course from the same
    // subject costs no request.
    const { catalog, bundle } = await realData()
    let fetches = 0
    render(
      <App
        loaders={loaders(catalog, bundle, () => {
          fetches += 1
        })}
      />,
    )
    await screen.findByText(/Nothing selected yet/)

    const box = screen.getByRole('searchbox')
    fireEvent.change(box, { target: { value: 'EECS 168' } })
    fireEvent.click(await screen.findByRole('button', { name: /EECS 168/ }))
    await screen.findByRole('heading', { name: 'EECS 168' })

    fireEvent.change(box, { target: { value: 'EECS 268' } })
    fireEvent.click(await screen.findByRole('button', { name: /EECS 268/ }))
    await screen.findByRole('heading', { name: 'EECS 268' })

    expect(fetches).toBe(1)
  })

  it('removes a course again', async () => {
    const { catalog, bundle } = await realData()
    render(<App loaders={loaders(catalog, bundle)} />)
    await screen.findByText(/Nothing selected yet/)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'EECS 168' } })
    fireEvent.click(await screen.findByRole('button', { name: /EECS 168/ }))
    await screen.findByRole('heading', { name: 'EECS 168' })

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryByRole('heading', { name: 'EECS 168' })).not.toBeInTheDocument()
  })

  it('says so when nothing matches, rather than showing something close', async () => {
    const { catalog, bundle } = await realData()
    render(<App loaders={loaders(catalog, bundle)} />)
    await screen.findByText(/Nothing selected yet/)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz' } })
    expect(await screen.findByText(/No course matches that/)).toBeInTheDocument()
  })

  it('explains a failed load and says what to run', async () => {
    // Bundles are generated and not committed, so "never generated" is
    // overwhelmingly the likely cause.
    render(<App loaders={failing('could not load /bundles/4269/index.json: HTTP 404')} />)

    expect(await screen.findByText(/HTTP 404/)).toBeInTheDocument()
    expect(screen.getByText(/npm run normalize/)).toBeInTheDocument()
  })

  it('keeps its heading whatever the state', async () => {
    render(<App loaders={failing('boom')} />)
    expect(screen.getByRole('heading', { name: 'KU Schedule Builder' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
  })
})

/**
 * The schedule panel.
 *
 * The first three run against the real EECS export, so linkage, solving and
 * ranking are all exercised on data KU actually published. The failures use
 * synthetic bundles: a clash between two named courses is not something the
 * live fixture can be relied on to contain, and pinning a test to one that
 * does today makes it fail the next time KU reschedules something.
 */
describe('App schedules', () => {
  const pick = async (query: string) => {
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } })
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(query) }))
  }

  const syntheticBundle = (sections: readonly Section[]): SubjectBundle => ({
    term,
    subject: eecs,
    startDate: '2026-08-24',
    endDate: '2026-12-18',
    sections,
  })

  const syntheticCatalog = (keys: readonly string[]): Catalog => ({
    term,
    startDate: '2026-08-24',
    endDate: '2026-12-18',
    courses: keys.map((key) => ({
      key: key as CourseKey,
      subject: eecs,
      number: key.slice(key.indexOf('|') + 1),
      title: 'Synthetic',
      sectionCount: 1,
    })),
  })

  it('draws a week once a course is picked', async () => {
    const { catalog, bundle } = await realData()
    render(<App loaders={loaders(catalog, bundle)} />)
    await screen.findByText(/Nothing selected yet/)

    await pick('EECS 168')

    expect(await screen.findByRole('region', { name: 'Weekly schedule' })).toBeInTheDocument()
    expect(screen.getByText(/Schedule 1 of/)).toBeInTheDocument()
  })

  it('says what to register for, which is not everything it draws', async () => {
    // A parent lecture is drawn on the grid but enrolled through its child, so
    // the panel has to name the section a student actually signs up for.
    const { catalog, bundle } = await realData()
    render(<App loaders={loaders(catalog, bundle)} />)
    await screen.findByText(/Nothing selected yet/)

    await pick('EECS 168')

    expect(await screen.findByText(/enroll in/)).toBeInTheDocument()
  })

  it('pages through the ranked schedules', async () => {
    const { catalog, bundle } = await realData()
    render(<App loaders={loaders(catalog, bundle)} />)
    await screen.findByText(/Nothing selected yet/)

    await pick('EECS 168')
    await screen.findByText(/Schedule 1 of/)

    // The first schedule is the best one, so Previous has nowhere to go.
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(/Schedule 2 of/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
  })

  it('names the two courses to blame instead of saying nothing works', async () => {
    const clash = [
      makeSection({
        course: 'EECS 100',
        classNbr: 1,
        scheduled: [meets('MWF', '09:00 AM', '09:50 AM')],
      }),
      makeSection({
        course: 'EECS 200',
        classNbr: 2,
        scheduled: [meets('MWF', '09:00 AM', '09:50 AM')],
      }),
    ]
    render(
      <App loaders={loaders(syntheticCatalog(['EECS|100', 'EECS|200']), syntheticBundle(clash))} />,
    )
    await screen.findByText(/Nothing selected yet/)

    await pick('EECS 100')
    await pick('EECS 200')

    expect(await screen.findByText(/cannot be taken together/)).toBeInTheDocument()
    expect(screen.getByText(/EECS 100 and EECS 200/)).toBeInTheDocument()
  })

  it('says a course has no sections rather than blaming a clash', async () => {
    render(<App loaders={loaders(syntheticCatalog(['EECS|100']), syntheticBundle([]))} />)
    await screen.findByText(/Nothing selected yet/)

    await pick('EECS 100')

    expect(await screen.findByText(/has no sections in this term/)).toBeInTheDocument()
  })
})
