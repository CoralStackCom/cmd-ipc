import * as v from 'valibot'

import { CommandMessageSchema, MessageType } from '../../src/registry/command-message-schemas'
import { deepEqual } from './matchers'
import { ENCODING_DIR, listVectors, readJson } from './spec-paths'

export type EncodingVector = {
  description: string
  schema: string
  message: unknown
  json: string
}

/**
 * Map the vector's schema filename to the `type` discriminator of the
 * corresponding variant. We validate every message against the full valibot
 * `CommandMessageSchema` union (discriminated by `type`), which is equivalent
 * to validating the specific variant — a successful parse implies conformance
 * to whichever schema file matches the `type` field. We additionally cross-
 * check the filename so a vector can't claim one schema while encoding another.
 */
const SCHEMA_FILE_TO_TYPE: Record<string, MessageType> = {
  'register.command.request.json': MessageType.REGISTER_COMMAND_REQUEST,
  'register.command.response.json': MessageType.REGISTER_COMMAND_RESPONSE,
  'list.commands.request.json': MessageType.LIST_COMMANDS_REQUEST,
  'list.commands.response.json': MessageType.LIST_COMMANDS_RESPONSE,
  'execute.command.request.json': MessageType.EXECUTE_COMMAND_REQUEST,
  'execute.command.response.json': MessageType.EXECUTE_COMMAND_RESPONSE,
  'event.json': MessageType.EVENT,
}

export type EncodingCase = {
  file: string
  vector: EncodingVector
  /** Run all encoding assertions for this vector. Throws on failure. */
  run(): void
}

export function loadEncodingCases(): EncodingCase[] {
  return listVectors(ENCODING_DIR).map((file) => {
    const vector = readJson<EncodingVector>(file)
    return {
      file,
      vector,
      run() {
        // 1. Schema validity — parse against the discriminated union.
        const parsed = v.safeParse(CommandMessageSchema, vector.message)
        if (!parsed.success) {
          throw new Error(
            `Schema validation failed: ${parsed.issues.map((i) => i.message).join('; ')}`,
          )
        }
        const expectedType = SCHEMA_FILE_TO_TYPE[vector.schema]
        if (!expectedType) {
          throw new Error(`Unknown schema reference in vector: ${vector.schema}`)
        }
        const actualType = (vector.message as { type?: unknown }).type
        if (actualType !== expectedType) {
          throw new Error(
            `Vector claims schema "${vector.schema}" but message.type is "${String(actualType)}"`,
          )
        }

        // 2. JSON decode matches message
        const decoded = JSON.parse(vector.json)
        if (!deepEqual(decoded, vector.message)) {
          throw new Error(`JSON.parse(json) !== message`)
        }

        // 3. JSON round-trip
        const jsonRT = JSON.parse(JSON.stringify(vector.message))
        if (!deepEqual(jsonRT, vector.message)) {
          throw new Error(`JSON round-trip mismatch`)
        }
      },
    }
  })
}
