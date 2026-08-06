// @vitest-environment jsdom
// The review table is the last gate before money is written to the ledger, and
// it was untested. These drive the real matching logic through the real UI —
// only Firebase, the file reader and toasts are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import StatementImportModal from './StatementImportModal'
import { addCommissionTransaction } from '../../firebase/firestore'
import { parseImportFile } from '../../utils/exportUtils'

vi.mock('../../firebase/firestore', () => ({
  addCommissionTransaction: vi.fn(async () => ({ id: 'txn' })),
  updatePolicy: vi.fn(async () => {}),
}))
vi.mock('../../utils/exportUtils', () => ({ parseImportFile: vi.fn() }))
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const POLICIES = [
  {
    id: 'p1', policyNumber: '6305162700008293', clientId: 'c1',
    clientName: 'Harendra Varmora', insurer: 'Star Health',
    premium: 748, fyCommission: 12.71,
  },
  {
    id: 'p2', policyNumber: '7489112502043449', clientId: 'c2',
    clientName: 'Mukeshbhai Bhupatbhai Vatukiya', insurer: 'Star Health',
    premium: 18797, fyCommission: 10,
  },
]

// One row that matches the book, one that does not.
const SHEET = [
  { 'Policy No.': '6305162700008293', 'Insured Name': 'Harendra Varmora', Premium: 748, 'Total Comm': 95 },
  { 'Policy No.': '9999999999', 'Insured Name': 'Unknown Person Entirely', Premium: 18797, 'Total Comm': 1880 },
]

/** Describe the statement, then feed it a file — the dropzone is gated on both. */
async function openWithStatement(props = {}) {
  const view = render(
    <StatementImportModal
      open
      onClose={() => {}}
      policies={POLICIES}
      user={{ uid: 'u1', email: 'owner@example.com' }}
      {...props}
    />
  )
  fireEvent.change(screen.getByLabelText('Statement month *'), { target: { value: 'July' } })
  fireEvent.change(screen.getByLabelText('Year *'), { target: { value: '2026' } })
  fireEvent.change(screen.getByLabelText('Statement type *'), { target: { value: 'single' } })
  fireEvent.change(screen.getByLabelText('Carrier *'), { target: { value: 'Star Health' } })

  const fileInput = document.body.querySelector('input[type="file"]')
  fireEvent.change(fileInput, { target: { files: [new File(['x'], 'star-july.csv')] } })
  await screen.findByText('Matched')
  return view
}

const rowCells = index => within(document.body.querySelectorAll('tbody tr')[index])

beforeEach(() => {
  vi.clearAllMocks()
  parseImportFile.mockResolvedValue(SHEET)
})

// Explicit: vitest runs without `globals`, so RTL cannot register its own
// auto-cleanup and every render would otherwise pile up in document.body.
afterEach(cleanup)

describe('StatementImportModal review table', () => {
  it('gates the dropzone until the statement is described', () => {
    render(<StatementImportModal open onClose={() => {}} policies={POLICIES} user={{}} />)
    expect(screen.getByText('Select month, year and statement type first')).toBeTruthy()
  })

  it('renders every editable field as its own block-level row', async () => {
    await openWithStatement()
    const inputs = rowCells(0).getAllByRole('textbox')
    expect(inputs).toHaveLength(5)
    // .table-cell sets white-space:nowrap. Without `block` the five inline
    // inputs sit on one line and spill across the neighbouring columns —
    // jsdom has no layout engine, so the class is the only thing to assert.
    inputs.forEach(input => expect(input.className.split(' ')).toContain('block'))
  })

  it('matches on policy number and leaves the rest unmatched', async () => {
    await openWithStatement()
    expect(rowCells(0).getByText('matched')).toBeTruthy()
    expect(rowCells(1).getByText('unmatched')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Verify & Save 1 Record$/ })).toBeTruthy()
  })

  it('re-matches live when a mis-parsed policy number is corrected', async () => {
    await openWithStatement()
    fireEvent.change(rowCells(1).getAllByRole('textbox')[0], {
      target: { value: '7489112502043449' },
    })
    // Policy number alone only earns 'review' — the name has to corroborate.
    await waitFor(() => expect(rowCells(1).getByText('review')).toBeTruthy())
    fireEvent.change(rowCells(1).getAllByRole('textbox')[1], {
      target: { value: 'Mukeshbhai Bhupatbhai Vatukiya' },
    })
    await waitFor(() => expect(rowCells(1).getByText('matched')).toBeTruthy())
    expect(screen.getByRole('button', { name: /Verify & Save 2 Records/ })).toBeTruthy()
  })

  it('excludes a skipped row from the save', async () => {
    await openWithStatement()
    fireEvent.click(rowCells(0).getByRole('button', { name: 'Skip' }))
    expect(screen.getByRole('button', { name: /Verify & Save 0 Records/ })).toBeTruthy()
  })

  it('posts the matched row against the chosen month with an idempotent key', async () => {
    const onPosted = vi.fn()
    await openWithStatement({ onPosted })
    fireEvent.click(screen.getByRole('button', { name: /Verify & Save 1 Record$/ }))

    await waitFor(() => expect(addCommissionTransaction).toHaveBeenCalledTimes(1))
    expect(addCommissionTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: 'p1',
        policyNumber: '6305162700008293',
        clientId: 'c1',
        insurer: 'Star Health',
        premium: 748,
        receivedCommission: 95,
        netReceived: 95,
        payoutMonth: '2026-07',
        status: 'posted',
        createdByEmail: 'owner@example.com',
      })
    )
    const { postingKey, legacyPostingKeys } = addCommissionTransaction.mock.calls[0][0]
    expect(postingKey).toMatch(/2026-07$/)
    expect(postingKey).not.toMatch(/[^\w-]/)
    expect(legacyPostingKeys).toHaveLength(2)
    await waitFor(() => expect(onPosted).toHaveBeenCalled())
  })

  it('never posts a row with no matching policy', async () => {
    parseImportFile.mockResolvedValue([SHEET[1]])
    await openWithStatement()
    expect(screen.getByRole('button', { name: /Verify & Save 0 Records/ }).disabled).toBe(true)
  })
})
