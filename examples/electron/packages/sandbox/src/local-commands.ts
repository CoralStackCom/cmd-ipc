import * as v from 'valibot'

import type {
  CommandSchemaMap,
  ICommandRegistry,
  InferCommandSchemaMapType,
} from '@coralstack/cmd-ipc'
import { defineIds } from '@coralstack/cmd-ipc'

import type { AppEventSchema } from '@examples/electron-core'
import { AppCommandSchema, CommandClient } from '@examples/electron-core'

/**
 * Local Commands for Sandboxed Process, must all start with an underscore to ensure
 * they are only available locally to the process that registered them.
 *
 * This shows an example of extending the command schema in a modular way so that
 * the local CommandClient can have strongly typed access to both the core application
 * commands as well as its own local commands.
 */

// Define sandbox-local commands
export const SandboxLocalCommands = {
  '_sandbox.log.url': {
    request: v.object({ url: v.string() }),
    description: 'Logs the URL to the Logger (Console)',
  },
} as const satisfies CommandSchemaMap

// Merged schema type
const _SandboxCommandSchema = {
  ...AppCommandSchema,
  ...SandboxLocalCommands,
} as const satisfies CommandSchemaMap

// Re-export CommandClient with extended types
export const SandboxClient = CommandClient as unknown as Omit<
  ICommandRegistry<typeof _SandboxCommandSchema, typeof AppEventSchema>,
  'registerChannel'
>

// Export IDs for local commands
export const SandboxLocalCommandIDs = defineIds(SandboxLocalCommands)

/**
 * Type helpers for Commands to extract request and response types on Handlers. As the `@Command` decorator
 * can't enforce type safety on its own, these helpers can be used to ensure that the correct types are used in
 * your command handlers and will produce type errors if the types do not match the schema.
 */
type SandboxLocalCommands = InferCommandSchemaMapType<typeof _SandboxCommandSchema>
export type SandboxCommandRequest<K extends keyof SandboxLocalCommands> =
  SandboxLocalCommands[K]['request']
export type SandboxCommandResponse<K extends keyof SandboxLocalCommands> = Promise<
  SandboxLocalCommands[K]['response']
>
