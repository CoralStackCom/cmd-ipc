import fs from 'node:fs'
import path from 'node:path'

/**
 * Walk up from the vitest CWD (the package root when run via `yarn conformance`)
 * until we find the repo-root `spec/` directory.
 */
function findSpecDir(): string {
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'spec')
    if (
      fs.existsSync(path.join(candidate, 'schemas')) &&
      fs.existsSync(path.join(candidate, 'conformance'))
    ) {
      return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`Could not locate spec/ directory above ${process.cwd()}`)
}

export const SPEC_DIR = findSpecDir()
export const ENCODING_DIR = path.join(SPEC_DIR, 'conformance', 'encoding')
export const BEHAVIOR_DIR = path.join(SPEC_DIR, 'conformance', 'behavior')

export function listVectors(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f))
    .sort()
}

export function readJson<T = unknown>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}
