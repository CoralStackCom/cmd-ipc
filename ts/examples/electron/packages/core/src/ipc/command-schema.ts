import * as v from 'valibot'

import type { CommandSchemaMap, InferCommandSchemaMapType } from '@coralstack/cmd-ipc'
import { defineIds } from '@coralstack/cmd-ipc'

/**
 * Options for desktop notification
 */
const NotificationOptionsSchema = v.pipe(
  v.object({
    /**
     * A title for the notification, which will be displayed at the top of the
     * notification window when it is shown.
     */
    title: v.optional(v.string()),
    /**
     * The body text of the notification, which will be displayed below the title or
     * subtitle.
     */
    body: v.optional(v.string()),
    /**
     * Whether or not to suppress the OS notification noise when showing the
     * notification.
     */
    silent: v.optional(v.boolean()),
    /**
     * An icon to use in the notification. It must be a valid path to a local icon file.
     */
    icon: v.optional(v.string()),
  }),
  v.description(
    'Options for displaying a desktop notification, including title, body, sound behavior, and icon.',
  ),
  v.examples([
    {
      title: 'Update Available',
      body: 'A new version of the application is available for download.',
      silent: false,
      icon: '/path/to/update-icon.png',
    },
    {
      title: 'Reminder',
      body: 'Your meeting starts in 10 minutes.',
      silent: true,
    },
  ]),
)

/**
 * App Command Schemas
 */
export const AppCommandSchema = {
  // Command using a predefined schema
  'show.notification': {
    request: NotificationOptionsSchema,
    description: 'Show a desktop notification',
  },
  // Command with no request or response (void)
  'open.website': {
    request: v.object({
      url: v.pipe(v.string(), v.url(), v.description('The URL to open')),
    }),
    description: 'Open a URL/website in the default browser',
  },
  // A rich command with both request and response schemas with descriptions and examples
  // for each field and the overall schema
  'hello.world': {
    request: v.pipe(
      v.object({
        name: v.pipe(v.string(), v.description('The name to greet'), v.examples(['Alice'])),
      }),
      v.description('The name to greet'),
      v.examples([{ name: 'Alice' }]),
    ),
    response: v.pipe(
      v.object({
        message: v.pipe(
          v.string(),
          v.description('The greeting message'),
          v.examples(['Hello Alice']),
        ),
      }),
      v.description('The greeting message'),
      v.examples([{ message: 'Hello Alice' }]),
    ),
    description: 'Returns a hello world message with the provided name',
  },
  // Command with only response schema
  'increment.counter': {
    response: v.object({ count: v.number() }),
    description: 'Increments the counter and returns the new value',
  },
  // Simple command schema without description and example fields
  'call.api': {
    request: v.object({ url: v.string() }),
    response: v.object({ data: v.any() }),
    description: 'Makes a GET request to the specified API URL and returns the data',
  },
} as const satisfies CommandSchemaMap

/**
 * App Command IDs
 */
export const AppCommandIDs = defineIds(AppCommandSchema)

/**
 * Type helpers for Commands to extract request and response types on Handlers. As the `@Command` decorator
 * can't enforce type safety on its own, these helpers can be used to ensure that the correct types are used in
 * your command handlers and will produce type errors if the types do not match the schema.
 *
 * @example
 * ```ts
 * @Command(AppCommandIDs.HELLO_WORLD)
 * public async helloWorld({
 *   name,
 * }: AppCommandRequest<typeof AppCommandIDs.HELLO_WORLD>): AppCommandResponse<typeof AppCommandIDs.HELLO_WORLD> {
 *   return `Hello ${name}`
 * }
 * ```
 */
type AppCommands = InferCommandSchemaMapType<typeof AppCommandSchema>
export type AppCommandRequest<K extends keyof AppCommands> = AppCommands[K]['request']
export type AppCommandResponse<K extends keyof AppCommands> = Promise<AppCommands[K]['response']>
