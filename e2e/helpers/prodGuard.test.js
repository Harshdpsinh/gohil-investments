import { describe, it, expect } from 'vitest'
import {
  evaluateProdGuard,
  assertE2EProdGuard,
  canRunWriteE2E,
  canRunAuthenticatedE2E,
  PRODUCTION_PROJECT_IDS,
} from './prodGuard.js'

describe('E2E production guard', () => {
  it('lists the production project id', () => {
    expect(PRODUCTION_PROJECT_IDS).toContain('gohil-investments')
  })

  it('blocks production project without E2E_ALLOW_PROD', () => {
    const result = evaluateProdGuard({
      VITE_FIREBASE_PROJECT_ID: 'gohil-investments',
      E2E_ALLOW_PROD: '0',
    })
    expect(result.blocked).toBe(true)
    expect(result.isProduction).toBe(true)
    expect(() =>
      assertE2EProdGuard({
        VITE_FIREBASE_PROJECT_ID: 'gohil-investments',
      }),
    ).toThrow(/refused to start/i)
  })

  it('allows production when E2E_ALLOW_PROD=1', () => {
    const result = evaluateProdGuard({
      VITE_FIREBASE_PROJECT_ID: 'gohil-investments',
      E2E_ALLOW_PROD: '1',
    })
    expect(result.blocked).toBe(false)
    expect(result.allowProd).toBe(true)
  })

  it('allows staging project ids without allow flag', () => {
    const result = evaluateProdGuard({
      VITE_FIREBASE_PROJECT_ID: 'gohil-investments-staging',
    })
    expect(result.blocked).toBe(false)
    expect(result.isProduction).toBe(false)
  })

  it('allows when project id is unset (preview build may omit it)', () => {
    const result = evaluateProdGuard({})
    expect(result.blocked).toBe(false)
  })

  it('gates write E2E on credentials and allow flag', () => {
    expect(
      canRunWriteE2E({
        VITE_FIREBASE_PROJECT_ID: 'gohil-investments',
        E2E_USER: 'a@b.com',
        E2E_PASS: 'x',
      }),
    ).toBe(false)

    expect(
      canRunWriteE2E({
        VITE_FIREBASE_PROJECT_ID: 'gohil-investments',
        E2E_ALLOW_PROD: '1',
        E2E_USER: 'a@b.com',
        E2E_PASS: 'x',
      }),
    ).toBe(true)

    expect(
      canRunWriteE2E({
        VITE_FIREBASE_PROJECT_ID: 'gohil-investments-staging',
        E2E_USER: 'a@b.com',
        E2E_PASS: 'x',
      }),
    ).toBe(true)
  })

  it('gates authenticated E2E on credentials', () => {
    expect(canRunAuthenticatedE2E({})).toBe(false)
    expect(
      canRunAuthenticatedE2E({
        E2E_USER: 'a@b.com',
        E2E_PASS: 'x',
      }),
    ).toBe(true)
  })
})
