import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// Vercel functions run as real Node ESM, which requires a file extension on
// every relative import. Vite does not, so an extensionless import builds
// cleanly, passes every test, deploys — and then the function dies at load with
// ERR_MODULE_NOT_FOUND the first time Meta calls it.
//
// This walks out from api/ through everything it actually imports and fails on
// any relative specifier without an extension. It caught nothing at the time it
// was written only because the bug it describes had just been fixed by hand.
const ROOT = resolve(__dirname, '../..')
const RELATIVE_IMPORT = /(?:from|import)\s*\(?\s*['"](\.[^'"]*)['"]/g

function collectServerModules() {
  const seen = new Set()
  const queue = readdirSync(join(ROOT, 'api'))
    .filter(name => name.endsWith('.js'))
    .map(name => join(ROOT, 'api', name))

  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)

    const source = readFileSync(file, 'utf8')
    for (const [, specifier] of source.matchAll(RELATIVE_IMPORT)) {
      if (!specifier.endsWith('.js')) continue // reported separately below
      queue.push(resolve(dirname(file), specifier))
    }
  }
  return [...seen]
}

describe('server module imports', () => {
  const modules = collectServerModules()

  it('finds the api entry points', () => {
    expect(modules.some(f => f.includes('renewal-reminders'))).toBe(true)
    expect(modules.some(f => f.includes('whatsapp-webhook'))).toBe(true)
  })

  it('gives every relative import an explicit .js extension', () => {
    const offenders = []
    for (const file of modules) {
      const source = readFileSync(file, 'utf8')
      for (const [, specifier] of source.matchAll(RELATIVE_IMPORT)) {
        if (!specifier.endsWith('.js')) {
          offenders.push(`${file.replace(ROOT, '').replace(/\\/g, '/')} imports "${specifier}"`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
