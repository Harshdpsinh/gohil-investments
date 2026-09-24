// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CopyButton from './CopyButton'

afterEach(cleanup)

describe('CopyButton', () => {
  it('copies the value and confirms it', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    render(<CopyButton value="6305162700008293" label="Copy policy number" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy policy number' }))
    expect(writeText).toHaveBeenCalledWith('6305162700008293')
    expect(await screen.findByRole('button', { name: 'Copy policy number copied' })).toBeTruthy()
    expect(screen.getByText('Copied')).toBeTruthy()
  })

  it('renders nothing when there is nothing to copy', () => {
    const { container } = render(<CopyButton value="  " />)
    expect(container.querySelector('button')).toBeNull()
  })
})
