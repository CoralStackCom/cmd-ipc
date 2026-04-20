import 'reflect-metadata'

import type { CommandHandler } from '../registry/command-registry-interface'

/**
 * Definition for Command Handler Function
 */
interface CommandHandlerDefinition {
  id: string
  method: string
}

/**
 * Minimal interface for registering commands.
 * This avoids generic constraints from ICommandRegistry.
 */
interface ICommandRegistrar {
  registerCommand(id: string, handler: CommandHandler): Promise<void>
}

/**
 * Key for Reflect Metadata
 */
const REFLECT_COMMAND_METADATA_KEY = 'command:handler'

/**
 * CommandHandler decorator - add this decorator to any Class methods you want to register to handle Command requests.
 *
 * Supports all 4 valid handler signatures:
 *
 * 1. () => Promise<TResponse> - No request payload
 * 2. (request: TRequest) => `Promise<TResponse>` - With request payload
 * 3. () => `Promise<void>` - No request payload and no response
 * 4. (request: TRequest) => `Promise<void>` - With request payload and no response
 *
 * @param id The Command ID to register the method with. Must be unique!
 */
export function Command(
  id: string,
): <TRequest extends object, TResponse extends object>(
  target: any,
  methodName: string,
  descriptor:
    | TypedPropertyDescriptor<() => Promise<void>>
    | TypedPropertyDescriptor<() => Promise<TResponse>>
    | TypedPropertyDescriptor<(request: TRequest) => Promise<void>>
    | TypedPropertyDescriptor<(request: TRequest) => Promise<TResponse>>,
) => void {
  return (target, methodName, descriptor) => {
    if (!descriptor.value) {
      throw new Error(`@Command decorator can only be applied to methods.`)
    }

    // Store metadata for the method (do NOT wrap the handler)
    const existing: CommandHandlerDefinition[] =
      Reflect.getMetadata(REFLECT_COMMAND_METADATA_KEY, target) || []

    existing.push({ id, method: methodName })
    Reflect.defineMetadata(REFLECT_COMMAND_METADATA_KEY, existing, target)
  }
}

/**
 * Register all handlers decorated using @Command for every class instance provided.
 *
 * @param instances - Array of class instances to register commands for
 * @param registry - Any object with a registerCommand method
 */
export function registerCommands(instances: object[], registry: ICommandRegistrar) {
  for (const instance of instances) {
    const prototype = Object.getPrototypeOf(instance)

    const commands: CommandHandlerDefinition[] =
      Reflect.getMetadata(REFLECT_COMMAND_METADATA_KEY, prototype) || []

    for (const command of commands) {
      const handler = (instance as any)[command.method] as unknown

      if (typeof handler !== 'function') {
        throw new Error(
          `@Command(${command.id}) expected ${prototype?.constructor?.name ?? 'Unknown'}.${command.method} to be a function.`,
        )
      }

      // Bind method to instance to preserve `this`
      registry.registerCommand(command.id, (handler as CommandHandler).bind(instance))
    }
  }
}
