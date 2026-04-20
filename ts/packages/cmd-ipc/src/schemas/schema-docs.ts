import type { ICommandDefinitionBase, IListCommandDefinition } from '../registry'

/**
 * Schema Documentation Type
 */
export type SchemaDoc = {
  /**
   * Schema version
   * @default "1.0.0"
   */
  cmdschema: string
  /**
   * Array of Command definitions
   */
  commands: ICommandDefinitionBase[]
}

/**
 * Creates and publishes schema documentation for a Command Registry that can be published at GET /.cmds.json
 * on an HTTP server for the CLI to generate a local TypeScript schema for typing command calls to the server.
 *
 * Will only publish public commands (those without `private: true` in their definition).
 *
 * @param commands - Array of Command definitions from the registry
 */
export function publishSchemaDoc(commands: readonly IListCommandDefinition[]): SchemaDoc {
  const publicCommands = commands
    .filter((cmd) => cmd.isLocal && !cmd.isPrivate)
    .map((def) => ({
      id: def.id,
      description: def.description,
      schema: def.schema,
    }))

  return {
    cmdschema: '1.0.0',
    commands: publicCommands,
  }
}
