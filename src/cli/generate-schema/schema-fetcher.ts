import type { ICommandDefinitionBase } from '../../registry'
import type { IMessageListCommandsResponse } from '../../registry/command-messages-types'

/**
 * Fetch Schema Options
 */
export interface FetchSchemaOptions {
  /**
   * Host URL to fetch schemas from
   * @example 'https://api.example.com'
   */
  host: string
  /**
   * Request timeout in milliseconds (default: 30s)
   * @default 30000
   */
  timeout?: number
}

/**
 * Fetches command schemas from a remote server
 */
export async function fetchSchemas({
  host,
  timeout = 30000,
}: FetchSchemaOptions): Promise<ICommandDefinitionBase[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const url = `${host}/cmds.json`
  // eslint-disable-next-line no-console
  console.info(`Fetching command schemas from ${url} ...`)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = (await response.json()) as IMessageListCommandsResponse

    if (!data.commands || !Array.isArray(data.commands)) {
      throw new Error('Invalid response: missing commands array')
    }

    return data.commands
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`)
    }

    throw error
  }
}
