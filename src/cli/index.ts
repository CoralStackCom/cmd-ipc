#!/usr/bin/env node
import { generateSchema } from './generate-schema'

interface CLIArgs {
  command: string
  host?: string
  output?: string
  prefix?: string
}

function parseArgs(args: string[]): CLIArgs {
  const result: CLIArgs = {
    command: args[0] || '',
  }

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    const nextArg = args[i + 1]

    switch (arg) {
      case '--host':
      case '-h':
        result.host = nextArg
        i++
        break
      case '--output':
      case '-o':
        result.output = nextArg
        i++
        break
      case '--prefix':
      case '-p':
        result.prefix = nextArg
        i++
        break
    }
  }

  return result
}

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.log(`
Usage: cmd-ipc <command> [options]

Commands:
  generate-schema    Generate TypeScript schemas from a remote server

Options for generate-schema:
  --host, -h         Host URL without trailing slash (e.g., https://api.example.com)
  --output, -o       Output file path (e.g., ./src/schemas/remote-commands.ts)
  --prefix, -p       Optional prefix for command IDs (e.g., 'cloud')

Examples:
  cmd-ipc generate-schema --host https://api.example.com --output ./src/schemas/cloud.ts
  cmd-ipc generate-schema -h https://api.example.com -o ./src/schemas/cloud.ts -p cloud
`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (
    !args.command ||
    args.command === 'help' ||
    args.command === '--help' ||
    args.command === '-h'
  ) {
    printUsage()
    process.exit(0)
  }

  switch (args.command) {
    case 'generate-schema': {
      const { host, output, prefix } = args

      if (!host) {
        // eslint-disable-next-line no-console
        console.error('Error: --host is required')
        printUsage()
        process.exit(1)
        return // TypeScript needs this for type narrowing
      }
      if (!output) {
        // eslint-disable-next-line no-console
        console.error('Error: --output is required')
        printUsage()
        process.exit(1)
        return // TypeScript needs this for type narrowing
      }

      try {
        await generateSchema({ host, output, prefix })
        // eslint-disable-next-line no-console
        console.log(`Schema generated successfully: ${output}`)
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error generating schema:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
      break
    }

    default:
      // eslint-disable-next-line no-console
      console.error(`Unknown command: ${args.command}`)
      printUsage()
      process.exit(1)
  }
}

main()
