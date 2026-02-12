import * as v from 'valibot'

import type { EventSchemaMap, InferEventSchemaMapType } from './event-schema'
import { defineIds } from './schema-utils'

describe('Event Schemas', () => {
  it('should work', async () => {
    const EventSchema = {
      'sample.event': v.object({
        id: v.pipe(v.string(), v.description('The unique identifier for the event')),
      }),
    } as const satisfies EventSchemaMap

    const EventIDs = defineIds(EventSchema)
    expect(EventIDs).toEqual({ SAMPLE_EVENT: 'sample.event' })

    // Inferred Event Schema Types
    type _EventSchemaTypes = InferEventSchemaMapType<typeof EventSchema>
  })

  it('should throw type errors for invalid event definitions', async () => {
    const _InvalidEventSchema = {
      'duplicate.event': v.string(),
      // @ts-expect-error - Duplicate event IDs should cause a type error
      'duplicate.event': v.string(),
    } as const satisfies EventSchemaMap

    const _InvalidEventSchema2 = {
      // @ts-expect-error - Not using valibot schema should cause a type error
      'duplicate.event': 'A string instead of a schema',
    } as const satisfies EventSchemaMap
  })
})
