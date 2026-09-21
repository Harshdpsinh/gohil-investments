// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PolicyPdfUpload from './PolicyPdfUpload'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../firebase/firestore', () => ({ savePolicyPdfUrl: vi.fn() }))
vi.mock('../../firebase/storage', () => ({
  deletePolicyPdfAsset: vi.fn(),
  downloadDocumentFile: vi.fn(),
  openDocumentPreview: vi.fn(),
  uploadPolicyPdf: vi.fn(),
}))

describe('PolicyPdfUpload', () => {
  it('lets a new policy hold a PDF on the same form instead of blocking until save', () => {
    const onHold = vi.fn()
    const { container } = render(<PolicyPdfUpload onHold={onHold} />)
    expect(screen.getByText(/Pick the schedule on this screen/i)).toBeTruthy()
    const input = container.querySelector('input[type="file"]')
    const file = new File(['%PDF'], 'star-health.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onHold).toHaveBeenCalledWith(file)
    expect(screen.getByText('star-health.pdf')).toBeTruthy()
  })
})
