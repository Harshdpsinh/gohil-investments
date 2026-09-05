// @vitest-environment jsdom
// The review table is the last gate before money is written to the ledger, and
// it was untested. These drive the real matching logic through the real UI —
// only Firebase, the file reader and toasts are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import StatementImportModal from './StatementImportModal'
import { addClient, addCommissionTransaction, addPolicy, updatePolicy } from '../../firebase/firestore'
import { upsertCommissionMaster } from '../../firebase/commissionOps'
import { parseImportFile } from '../../utils/exportUtils'

vi.mock('../../firebase/firestore', () => ({
  addCommissionTransaction: vi.fn(async () => ({ id: 'txn' })),
  updatePolicy: vi.fn(async () => {}),
  addPolicy: vi.fn(async () => ({ id: 'new-pol' })),
  addClient: vi.fn(async () => ({ id: 'new-cli' })),
}))
vi.mock('../../firebase/commissionOps', () => ({
  upsertCommissionMaster: vi.fn(async () => ({ id: 'master-1' })),
}))
vi.mock('../../utils/exportUtils', () => ({ parseImportFile: vi.fn() }))
vi.mock('../../utils/pdfStatement', () => ({
  parsePdfStatement: vi.fn(async () => ({ rows: [], format: 'pdf' })),
  extractLines: vi.fn(async () => []),
}))
vi.mock('../../utils/staleChunk', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    reloadIfPageIsStale: vi.fn(async () => false),
    reloadOnceForStaleChunk: vi.fn(() => false),
  }
})
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const POLICIES = [
  {
    id: 'p1', policyNumber: '6305162700008293', clientId: 'c1',
    clientName: 'Harendra Varmora', insurer: 'Star Health',
    premium: 748, fyCommission: 12.71, policyYear: 1, status: 'Active',
  },
  {
    id: 'p2', policyNumber: '7489112502043449', clientId: 'c2',
    clientName: 'Mukeshbhai Bhupatbhai Vatukiya', insurer: 'Star Health',
    premium: 18797, fyCommission: 10, ryCommission: 7.5, policyYear: 2, status: 'Active',
  },
]

// One row that matches the book, one that does not.
const SHEET = [
  { 'Policy No.': '6305162700008293', 'Insured Name': 'Harendra Varmora', Premium: 748, 'Total Comm': 95 },
  { 'Policy No.': '9999999999', 'Insured Name': 'Unknown Person Entirely', Premium: 18797, 'Total Comm': 1880 },
]

/** Describe the statement, then feed it a file — the dropzone is gated on both. */
async function openWithStatement(props = {}, sheet = SHEET) {
  parseImportFile.mockResolvedValue(sheet)
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
    expect(screen.getByRole('button', { name: /Verify & Save 1 Record$/ })).toBeTruthy()
    fireEvent.change(rowCells(1).getAllByRole('textbox')[1], {
      target: { value: 'Mukeshbhai Bhupatbhai Vatukiya' },
    })
    await waitFor(() => expect(rowCells(1).getByText('matched')).toBeTruthy())
    expect(screen.getByRole('button', { name: /Verify & Save 2 Records/ })).toBeTruthy()
  })

  it('does not auto-save a review row until Include is pressed', async () => {
    await openWithStatement()
    fireEvent.change(rowCells(1).getAllByRole('textbox')[0], {
      target: { value: '7489112502043449' },
    })
    await waitFor(() => expect(rowCells(1).getByText('review')).toBeTruthy())
    expect(screen.getByRole('button', { name: /Verify & Save 1 Record$/ })).toBeTruthy()
    fireEvent.click(rowCells(1).getByRole('button', { name: 'Include' }))
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

  it('does not silently overwrite a policy rate on Verify & Save', async () => {
    await openWithStatement({}, [
      {
        'Policy No.': '7489112502043449',
        'Insured Name': 'Mukeshbhai Bhupatbhai Vatukiya',
        Premium: 18797,
        'Total Comm': 1409,
        'Commission %': 7.5,
        'Fresh/Renewal': 'Renewal',
      },
    ])
    fireEvent.click(screen.getByRole('button', { name: /Verify & Save 1 Record$/ }))
    await waitFor(() => expect(addCommissionTransaction).toHaveBeenCalled())
    expect(updatePolicy).not.toHaveBeenCalled()
  })

  it('never posts a row with no matching policy', async () => {
    await openWithStatement({}, [SHEET[1]])
    expect(screen.getByRole('button', { name: /Verify & Save 0 Records/ }).disabled).toBe(true)
  })

  it('lets a human OK an ambiguous last-4 row and writes that commission now', async () => {
    parseImportFile.mockResolvedValue([{
      'Policy No.': '************2955',
      'Insured Name': 'ASHVINBHAI JITENDRABHAI BHATT',
      Premium: 750,
      'Total Comm': 127.12,
    }])
    const policies = [
      {
        id: 'a', policyNumber: 'P/2026/0002955', clientId: 'c1',
        clientName: 'Ashvinbhai Jitendrabhai Bhatt', insurer: 'Star Health', premium: 750,
      },
      {
        id: 'b', policyNumber: 'P/2026/1112955', clientId: 'c2',
        clientName: 'Another Ashvinbhai', insurer: 'Star Health', premium: 800,
      },
    ]
    render(
      <StatementImportModal
        open
        onClose={() => {}}
        policies={policies}
        user={{ uid: 'u1', email: 'owner@example.com' }}
        onPosted={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('Statement month *'), { target: { value: 'July' } })
    fireEvent.change(screen.getByLabelText('Year *'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Statement type *'), { target: { value: 'single' } })
    fireEvent.change(screen.getByLabelText('Carrier *'), { target: { value: 'Star Health' } })
    fireEvent.change(document.body.querySelector('input[type="file"]'), {
      target: { files: [new File(['x'], 'star-july.csv')] },
    })
    await screen.findByRole('button', { name: /OK · update this commission/ })
    expect(addCommissionTransaction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /OK · update this commission/ }))
    await waitFor(() => expect(addCommissionTransaction).toHaveBeenCalledTimes(1))
    expect(addCommissionTransaction).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'a',
      policyNumber: 'P/2026/0002955',
      receivedCommission: 127.12,
      payoutMonth: '2026-07',
    }))
  })

  it('shows Update structure only for a matched row with a statement rate', async () => {
    await openWithStatement({}, [{
      'Policy No.': '6305162700008293',
      'Insured Name': 'Harendra Varmora',
      Premium: 748,
      'Total Comm': 95,
      'Commission %': 12.71,
    }])
    expect(screen.getByRole('button', { name: 'Update structure only' })).toBeTruthy()
  })

  it('confirms then upserts commission_master from Update structure only', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await openWithStatement({}, [{
      'Policy No.': '6305162700008293',
      'Insured Name': 'Harendra Varmora',
      Premium: 748,
      'Total Comm': 95,
      'Commission %': 14,
    }])
    fireEvent.click(screen.getByRole('button', { name: 'Update structure only' }))
    await waitFor(() => expect(upsertCommissionMaster).toHaveBeenCalledTimes(1))
    expect(confirmSpy).toHaveBeenCalled()
    const proposal = upsertCommissionMaster.mock.calls[0][0]
    expect(proposal.payload.policyYear).toBe('FY')
    expect(proposal.payload.commissionPct).toBe(14)
    expect(proposal.payload.structureUpdated).toBe(true)
    expect(proposal.payload.sourceFileName).toBe('star-july.csv')
    expect(updatePolicy).toHaveBeenCalledWith('p1', expect.objectContaining({
      fyCommission: 14,
      structureUpdated: true,
      previousPct: 12.71,
      newPct: 14,
    }))
    confirmSpy.mockRestore()
  })

  it('OK commission + structure posts ledger with structure audit fields', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await openWithStatement({}, [{
      'Policy No.': '6305162700008293',
      'Insured Name': 'Harendra Varmora',
      Premium: 748,
      'Total Comm': 95,
      'Commission %': 13,
    }])
    fireEvent.click(screen.getByLabelText(/Also update commission structure/i))
    fireEvent.click(screen.getByRole('button', { name: /OK · commission \+ structure/ }))
    await waitFor(() => expect(addCommissionTransaction).toHaveBeenCalled())
    expect(upsertCommissionMaster).toHaveBeenCalled()
    expect(addCommissionTransaction).toHaveBeenCalledWith(expect.objectContaining({
      structureUpdated: true,
      newPct: 13,
      sourceFileName: 'star-july.csv',
    }))
    confirmSpy.mockRestore()
  })

  it('does not park commission on a same-name different policy — add as new instead', async () => {
    parseImportFile.mockResolvedValue([{
      'Policy No.': '************2955',
      'Insured Name': 'ASHVINBHAI JITENDRABHAI BHATT',
      Premium: 750,
      'Total Comm': 127.12,
    }])
    render(
      <StatementImportModal
        open
        onClose={() => {}}
        policies={[{
          id: 'old', policyNumber: '2845112600005923', clientId: 'c-ash',
          clientName: 'Ashvinbhai Jitendrabhai Bhatt', insurer: 'Star Health', premium: 11800,
        }]}
        clients={[{ id: 'c-ash', name: 'Ashvinbhai Jitendrabhai Bhatt' }]}
        user={{ uid: 'u1', email: 'owner@example.com' }}
        onPosted={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('Statement month *'), { target: { value: 'July' } })
    fireEvent.change(screen.getByLabelText('Year *'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Statement type *'), { target: { value: 'single' } })
    fireEvent.change(screen.getByLabelText('Carrier *'), { target: { value: 'Star Health' } })
    fireEvent.change(document.body.querySelector('input[type="file"]'), {
      target: { files: [new File(['x'], 'star-july.csv')] },
    })
    await screen.findByRole('button', { name: /Add policy & post commission/ })
    expect(screen.queryByRole('button', { name: /OK · update this commission/ })).toBeNull()
    expect(screen.getByText(/Do not put commission on their old number/)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/Type the full number/), {
      target: { value: 'P/2026/0002955' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Add policy & post commission/ }))
    await waitFor(() => expect(addPolicy).toHaveBeenCalledTimes(1))
    expect(addClient).not.toHaveBeenCalled()
    expect(addPolicy).toHaveBeenCalledWith(expect.objectContaining({
      policyNumber: 'P/2026/0002955',
      clientId: 'c-ash',
      premium: 750,
      insurer: 'Star Health',
    }))
    await waitFor(() => expect(addCommissionTransaction).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'new-pol',
      policyNumber: 'P/2026/0002955',
      receivedCommission: 127.12,
      payoutMonth: '2026-07',
    })))
  })
})
