import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WeekGrid } from './WeekGrid'
import { arranged, makeSection, meets } from '../testing/sections.ts'
import type { CalendarSource } from './calendar.ts'

let counter = 0
const source = (label: string, section: Partial<Parameters<typeof makeSection>[0]> = {}) => {
  counter += 1
  return {
    id: label,
    label,
    section: makeSection({ course: label, classNbr: 30000 + counter, ...section }),
  } satisfies CalendarSource
}

const grid = () => screen.getByRole('region', { name: 'Weekly schedule' })

describe('WeekGrid', () => {
  it('heads every column it draws', () => {
    render(<WeekGrid sources={[]} />)
    expect(within(grid()).getByText('Mon')).toBeInTheDocument()
    expect(within(grid()).getByText('Fri')).toBeInTheDocument()
    expect(within(grid()).queryByText('Sat')).not.toBeInTheDocument()
  })

  it('draws one box per day a class meets', () => {
    render(
      <WeekGrid sources={[source('EECS 168', { scheduled: [meets('MWF', '09:00 AM', '09:50 AM')] })]} />,
    )
    expect(screen.getAllByText('EECS 168')).toHaveLength(3)
    expect(screen.getAllByText('9:00 AM\u20139:50 AM')).toHaveLength(3)
  })

  it('positions a block by where it falls in the grid, not by pixels', () => {
    // 9:00–9:50 in a 9:00–11:00 grid: flush to the top, and 50 of 120 minutes
    // tall. Percentages rather than pixels are what let one height scale the
    // whole thing, so the numbers are worth pinning.
    render(
      <WeekGrid sources={[source('EECS 168', { scheduled: [meets('M', '09:00 AM', '11:00 AM')] })]} />,
    )
    const block = screen.getByText('EECS 168').closest('.week-block')
    expect(block).toHaveStyle({ top: '0%', height: '100%' })
  })

  it('halves the width of two classes that clash', () => {
    render(
      <WeekGrid
        sources={[
          source('EECS 168', { scheduled: [meets('M', '09:00 AM', '10:00 AM')] }),
          source('MATH 126', { scheduled: [meets('M', '09:30 AM', '10:30 AM')] }),
        ]}
      />,
    )
    expect(screen.getByText('EECS 168').closest('.week-block')).toHaveStyle({
      left: '0%',
      width: '50%',
    })
    expect(screen.getByText('MATH 126').closest('.week-block')).toHaveStyle({
      left: '50%',
      width: '50%',
    })
  })

  it('colours by course, so two sections of one course match', () => {
    const one = source('EECS 168', { scheduled: [meets('M', '09:00 AM', '10:00 AM')] })
    const other = { ...one, section: makeSection({ course: 'EECS 168', classNbr: 39999,
      scheduled: [meets('W', '09:00 AM', '10:00 AM')] }) }
    render(<WeekGrid sources={[one, other]} />)

    const hues = screen
      .getAllByText('EECS 168')
      .map((node) => node.closest('.week-block')?.className.match(/hue-\d/)?.[0])
    expect(new Set(hues).size).toBe(1)
  })

  it('says a section is not on the grid rather than leaving it off', () => {
    render(<WeekGrid sources={[source('EECS 690', { unscheduled: [arranged()] })]} />)
    expect(screen.getByRole('heading', { name: 'Not on the grid' })).toBeInTheDocument()
    expect(screen.getByText('EECS 690')).toBeInTheDocument()
  })

  it('keeps that list out of the way when everything is placed', () => {
    render(
      <WeekGrid sources={[source('EECS 168', { scheduled: [meets('MWF', '09:00 AM', '09:50 AM')] })]} />,
    )
    expect(screen.queryByRole('heading', { name: 'Not on the grid' })).not.toBeInTheDocument()
  })

  it('labels the hours down the side', () => {
    render(
      <WeekGrid sources={[source('EECS 168', { scheduled: [meets('M', '09:00 AM', '11:00 AM')] })]} />,
    )
    expect(screen.getByText('9:00 AM')).toBeInTheDocument()
    expect(screen.getByText('10:00 AM')).toBeInTheDocument()
    expect(screen.getByText('11:00 AM')).toBeInTheDocument()
  })
})
