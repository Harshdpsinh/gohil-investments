import { describe, expect, it } from 'vitest'
import { validateProvisionInput, provisionProfileFields } from './provisionUser.js'

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
