/**
 * Utility type to convert string to CONSTANT_CASE
 */
type ToConstantCase<S extends string> = S extends `${infer A}.${infer B}`
  ? `${Uppercase<A>}_${ToConstantCase<B>}`
  : Uppercase<S>

/**
 * Creates an object mapping CONSTANT_CASE command identifiers to their original string IDs.
 *
 * @example
 * ```ts
 * const MyCommands = {
 *   'my.command': {
 *     request: v.object({ id: v.string() }),
 *     response: v.object({ success: v.boolean() }),
 *     description: 'A sample command',
 *   },
 * } as const satisfies CommandMap;
 *
 * const MyCommandIDs = defineIds(MyCommands);
 * // Resulting type:
 * // { MY_COMMAND: 'my.command' }
 * ```
 *
 * @param map - The command map object
 * @returns An object mapping CONSTANT_CASE command identifiers to their string values
 */
export function defineIds<const M extends Record<string, unknown>>(map: M) {
  const result = {} as {
    [K in keyof M as ToConstantCase<K & string>]: K
  }

  for (const key of Object.keys(map) as (keyof M & string)[]) {
    const constantKey = key.toUpperCase().replace(/\./g, '_') as ToConstantCase<typeof key>

    ;(result as any)[constantKey] = key
  }

  return result
}
