// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import CommissionReviewDrawer from './CommissionReviewDrawer'
import { addManualCommission, updateCommissionTransaction } from '../../firebase/commissionOps'

vi.mock('../../firebase/commissionOps', () => ({
  addManualCommission: vi.fn(async () => ({ id: 'new' })),
  updateCommissionTransaction: vi.fn(async () => {}),
}))
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const ROW = {
  policyId: 'p1',
  policyNumber: '63051627000082',
  clientName: 'Asha Shah',
  insurer: 'Star Health',
  status: 'short',
  expected: 1500,
  received: 900,
  difference: -600,
  premium: 10000,
  tds: 0,
}

const POLICY = {
  id: 'p1',
  policyNumber: '63051627000082',
  clientName: 'Asha Shah',
  insurer: 'Star Health',
  premium: 10000,
  fyCommission: 15,
  policyYear: 1,
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CommissionReviewDrawer', () => {
  it('says this commission needs an update and does not write until the side button is pressed', () => {
    render(
      <CommissionReviewDrawer
        open
        row={ROW}
        policy={POLICY}
        existing={{ id: 't1', netReceived: 900, tds: 0, payoutMonth: '2026-07' }}
        user={{ uid: 'u1' }}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('This commission needs an update')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update this commission' })).toBeTruthy()
    expect(updateCommissionTransaction).not.toHaveBeenCalled()
    expect(addManualCommission).not.toHaveBeenCalled()
  })

  it('saves edits to the posted row when Update this commission is pressed', async () => {
    const onPosted = vi.fn()
    const onClose = vi.fn()
    render(
      <CommissionReviewDrawer
        open
        row={ROW}
        policy={POLICY}
        existing={{ id: 't1', netReceived: 900, tds: 0, payoutMonth: '2026-07' }}
        user={{ uid: 'u1' }}
        onClose={onClose}
        onPosted={onPosted}
      />,
    )
    fireEvent.change(screen.getByLabelText('Received ₹ *'), { target: { value: '1500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update this commission' }))
    await waitFor(() => expect(updateCommissionTransaction).toHaveBeenCalledTimes(1))
    expect(updateCommissionTransaction).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        receivedCommission: 1500,
        netReceived: 1500,
        expectedCommission: 1500,
        difference: 0,
        payoutMonth: '2026-07',
      }),
    )
    expect(addManualCommission).not.toHaveBeenCalled()
    await waitFor(() => expect(onPosted).toHaveBeenCalled())
  })

  it('posts a new row when nothing has been saved yet', async () => {
    render(
      <CommissionReviewDrawer
        open
        row={{ ...ROW, status: 'awaited', received: 0, difference: -1500 }}
        policy={POLICY}
        existing={null}
        user={{ uid: 'u1', email: 'owner@example.com' }}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Save this commission' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save this commission' }))
    await waitFor(() => expect(addManualCommission).toHaveBeenCalledTimes(1))
    expect(updateCommissionTransaction).not.toHaveBeenCalled()
  })
})
