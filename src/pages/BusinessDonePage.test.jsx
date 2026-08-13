// @vitest-environment jsdom
// Smoke tests: a clean build does not prove the page renders, and the headline
// numbers are the whole point of it. These drive the real reducers through the
// real component — only the data source and the file writer are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import BusinessDonePage from './BusinessDonePage'
import { usePolicies } from '../hooks/usePolicies'
import { exportToExcel } from '../utils/exportUtils'

vi.mock('../hooks/usePolicies', () => ({ usePolicies: vi.fn() }))
vi.mock('../utils/exportUtils', () => ({
  exportToExcel: vi.fn(async () => {}),
  exportToCSV: vi.fn(async () => {}),
}))
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

// Dates are chosen to sit inside FY 2026-27 (Apr 2026 - Mar 2027), the default view.
const BOOK = [
  { id: 'a', policyNumber: 'P-1', clientName: 'Asha', insurer: 'Star Health', policyType: 'Health', premium: 10000, policyYear: 1, status: 'Active', startDate: '2026-05-01', expiryDate: '2027-04-30' },
  { id: 'b', policyNumber: 'P-2', clientName: 'Bhavin', insurer: 'Star Health', policyType: 'Health', premium: 5000, policyYear: 2, parentPolicyId: 'old', status: 'Active', startDate: '2026-06-01', expiryDate: '2027-05-31' },
  { id: 'c', policyNumber: 'P-3', clientName: 'Chirag', insurer: 'HDFC ERGO', policyType: 'Motor', premium: 25000, policyYear: 1, status: 'Active', startDate: '2026-07-15', expiryDate: '2027-07-14' },
  // Outside the current FY — must never be counted.
  { id: 'd', policyNumber: 'P-4', clientName: 'Old', insurer: 'HDFC ERGO', policyType: 'Motor', premium: 99999, policyYear: 1, status: 'Active', startDate: '2024-01-01', expiryDate: '2025-01-01' },
]

const tile = label => screen.getByText(label).closest('div')

beforeEach(() => {
  vi.clearAllMocks()
  // Only Date is faked, so React Testing Library's own timers still run. Without
  // this the suite silently starts failing in April 2027, when "This FY" rolls
  // over and the fixtures fall outside the default period.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 7, 13))
  usePolicies.mockReturnValue({ policies: BOOK, loading: false, error: null })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('BusinessDonePage', () => {
  it('shows a skeleton while policies load', () => {
    usePolicies.mockReturnValue({ policies: [], loading: true, error: null })
    const { container } = render(<BusinessDonePage />)
    expect(container.querySelectorAll('.commission-skeleton').length).toBeGreaterThan(0)
  })

  it('splits new business from renewals for the current financial year', () => {
    render(<BusinessDonePage />)
    // Two fresh (a, c) and one renewal (b); the 2024 policy is out of period.
    expect(within(tile('New business')).getByText('2')).toBeTruthy()
    expect(within(tile('Renewals done')).getByText('1')).toBeTruthy()
    expect(within(tile('Total policies')).getByText('3')).toBeTruthy()
  })

  it('defaults to the category breakdown and can switch to company', () => {
    render(<BusinessDonePage />)
    expect(screen.getByText('Motor')).toBeTruthy()
    expect(screen.getByText('Health')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Company-wise' }))
    // Canonical spellings — the breakdown merges variants of one carrier.
    expect(screen.getByText('Star Health and Allied Insurance')).toBeTruthy()
    expect(screen.getByText('HDFC ERGO General Insurance')).toBeTruthy()
  })

  it('changing the period changes what is counted', () => {
    render(<BusinessDonePage />)
    fireEvent.click(screen.getByRole('button', { name: 'This month' }))
    expect(screen.getByText('No business written in this period')).toBeTruthy()
  })

  it('exports the policy list so the owner can verify row by row', async () => {
    render(<BusinessDonePage />)
    fireEvent.click(screen.getByRole('button', { name: /Excel \(policy list\)/ }))

    expect(exportToExcel).toHaveBeenCalledTimes(1)
    const [rows, cols] = exportToExcel.mock.calls[0]
    expect(rows).toHaveLength(3)
    // The Business column is what makes the sheet checkable by hand.
    const business = cols.find(col => col.header === 'Business')
    expect(business.accessor(rows.find(r => r.id === 'b'))).toBe('Renewal')
    expect(business.accessor(rows.find(r => r.id === 'a'))).toBe('New Business')
  })

  it('surfaces a load failure instead of rendering zeroes as fact', () => {
    usePolicies.mockReturnValue({ policies: [], loading: false, error: new Error('offline') })
    render(<BusinessDonePage />)
    expect(screen.getByText(/Could not load policies/)).toBeTruthy()
  })
})
