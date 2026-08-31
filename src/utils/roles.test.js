import { describe, expect, it } from 'vitest'
import {
  VALID_ROLES,
  normaliseRole,
  isWriteRole,
  isReadRole,
  roleLabel,
} from './roles.js'

describe('roles', () => {
  it('treats reader as a valid provisioned role', () => {
    expect(VALID_ROLES).toContain('reader')
    expect(normaliseRole('reader')).toBe('reader')
    expect(normaliseRole('READER')).toBe('reader')
  })

  it('forces owner emails to admin even if the profile says reader', () => {
    expect(normaliseRole('reader', 'harshdeepgohil@gmail.com')).toBe('admin')
    expect(normaliseRole('staff', 'harshdpsinh@gmail.com')).toBe('admin')
  })

  it('does not invent a role for an unsigned-in or unknown profile', () => {
    expect(normaliseRole('')).toBe('')
    expect(normaliseRole('guest')).toBe('')
    expect(normaliseRole('tester')).toBe('')
  })

  it('lets readers see data but never write it', () => {
    expect(isReadRole('reader')).toBe(true)
    expect(isWriteRole('reader')).toBe(false)
    expect(isWriteRole('staff')).toBe(true)
    expect(isWriteRole('admin')).toBe(true)
    expect(isReadRole('')).toBe(false)
  })

  it('labels reader distinctly from staff', () => {
    expect(roleLabel('reader')).toBe('Reader')
    expect(roleLabel('staff')).toBe('Staff')
  })
})