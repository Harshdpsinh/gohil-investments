// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import SearchableSelect, { filterOptions, toClientOptions } from './SearchableSelect'

afterEach(cleanup)

const OPTIONS = [
  { value: 'a', label: 'ANKIT ARVIND SHAH', hint: '7977865077' },
  { value: 'b', label: 'Navin Bhaskaran', hint: '9000000001' },
  { value: 'c', label: 'CHAUHAN SRUSHTI' },
]

describe('filterOptions', () => {
  it('matches name case-insensitively', () => {
    expect(filterOptions(OPTIONS, 'ankit').map(o => o.value)).toEqual(['a'])
  })

  it('matches a mobile hint', () => {
    expect(filterOptions(OPTIONS, '79778').map(o => o.value)).toEqual(['a'])
  })

  it('returns the full list when the query is blank', () => {
    expect(filterOptions(OPTIONS, '')).toHaveLength(3)
  })
})

describe('toClientOptions', () => {
  it('maps id, name and mobile', () => {
    expect(toClientOptions([{ id: 'c1', name: 'Ankit', mobile: '99' }])).toEqual([
      { value: 'c1', label: 'Ankit', hint: '99' },
    ])
  })
})

describe('SearchableSelect', () => {
  it('lets you type a name and pick the match', () => {
    const onChange = vi.fn()
    render(<SearchableSelect options={OPTIONS} value="" onChange={onChange} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'ankit' } })
    fireEvent.click(screen.getByRole('button', { name: /ANKIT ARVIND SHAH/ }))
    expect(onChange).toHaveBeenCalledWith('a', OPTIONS[0])
  })

  it('shows the selected label when closed', () => {
    render(<SearchableSelect options={OPTIONS} value="a" onChange={() => {}} />)
    expect(screen.getByRole('combobox').value).toBe('ANKIT ARVIND SHAH')
  })

  it('picks the first match on Enter', () => {
    const onChange = vi.fn()
    render(<SearchableSelect options={OPTIONS} value="" onChange={onChange} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'chauhan' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('c', OPTIONS[2])
  })
})
