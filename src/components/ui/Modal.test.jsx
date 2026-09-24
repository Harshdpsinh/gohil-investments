// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Modal from './Modal'

afterEach(cleanup)

describe('Modal', () => {
  it('names the dialog and closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Confirm delete">
        <button type="button">Keep</button>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Confirm delete' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps Tab inside the dialog', () => {
    render(
      <Modal open onClose={() => {}} title="Edit">
        <button type="button">Cancel</button>
        <button type="button">Save</button>
      </Modal>,
    )
    const close = screen.getByRole('button', { name: 'Close modal' })
    const save = screen.getByRole('button', { name: 'Save' })
    save.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(save)
  })

  it('does not steal focus when the parent re-renders', () => {
    function Harness() {
      const [n, setN] = useState(0)
      return (
        <Modal open onClose={() => {}} title={`Edit ${n}`}>
          <input aria-label="Client name" onChange={() => setN(count => count + 1)} />
        </Modal>
      )
    }
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: 'Client name' })
    input.focus()
    fireEvent.change(input, { target: { value: 'Asha' } })
    expect(document.activeElement).toBe(input)
  })
})
