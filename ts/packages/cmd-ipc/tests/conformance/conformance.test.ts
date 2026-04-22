import path from 'node:path'

import { loadBehaviorVectors, runBehaviorVector } from './behavior-harness'
import { loadEncodingCases } from './encoding-harness'

describe('spec/conformance/encoding', () => {
  for (const c of loadEncodingCases()) {
    const name = `${path.basename(c.file)} — ${c.vector.description}`
    test(name, () => {
      c.run()
    })
  }
})

describe('spec/conformance/behavior', () => {
  for (const { file, vector } of loadBehaviorVectors()) {
    const name = `${path.basename(file)} — ${vector.description}`
    test(name, async () => {
      const result = await runBehaviorVector(vector)
      if (!result.ok) throw new Error(result.error)
    })
  }
})
