import 'reflect-metadata'

import { CommandRegistry as BaseCommandRegistry, registerCommands } from '@coralstack/cmd-ipc'

import { CalcService } from './calc-service'
import { CommandSchema } from './command-schema'

/**
 * Command Registry Instance
 */
export const CommandRegistry = new BaseCommandRegistry({
  id: 'agent-mcp-command-registry',
  schemas: {
    commands: CommandSchema,
  },
})

// Register all commands defined in the CommandSchema
registerCommands([CalcService], CommandRegistry)
