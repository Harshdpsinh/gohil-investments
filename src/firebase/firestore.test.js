import { describe, it, expect, vi } from 'vitest'

// Firebase is replaced wholesale. Nothing in this file can open a network
// connection or read/write a real Firestore document.
vi.mock('./config', () => ({ db: {}, auth: {}, firebaseConfig: {}, default: {} }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), addDoc: vi.fn(), getDoc: vi.fn(),
  getDocs: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), query: vi.fn(),
  where: vi.fn(), orderBy: vi.fn(), serverTimestamp: vi.fn(() => 'SERVER_TS'),
  onSnapshot: vi.fn(), writeBatch: vi.fn(), setDoc: vi.fn(), limit: vi.fn(),
  runTransaction: vi.fn(), Timestamp: class {}, startAfter: vi.fn(),
}))

const {
  normalisePolicyPayload,
  assertPolicyDateOrder,
  cleanFirestoreData,
  exactPolicyKey,
  policyIsActive,
} = await import('./firestore')

const validPolicy = () => ({
  policyNumber: 'POL-001',
  clientId: 'client-1',
  insurer: 'HDFC ERGO',
})

describe('normalisePolicyPayload', () => {
  describe('required fields (full save)', () => {
    it('accepts a minimal valid policy', () => {
      expect(() => normalisePolicyPayload(validPolicy())).not.toThrow()
    })

    it('rejects a missing policy number', () => {
      const policy = { ...validPolicy(), policyNumber: '' }
      expect(() => normalisePolicyPayload(policy)).toThrow(/Policy number is required/)
    })

    it('rejects a policy number over 80 characters', () => {
      const policy = { ...validPolicy(), policyNumber: 'X'.repeat(81) }
      expect(() => normalisePolicyPayload(policy)).toThrow(/80 characters or less/)
    })

    it('rejects a missing client', () => {
      const policy = { ...validPolicy(), clientId: '' }
      expect(() => normalisePolicyPayload(policy)).toThrow(/Client is required/)
    })

    it('rejects a missing insurer', () => {
      const policy = { ...validPolicy(), insurer: '' }
      expect(() => normalisePolicyPayload(policy)).toThrow(/Insurer is required/)
    })
  })

  describe('defaults', () => {
    it('applies Health / Active / Yearly when not supplied', () => {
      const result = normalisePolicyPayload(validPolicy())
      expect(result.policyType).toBe('Health')
      expect(result.status).toBe('Active')
      expect(result.frequency).toBe('Yearly')
    })

    it('does not invent defaults on a partial update', () => {
      const result = normalisePolicyPayload({ notes: 'call back' }, { partial: true })
      expect(result).not.toHaveProperty('policyType')
      expect(result).not.toHaveProperty('status')
      expect(result).not.toHaveProperty('frequency')
    })
  })

  describe('system fields', () => {
    it('strips fields the caller must never set directly', () => {
      const result = normalisePolicyPayload({
        ...validPolicy(),
        id: 'abc',
        createdAt: 'x',
        updatedAt: 'y',
        deleted: true,
        deletedAt: 'z',
        renewedAt: 'w',
      })
      for (const field of ['id', 'createdAt', 'updatedAt', 'deleted', 'deletedAt', 'renewedAt']) {
        expect(result).not.toHaveProperty(field)
      }
    })

    it('drops undefined values so Firestore does not reject the write', () => {
      const result = normalisePolicyPayload({ ...validPolicy(), planName: undefined })
      expect(result).not.toHaveProperty('planName')
    })
  })

  describe('enumerated values', () => {
    it('rejects an unknown policy type', () => {
      const policy = { ...validPolicy(), policyType: 'Spaceship' }
      expect(() => normalisePolicyPayload(policy)).toThrow(/Policy type must be one of/)
    })

    it('rejects an unknown status', () => {
      const policy = { ...validPolicy(), status: 'Pending' }
      expect(() => normalisePolicyPayload(policy)).toThrow(/Policy status must be one of/)
    })

    it.each([
      ['half yearly', 'Half-Yearly'],
      ['HLY', 'Half-Yearly'],
      ['qtly', 'Quarterly'],
      ['3 month', 'Quarterly'],
      ['mly', 'Monthly'],
      ['annual', 'Yearly'],
      ['single premium', 'Yearly'],
      ['total gibberish', 'Yearly'],
    ])('normalises frequency %s to %s', (input, expected) => {
      const result = normalisePolicyPayload({ ...validPolicy(), frequency: input })
      expect(result.frequency).toBe(expected)
    })
  })

  describe('numeric bounds', () => {
    it('rejects a zero premium', () => {
      expect(() => normalisePolicyPayload({ ...validPolicy(), premium: 0 }))
        .toThrow(/Premium must be between/)
    })

    it('allows an empty premium', () => {
      expect(() => normalisePolicyPayload({ ...validPolicy(), premium: '' })).not.toThrow()
    })

    it.each(['fyCommission', 'ryCommission'])('rejects %s above 100', field => {
      expect(() => normalisePolicyPayload({ ...validPolicy(), [field]: 101 }))
        .toThrow(/must be between 0 and 100/)
    })

    it('rejects a non-numeric premium', () => {
      expect(() => normalisePolicyPayload({ ...validPolicy(), premium: 'lots' }))
        .toThrow(/Premium must be between/)
    })
  })

  describe('coverage term', () => {
    it('marks a multi-year policy when the term is over 1 year', () => {
      const result = normalisePolicyPayload({ ...validPolicy(), coverageTermYears: 3 })
      expect(result.coverageTermYears).toBe(3)
      expect(result.isMultiYearPolicy).toBe(true)
    })

    it('clears the multi-year flag for a 1 year term', () => {
      const result = normalisePolicyPayload({
        ...validPolicy(), coverageTermYears: 1, isMultiYearPolicy: true,
      })
      expect(result.isMultiYearPolicy).toBe(false)
    })

    it.each([0, 6, 2.5])('rejects an out-of-range term: %s', years => {
      expect(() => normalisePolicyPayload({ ...validPolicy(), coverageTermYears: years }))
        .toThrow(/between 1 and 5 years/)
    })
  })

  describe('contact details', () => {
    it('lowercases and trims the email', () => {
      const result = normalisePolicyPayload({ ...validPolicy(), clientEmail: '  Foo@Bar.COM ' })
      expect(result.clientEmail).toBe('foo@bar.com')
    })

    it('rejects a malformed email', () => {
      expect(() => normalisePolicyPayload({ ...validPolicy(), clientEmail: 'not-an-email' }))
        .toThrow(/Email address is not valid/)
    })

    it('accepts a mobile with spaces', () => {
      const result = normalisePolicyPayload({ ...validPolicy(), clientMobile: '98765 43210' })
      expect(result.clientMobile).toBe('98765 43210')
    })

    it('rejects a mobile with too few digits', () => {
      expect(() => normalisePolicyPayload({ ...validPolicy(), clientMobile: '12345' }))
        .toThrow(/10 to 15 digits/)
    })
  })

  describe('text tidying', () => {
    it('uppercases the vehicle registration number', () => {
      const result = normalisePolicyPayload({ ...validPolicy(), registrationNo: ' gj04ab1234 ' })
      expect(result.registrationNo).toBe('GJ04AB1234')
    })

    it('trims free-text fields', () => {
      const result = normalisePolicyPayload({ ...validPolicy(), nominee: '  Priya  ' })
      expect(result.nominee).toBe('Priya')
    })
  })

  describe('dates', () => {
    it('rejects an unparseable start date', () => {
      expect(() => normalisePolicyPayload({ ...validPolicy(), startDate: 'not a date' }))
        .toThrow(/Start date must be a valid date/)
    })

    it('accepts an ISO start date', () => {
      expect(() => normalisePolicyPayload({ ...validPolicy(), startDate: '2026-01-01' }))
        .not.toThrow()
    })
  })
})

describe('assertPolicyDateOrder', () => {
  it('requires a start date', () => {
    expect(() => assertPolicyDateOrder('', '2026-01-01')).toThrow(/Start date is required/)
  })

  it('requires an expiry date', () => {
    expect(() => assertPolicyDateOrder('2026-01-01', '')).toThrow(/Expiry date is required/)
  })

  it('rejects an expiry before the start', () => {
    expect(() => assertPolicyDateOrder('2026-06-01', '2026-01-01'))
      .toThrow(/Expiry date must be after start date/)
  })

  it('rejects an expiry equal to the start', () => {
    expect(() => assertPolicyDateOrder('2026-01-01', '2026-01-01'))
      .toThrow(/Expiry date must be after start date/)
  })

  it('accepts a valid range', () => {
    expect(() => assertPolicyDateOrder('2026-01-01', '2027-01-01')).not.toThrow()
  })
})

describe('cleanFirestoreData', () => {
  it('removes undefined values but keeps null and empty string', () => {
    expect(cleanFirestoreData({ a: 1, b: undefined, c: null, d: '' }))
      .toEqual({ a: 1, c: null, d: '' })
  })
})

describe('exactPolicyKey', () => {
  it('ignores key ordering', () => {
    expect(exactPolicyKey({ a: 1, b: 2 })).toBe(exactPolicyKey({ b: 2, a: 1 }))
  })

  it('ignores system fields, so a re-save is not a new policy', () => {
    const base = { policyNumber: 'P1', premium: 500 }
    expect(exactPolicyKey({ ...base, id: 'x', createdAt: 'then' })).toBe(exactPolicyKey(base))
  })

  it('changes when a real field changes', () => {
    expect(exactPolicyKey({ premium: 500 })).not.toBe(exactPolicyKey({ premium: 600 }))
  })

  it('normalises Firestore timestamps to a comparable form', () => {
    const stamp = { toDate: () => new Date('2026-01-01T00:00:00.000Z') }
    expect(exactPolicyKey({ when: stamp })).toBe(
      exactPolicyKey({ when: { toDate: () => new Date('2026-01-01T00:00:00.000Z') } })
    )
  })
})

describe('policyIsActive', () => {
  it.each(['Active', '', undefined, 'Lapsed'])('treats %s as active', status => {
    expect(policyIsActive({ status })).toBe(true)
  })

  it.each(['Renewed-Out', 'Cancelled', 'Matured'])('treats %s as inactive', status => {
    expect(policyIsActive({ status })).toBe(false)
  })
})
