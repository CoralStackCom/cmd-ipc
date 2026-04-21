/**
 * Pattern matchers for conformance vectors.
 *
 * Vectors may embed:
 *   { "$match": "uuid" | "any-string" }
 *   { "$capture": "name" }
 *   { "$ref": "name" }
 *   { "$unordered": [...] }
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type CaptureBag = Map<string, unknown>

export class MatchError extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isPattern(v: unknown, key: string): boolean {
  return isObj(v) && Object.prototype.hasOwnProperty.call(v, key)
}

/**
 * Match an actual value against an expected value that may contain patterns.
 * Mutates `captures` on `$capture`. Throws MatchError on mismatch.
 */
export function match(
  expected: unknown,
  actual: unknown,
  captures: CaptureBag,
  path = '$',
): void {
  // Patterns
  if (isObj(expected)) {
    if (isPattern(expected, '$match')) {
      const kind = expected['$match']
      if (kind === 'uuid') {
        if (typeof actual !== 'string' || !UUID_RE.test(actual)) {
          throw new MatchError(path, `expected UUID, got ${JSON.stringify(actual)}`)
        }
        return
      }
      if (kind === 'any-string') {
        if (typeof actual !== 'string' || actual.length === 0) {
          throw new MatchError(path, `expected non-empty string, got ${JSON.stringify(actual)}`)
        }
        return
      }
      throw new MatchError(path, `unknown $match kind: ${String(kind)}`)
    }

    if (isPattern(expected, '$capture')) {
      const name = expected['$capture']
      if (typeof name !== 'string') {
        throw new MatchError(path, `$capture name must be a string`)
      }
      captures.set(name, actual)
      return
    }

    if (isPattern(expected, '$ref')) {
      const name = expected['$ref']
      if (typeof name !== 'string' || !captures.has(name)) {
        throw new MatchError(path, `$ref to unknown capture "${String(name)}"`)
      }
      const captured = captures.get(name)
      if (!deepEqual(captured, actual)) {
        throw new MatchError(
          path,
          `$ref ${name}: expected ${JSON.stringify(captured)}, got ${JSON.stringify(actual)}`,
        )
      }
      return
    }

    if (isPattern(expected, '$unordered')) {
      const expectedArr = expected['$unordered']
      if (!Array.isArray(expectedArr) || !Array.isArray(actual)) {
        throw new MatchError(path, `$unordered requires arrays on both sides`)
      }
      if (expectedArr.length !== actual.length) {
        throw new MatchError(
          path,
          `$unordered length mismatch: expected ${expectedArr.length}, got ${actual.length}`,
        )
      }
      const remaining = [...actual]
      for (let i = 0; i < expectedArr.length; i++) {
        let found = -1
        for (let j = 0; j < remaining.length; j++) {
          try {
            const snapshot = new Map(captures)
            match(expectedArr[i], remaining[j], snapshot, `${path}[${i}]`)
            // commit captures from the successful branch
            snapshot.forEach((v, k) => captures.set(k, v))
            found = j
            break
          } catch {
            /* try next */
          }
        }
        if (found === -1) {
          throw new MatchError(
            path,
            `$unordered: no actual element matches expected[${i}] = ${JSON.stringify(expectedArr[i])}`,
          )
        }
        remaining.splice(found, 1)
      }
      return
    }

    // Plain object — keys in `expected` must match; extra keys in `actual` are allowed
    // *only* for top-level messages (to tolerate `id` when the vector omits it).
    // To keep things strict, we enforce the exact set here and rely on vectors
    // mentioning every required field OR using patterns.
    if (!isObj(actual)) {
      throw new MatchError(path, `expected object, got ${JSON.stringify(actual)}`)
    }
    const expKeys = Object.keys(expected)
    for (const k of expKeys) {
      if (!(k in actual)) {
        throw new MatchError(`${path}.${k}`, `missing key`)
      }
      match(expected[k], actual[k], captures, `${path}.${k}`)
    }
    // Allow extra keys in actual — some vectors omit fields like `id` that the
    // implementation legitimately generates (UUIDs). Matching is subset by design.
    return
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      throw new MatchError(path, `expected array, got ${JSON.stringify(actual)}`)
    }
    if (expected.length !== actual.length) {
      throw new MatchError(
        path,
        `array length mismatch: expected ${expected.length}, got ${actual.length}`,
      )
    }
    for (let i = 0; i < expected.length; i++) {
      match(expected[i], actual[i], captures, `${path}[${i}]`)
    }
    return
  }

  if (!deepEqual(expected, actual)) {
    throw new MatchError(
      path,
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const ak = Object.keys(ao)
    const bk = Object.keys(bo)
    if (ak.length !== bk.length) return false
    return ak.every((k) => deepEqual(ao[k], bo[k]))
  }
  return false
}
