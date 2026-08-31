import { describe, expect, it } from 'vitest'
import { validateProvisionInput, provisionProfileFields, existingLoginPasswordError, shouldFallBackToClientProvision, parseStaffAttachInput, staffWriteError } from './provisionUser.js'

describe('validateProvisionInput', () => {
  it('normalises a new staff account', () => {
    expect(validateProvisionInput({
      name: ' Priya ',
      email: 'Priya@Gmail.com',
      password: 'password1',
      role: 'STAFF',
    }, { passwordRequired: true })).toEqual({
      name: 'Priya',
      email: 'priya@gmail.com',
      role: 'staff',
      password: 'password1',
    })
  })

  it('allows attaching an existing login without a new password', () => {
    const result = validateProvisionInput({
      name: 'Reader',
      email: 'reader@gohil.test',
      role: 'reader',
    })
    expect(result.password).toBe('')
    expect(result.role).toBe('reader')
  })

  it('rejects a guest role', () => {
    expect(() => validateProvisionInput({
      name: 'X',
      email: 'x@gohil.test',
      role: 'guest',
    })).toThrow(/admin, staff or reader/)
  })

  it('requires a password only when creating a brand-new login', () => {
    expect(() => validateProvisionInput({
      name: 'X',
      email: 'x@gohil.test',
      role: 'staff',
    }, { passwordRequired: true })).toThrow(/8 characters/)
  })
})

describe('provisionProfileFields', () => {
  it('writes only the fields Firestore rules allow on users/{uid}', () => {
    expect(provisionProfileFields({
      name: 'Priya',
      email: 'priya@gmail.com',
      role: 'staff',
    })).toEqual({
      name: 'Priya',
      email: 'priya@gmail.com',
      role: 'staff',
    })
  })
})

describe('client provision fallback', () => {
  it('falls back when the server has no service account', () => {
    expect(shouldFallBackToClientProvision(false, 500)).toBe(true)
    expect(shouldFallBackToClientProvision(false, 404)).toBe(true)
    expect(shouldFallBackToClientProvision(true, 200)).toBe(false)
    expect(shouldFallBackToClientProvision(false, 403)).toBe(false)
  })

  it('tells the admin to type the existing password when attaching', () => {
    expect(existingLoginPasswordError('auth/invalid-credential')).toMatch(/already has a login/)
    expect(existingLoginPasswordError('auth/email-already-in-use')).toBe('')
  })
})

describe('parseStaffAttachInput', () => {
  it('fills name from the email when blank', () => {
    expect(parseStaffAttachInput({ email: 'Reader@Gmail.com', role: 'READER' })).toEqual({
      email: 'reader@gmail.com',
      name: 'reader',
      role: 'reader',
    })
  })

  it('rejects a guest role', () => {
    expect(() => parseStaffAttachInput({ email: 'a@b.com', role: 'guest' })).toThrow(/admin, staff or reader/)
  })
})

describe('staffWriteError', () => {
  it('tells the admin which login can write the staff row', () => {
    expect(staffWriteError('permission-denied')).toMatch(/harshdeepgohil@gmail.com/)
  })
})
