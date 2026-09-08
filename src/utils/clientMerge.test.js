import { describe, it, expect } from 'vitest'
import { mobileDigits, completenessScore, duplicateClusters } from './clientMerge'

describe('mobileDigits', () => {
  it('keeps the last 10 digits through +91 and spaces', () => {
    expect(mobileDigits('+91 98254 04039')).toBe('9825404039')
    expect(mobileDigits('9825404039')).toBe('9825404039')
  })

  it('ignores short numbers', () => {
    expect(mobileDigits('12345')).toBe('')
  })
})

describe('duplicateClusters', () => {
  const ketans = [
    { id: 'a', name: 'Ketan B Patel', mobile: '9825404039' },
    { id: 'b', name: 'ketan Bhai', mobile: '+91 98254 04039' },
    { id: 'c', name: 'PATEL KETANKUMAR BATUKLAL', mobile: '9825404039', email: 'ketan@x.com', pan: 'ABCDE1234F' },
    { id: 'd', name: 'Patel Ketankumar Batuklal Karta', mobile: '9825404039' },
    { id: 'e', name: 'Navin Bhaskaran', mobile: '9000000001' },
  ]

  it('groups every Ketan with the same mobile into one cluster of 4', () => {
    const [cluster] = duplicateClusters(ketans)
    expect(cluster.members.map(m => m.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(cluster.mobile).toBe('9825404039')
    expect(cluster.members).toHaveLength(4)
  })

  it('suggests the most complete record as master', () => {
    const [cluster] = duplicateClusters(ketans)
    expect(cluster.suggestedMasterId).toBe('c')
  })

  it('skips already-merged records and lone mobiles', () => {
    const clients = [
      { id: 'a', name: 'A', mobile: '9825404039', mergedIntoClientId: 'z' },
      { id: 'b', name: 'B', mobile: '9825404039' },
      { id: 'c', name: 'C', mobile: '9000000001' },
    ]
    expect(duplicateClusters(clients)).toEqual([])
  })

  it('prefers the client who already has policies when fields are equal', () => {
    const [cluster] = duplicateClusters(
      [
        { id: 'thin', name: 'Ketan', mobile: '9825404039' },
        { id: 'fat', name: 'Ketan', mobile: '9825404039' },
      ],
      { fat: 3, thin: 0 },
    )
    expect(cluster.suggestedMasterId).toBe('fat')
  })
})

describe('completenessScore', () => {
  it('scores a filled Karta higher than a short nickname', () => {
    const karta = completenessScore({ name: 'PATEL KETANKUMAR BATUKLAL', mobile: '9825404039', email: 'a@b.com', pan: 'X' })
    const bhai = completenessScore({ name: 'ketan Bhai', mobile: '9825404039' })
    expect(karta).toBeGreaterThan(bhai)
  })
})
