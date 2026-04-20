import * as v from 'valibot'

import type { CommandSchemaMap, InferCommandSchemaMapType } from './command-schema'
import { defineIds } from './schema-utils'

describe('Command Schemas', () => {
  it('should work', async () => {
    const CommandSchema = {
      'sample.command': {
        request: v.object({
          id: v.pipe(v.string(), v.description('The unique identifier for the command request')),
        }),
        response: v.object({ success: v.boolean() }),
        description: 'A sample command',
      },
    } as const satisfies CommandSchemaMap

    const CommandIDs = defineIds(CommandSchema)
    expect(CommandIDs).toEqual({ SAMPLE_COMMAND: 'sample.command' })

    // Inferred command types
    type _InferredCommandTypes = InferCommandSchemaMapType<typeof CommandSchema>
  })

  it('should throw type errors for invalid command definitions', async () => {
    const _InvalidCommandSchema = {
      'duplicate.command': {
        request: v.object({}),
        response: v.object({}),
      },
      // @ts-expect-error - Duplicate command IDs should cause a type error
      'duplicate.command': {
        request: v.object({}),
        response: v.object({}),
      },
    } as const satisfies CommandSchemaMap

    const _InvalidCommandSchema4 = {
      'duplicate.command': {
        // @ts-expect-error - Not using valibot schema should cause a type error
        response: v.void(),
        // @ts-expect-error - Not using valibot schema should cause a type error
        request: 'invalid schema',
      },
    } as const satisfies CommandSchemaMap
  })
})
