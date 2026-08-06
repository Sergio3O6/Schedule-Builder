import { render, screen } from '@testing-library/react'
import { App } from './App'

// Exists to prove the toolchain end to end: React 19 + jsdom + RTL + jest-dom
// matchers all resolve in CI. Replaced by real tests once there is real UI.
test('renders the app shell', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'KU Schedule Builder' })).toBeInTheDocument()
})
