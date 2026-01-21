import { jsonSchemaToValibot, type JsonSchema } from './schema-converter'

// Helper to cast test objects to JsonSchema (StandardJsonSchema is a branded type)
const schema = <T>(obj: T): JsonSchema => obj as JsonSchema

describe('jsonSchemaToValibot', () => {
  describe('primitive types', () => {
    it('should convert string type', () => {
      expect(jsonSchemaToValibot(schema({ type: 'string' }))).toBe('v.string()')
    })

    it('should convert number type', () => {
      expect(jsonSchemaToValibot(schema({ type: 'number' }))).toBe('v.number()')
    })

    it('should convert integer type', () => {
      expect(jsonSchemaToValibot(schema({ type: 'integer' }))).toBe(
        'v.pipe(v.number(), v.integer())',
      )
    })

    it('should convert boolean type', () => {
      expect(jsonSchemaToValibot(schema({ type: 'boolean' }))).toBe('v.boolean()')
    })

    it('should convert null type', () => {
      expect(jsonSchemaToValibot(schema({ type: 'null' }))).toBe('v.null_()')
    })

    it('should return v.unknown() for undefined schema', () => {
      expect(jsonSchemaToValibot(undefined)).toBe('v.unknown()')
    })
  })

  describe('string constraints', () => {
    it('should convert string with minLength', () => {
      expect(jsonSchemaToValibot(schema({ type: 'string', minLength: 5 }))).toBe(
        'v.pipe(v.string(), v.minLength(5))',
      )
    })

    it('should convert string with maxLength', () => {
      expect(jsonSchemaToValibot(schema({ type: 'string', maxLength: 10 }))).toBe(
        'v.pipe(v.string(), v.maxLength(10))',
      )
    })

    it('should convert string with pattern', () => {
      expect(jsonSchemaToValibot(schema({ type: 'string', pattern: '^[a-z]+$' }))).toBe(
        'v.pipe(v.string(), v.regex(/^[a-z]+$/))',
      )
    })

    it('should convert string with email format', () => {
      expect(jsonSchemaToValibot(schema({ type: 'string', format: 'email' }))).toBe(
        'v.pipe(v.string(), v.email())',
      )
    })

    it('should convert string with uuid format', () => {
      expect(jsonSchemaToValibot(schema({ type: 'string', format: 'uuid' }))).toBe(
        'v.pipe(v.string(), v.uuid())',
      )
    })

    it('should convert string with url format', () => {
      expect(jsonSchemaToValibot(schema({ type: 'string', format: 'uri' }))).toBe(
        'v.pipe(v.string(), v.url())',
      )
    })

    it('should convert string with date-time format', () => {
      expect(jsonSchemaToValibot(schema({ type: 'string', format: 'date-time' }))).toBe(
        'v.pipe(v.string(), v.isoDateTime())',
      )
    })
  })

  describe('number constraints', () => {
    it('should convert number with minimum', () => {
      expect(jsonSchemaToValibot(schema({ type: 'number', minimum: 0 }))).toBe(
        'v.pipe(v.number(), v.minValue(0))',
      )
    })

    it('should convert number with maximum', () => {
      expect(jsonSchemaToValibot(schema({ type: 'number', maximum: 100 }))).toBe(
        'v.pipe(v.number(), v.maxValue(100))',
      )
    })

    it('should convert integer with minimum and maximum', () => {
      expect(jsonSchemaToValibot(schema({ type: 'integer', minimum: 1, maximum: 10 }))).toBe(
        'v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10))',
      )
    })
  })

  describe('array type', () => {
    it('should convert array with items', () => {
      expect(jsonSchemaToValibot(schema({ type: 'array', items: { type: 'string' } }))).toBe(
        'v.array(v.string())',
      )
    })

    it('should convert array without items', () => {
      expect(jsonSchemaToValibot(schema({ type: 'array' }))).toBe('v.array(v.unknown())')
    })

    it('should convert array with minItems', () => {
      expect(
        jsonSchemaToValibot(schema({ type: 'array', items: { type: 'number' }, minItems: 1 })),
      ).toBe('v.pipe(v.array(v.number()), v.minLength(1))')
    })

    it('should convert array with maxItems', () => {
      expect(
        jsonSchemaToValibot(schema({ type: 'array', items: { type: 'number' }, maxItems: 5 })),
      ).toBe('v.pipe(v.array(v.number()), v.maxLength(5))')
    })
  })

  describe('object type', () => {
    it('should convert empty object', () => {
      expect(jsonSchemaToValibot(schema({ type: 'object' }))).toBe('v.object({})')
    })

    it('should convert object with required properties', () => {
      const result = jsonSchemaToValibot(
        schema({
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['name', 'age'],
        }),
      )

      expect(result).toContain('v.object({')
      expect(result).toContain('name: v.string(),')
      expect(result).toContain('age: v.number(),')
    })

    it('should convert object with optional properties', () => {
      const result = jsonSchemaToValibot(
        schema({
          type: 'object',
          properties: {
            name: { type: 'string' },
            nickname: { type: 'string' },
          },
          required: ['name'],
        }),
      )

      expect(result).toContain('name: v.string(),')
      expect(result).toContain('nickname: v.optional(v.string()),')
    })

    it('should quote invalid JS identifiers', () => {
      const result = jsonSchemaToValibot(
        schema({
          type: 'object',
          properties: {
            'my-prop': { type: 'string' },
          },
          required: ['my-prop'],
        }),
      )

      expect(result).toContain("'my-prop': v.string(),")
    })
  })

  describe('const and enum', () => {
    it('should convert const value', () => {
      expect(jsonSchemaToValibot(schema({ const: 'active' }))).toBe('v.literal("active")')
    })

    it('should convert single-value enum', () => {
      expect(jsonSchemaToValibot(schema({ enum: ['pending'] }))).toBe('v.literal("pending")')
    })

    it('should convert multi-value enum', () => {
      expect(jsonSchemaToValibot(schema({ enum: ['pending', 'active', 'completed'] }))).toBe(
        'v.union([v.literal("pending"), v.literal("active"), v.literal("completed")])',
      )
    })
  })

  describe('oneOf/anyOf/allOf', () => {
    it('should convert oneOf', () => {
      expect(
        jsonSchemaToValibot(
          schema({
            oneOf: [{ type: 'string' }, { type: 'number' }],
          }),
        ),
      ).toBe('v.union([v.string(), v.number()])')
    })

    it('should convert anyOf', () => {
      expect(
        jsonSchemaToValibot(
          schema({
            anyOf: [{ type: 'string' }, { type: 'null' }],
          }),
        ),
      ).toBe('v.union([v.string(), v.null_()])')
    })

    it('should convert allOf', () => {
      expect(
        jsonSchemaToValibot(
          schema({
            allOf: [
              { type: 'object', properties: { a: { type: 'string' } } },
              { type: 'object', properties: { b: { type: 'number' } } },
            ],
          }),
        ),
      ).toContain('v.intersect([')
    })
  })

  describe('edge cases', () => {
    it('should return v.unknown() for $ref', () => {
      expect(jsonSchemaToValibot(schema({ $ref: '#/definitions/User' }))).toBe('v.unknown()')
    })

    it('should return v.unknown() for unknown type', () => {
      expect(jsonSchemaToValibot(schema({}))).toBe('v.unknown()')
    })
  })
})
