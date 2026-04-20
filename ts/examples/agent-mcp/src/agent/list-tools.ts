import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { CommandIDType } from '@coralstack/cmd-ipc'
import { CommandRegistry } from '../commands/command-registry'
import type { CommandSchema } from '../commands/command-schema'

/**
 * Lists all available AI tools for the agent to use.
 *
 * @returns ToolSet - An object containing all available tools.
 */
export function listTools(): ToolSet {
  const commands = CommandRegistry.listCommands()

  const tools: ToolSet = {}
  for (const command of commands) {
    tools[command.id] = {
      description: command.description,
      inputSchema: command.schema?.request
        ? z.fromJSONSchema(command.schema.request as any)
        : z.unknown(),
      outputSchema: command.schema?.response
        ? z.fromJSONSchema(command.schema.response as any)
        : z.unknown(),
      execute: async (input: any) => {
        return await CommandRegistry.executeCommand(
          command.id as CommandIDType<typeof CommandSchema>,
          input as any,
        )
      },
    }
  }

  return tools
}
