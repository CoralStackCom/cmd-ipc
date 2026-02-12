/* eslint-disable no-console */

/**
 * Release script - versions both packages, commits, and tags.
 *
 * Usage:
 *   yarn release <version>
 *   yarn release 1.0.0
 *   yarn release 1.2.0-beta.1
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const version = process.argv[2]

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error('Usage: yarn release <version>')
  console.error('  e.g. yarn release 1.0.0')
  process.exit(1)
}

const packages = ['packages/cmd-ipc/package.json', 'packages/cmd-ipc-mcp/package.json']

// Update version in each package
for (const pkgPath of packages) {
  const fullPath = resolve(pkgPath)
  const pkg = JSON.parse(readFileSync(fullPath, 'utf-8'))
  const oldVersion = pkg.version
  pkg.version = version
  writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`${pkgPath}: ${oldVersion} -> ${version}`)
}

// Stage, commit, and tag
execSync(`git add ${packages.join(' ')}`, { stdio: 'inherit' })
execSync(`git commit -m "v${version}"`, { stdio: 'inherit' })
execSync(`git tag v${version}`, { stdio: 'inherit' })

console.log(`\nTagged v${version}. Push with:\n  git push && git push origin v${version}`)
