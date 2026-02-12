import type { StandardJsonSchema } from '@valibot/to-json-schema'

/**
 * Standard JSON Schema type used by Valibot and Zod
 */
export type JsonSchema = StandardJsonSchema<unknown, unknown>

/**
 * Internal helper type for accessing JSON Schema properties
 * StandardJsonSchema is complex, so we use this for property access
 */
interface JsonSchemaProps {
  type?: string
  $ref?: string
  const?: unknown
  enum?: unknown[]
  oneOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  allOf?: JsonSchema[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  minItems?: number
  maxItems?: number
}

/**
 * Converts a JSON Schema to Valibot code string
 */
export function jsonSchemaToValibot(schema: JsonSchema | undefined, indent = 0): string {
  if (!schema) {
    return 'v.unknown()'
  }

  // Cast to internal type for property access
  const s = schema as unknown as JsonSchemaProps

  // Handle $ref (not fully supported, fallback to unknown)
  if ('$ref' in s && s.$ref) {
    return 'v.unknown()'
  }

  // Handle type
  const schemaType = s.type

  if (schemaType === 'string') {
    return convertStringSchema(s)
  }

  if (schemaType === 'number' || schemaType === 'integer') {
    return convertNumberSchema(s, schemaType)
  }

  if (schemaType === 'boolean') {
    return 'v.boolean()'
  }

  if (schemaType === 'null') {
    return 'v.null_()'
  }

  if (schemaType === 'array') {
    return convertArraySchema(s, indent)
  }

  if (schemaType === 'object') {
    return convertObjectSchema(s, indent)
  }

  // Handle oneOf/anyOf/allOf
  if ('oneOf' in s && Array.isArray(s.oneOf)) {
    const variants = s.oneOf.map((v) => jsonSchemaToValibot(v, indent)).join(', ')
    return `v.union([${variants}])`
  }

  if ('anyOf' in s && Array.isArray(s.anyOf)) {
    const variants = s.anyOf.map((v) => jsonSchemaToValibot(v, indent)).join(', ')
    return `v.union([${variants}])`
  }

  if ('allOf' in s && Array.isArray(s.allOf)) {
    const variants = s.allOf.map((v) => jsonSchemaToValibot(v, indent)).join(', ')
    return `v.intersect([${variants}])`
  }

  // Handle const
  if ('const' in s) {
    return `v.literal(${JSON.stringify(s.const)})`
  }

  // Handle enum
  if ('enum' in s && Array.isArray(s.enum)) {
    if (s.enum.length === 1) {
      return `v.literal(${JSON.stringify(s.enum[0])})`
    }
    const literals = s.enum.map((e) => `v.literal(${JSON.stringify(e)})`).join(', ')
    return `v.union([${literals}])`
  }

  // Fallback
  return 'v.unknown()'
}

function convertStringSchema(schema: JsonSchemaProps): string {
  const constraints: string[] = []

  if (typeof schema.minLength === 'number') {
    constraints.push(`v.minLength(${schema.minLength})`)
  }
  if (typeof schema.maxLength === 'number') {
    constraints.push(`v.maxLength(${schema.maxLength})`)
  }
  if (typeof schema.pattern === 'string') {
    constraints.push(`v.regex(/${schema.pattern}/)`)
  }
  if (schema.format) {
    switch (schema.format) {
      case 'email':
        constraints.push('v.email()')
        break
      case 'uri':
      case 'url':
        constraints.push('v.url()')
        break
      case 'uuid':
        constraints.push('v.uuid()')
        break
      case 'date-time':
        constraints.push('v.isoDateTime()')
        break
      case 'date':
        constraints.push('v.isoDate()')
        break
      case 'time':
        constraints.push('v.isoTime()')
        break
    }
  }

  if (constraints.length === 0) {
    return 'v.string()'
  }

  return `v.pipe(v.string(), ${constraints.join(', ')})`
}

function convertNumberSchema(schema: JsonSchemaProps, type: 'number' | 'integer'): string {
  const constraints: string[] = []

  if (typeof schema.minimum === 'number') {
    constraints.push(`v.minValue(${schema.minimum})`)
  }
  if (typeof schema.maximum === 'number') {
    constraints.push(`v.maxValue(${schema.maximum})`)
  }
  if (typeof schema.exclusiveMinimum === 'number') {
    constraints.push(`v.minValue(${schema.exclusiveMinimum + (type === 'integer' ? 1 : 0.0001)})`)
  }
  if (typeof schema.exclusiveMaximum === 'number') {
    constraints.push(`v.maxValue(${schema.exclusiveMaximum - (type === 'integer' ? 1 : 0.0001)})`)
  }

  if (constraints.length === 0) {
    return type === 'integer' ? 'v.pipe(v.number(), v.integer())' : 'v.number()'
  }

  if (type === 'integer') {
    return `v.pipe(v.number(), v.integer(), ${constraints.join(', ')})`
  }
  return `v.pipe(v.number(), ${constraints.join(', ')})`
}

function convertArraySchema(schema: JsonSchemaProps, indent: number): string {
  const itemsSchema = schema.items
  const itemType = jsonSchemaToValibot(itemsSchema, indent)
  const constraints: string[] = []

  if (typeof schema.minItems === 'number') {
    constraints.push(`v.minLength(${schema.minItems})`)
  }
  if (typeof schema.maxItems === 'number') {
    constraints.push(`v.maxLength(${schema.maxItems})`)
  }

  const baseArray = `v.array(${itemType})`

  if (constraints.length === 0) {
    return baseArray
  }

  return `v.pipe(${baseArray}, ${constraints.join(', ')})`
}

function convertObjectSchema(schema: JsonSchemaProps, indent: number): string {
  const properties = schema.properties ?? {}
  const required = schema.required ?? []

  if (Object.keys(properties).length === 0) {
    return 'v.object({})'
  }

  const innerSpaces = '  '.repeat(indent + 1)
  const propSpaces = '  '.repeat(indent + 2)

  const propLines: string[] = []

  for (const [key, propSchema] of Object.entries(properties)) {
    const isRequired = required.includes(key)
    const propType = jsonSchemaToValibot(propSchema, indent + 2)

    // Use valid JS identifier or quote the key
    const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key}'`

    if (isRequired) {
      propLines.push(`${propSpaces}${safeKey}: ${propType},`)
    } else {
      propLines.push(`${propSpaces}${safeKey}: v.optional(${propType}),`)
    }
  }

  return `v.object({\n${propLines.join('\n')}\n${innerSpaces}})`
}
