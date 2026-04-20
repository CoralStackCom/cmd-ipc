import type { CommandMessage } from '../../registry/command-message-schemas'

/**
 * Context object passed to middleware functions
 */
export interface HTTPMiddlewareContext {
  /**
   * The URL being requested
   */
  url: string
  /**
   * HTTP headers (modifiable)
   */
  headers: Headers
  /**
   * The request body
   */
  message: CommandMessage
  /**
   * Abort controller for the request
   */
  abortController: AbortController
}

/**
 * Middleware function type for HTTPChannel
 *
 * Middleware can modify the request context before it's sent.
 * Call `next()` to continue to the next middleware or the actual request.
 * Throw an error to abort the request chain.
 *
 * @example
 * // Add authentication header
 * channel.use(async (ctx, next) => {
 *   ctx.headers.set('Authorization', `Bearer ${getToken()}`)
 *   return next()
 * })
 *
 * @example
 * // Log requests
 * channel.use(async (ctx, next) => {
 *   console.log('Request:', ctx.url, ctx.body)
 *   const result = await next()
 *   console.log('Response:', result)
 *   return result
 * })
 */
export type HTTPMiddleware = (
  ctx: HTTPMiddlewareContext,
  next: () => Promise<CommandMessage>,
) => Promise<CommandMessage>

/**
 * Configuration options for HTTPChannel
 */
export interface HTTPChannelConfig {
  /**
   * Unique identifier for this channel
   */
  id: string
  /**
   * Base URL for client mode (e.g., 'https://api.example.com')
   * If not provided, channel operates in server mode
   */
  baseUrl?: string
  /**
   * Prefix to add to remote command IDs when registering
   * e.g., prefix: 'cloud' registers 'user.create' as 'cloud.user.create'
   */
  commandPrefix?: string
  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number
}

/**
 * Mode of the HTTP Channel
 */
export type HTTPChannelMode = 'CLIENT' | 'SERVER'
