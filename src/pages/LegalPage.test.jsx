// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LegalPage from './LegalPage.jsx'
import { BUSINESS } from '../utils/legal.js'

function show(section) {
  return render(
    <MemoryRouter>
      <LegalPage section={section} />
    </MemoryRouter>,
  )
}

describe('LegalPage', () => {
  it('names the DMCA agent and a postal city', () => {
    show('dmca')
    expect(screen.getAllByText(new RegExp(BUSINESS.dmcaAgent)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(new RegExp(BUSINESS.city)).length).toBeGreaterThan(0)
  })

  it('says there is no consumer subscription checkout', () => {
    show('terms')
    expect(screen.getByText(/no auto-renewing Stripe plan/i)).toBeTruthy()
  })

  it('covers greetings opt-out and self-hosted fonts', () => {
    show('privacy')
    expect(screen.getByText(/STOP/)).toBeTruthy()
    expect(screen.getByText(/not from Google Fonts/i)).toBeTruthy()
    expect(screen.getByText(/session-replay/i)).toBeTruthy()
  })
})
