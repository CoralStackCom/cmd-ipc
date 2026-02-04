/**
 * MCP SSE Utilities - Server-Sent Events parser and writer
 *
 * @packageDocumentation
 */

import type { SSEEvent } from './mcp-types'

// ============================================================================
// SSE Parser (for Client)
// ============================================================================

/**
 * Parse a Server-Sent Events stream into events.
 *
 * SSE format:
 * ```
 * id: optional-id
 * event: optional-event-name
 * data: json-data-here
 * retry: optional-retry-ms
 *
 * ```
 *
 * Each event is separated by a blank line.
 *
 * @param stream - ReadableStream from HTTP response
 * @yields SSEEvent objects
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEEvent, void, undefined> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Current event being built
  let currentEvent: Partial<SSEEvent> = {}
  let dataLines: string[] = []

  try {
    while (true) {
      const { value, done } = await reader.read()

      if (done) {
        // Process any remaining data in buffer
        if (buffer.trim()) {
          const lines = buffer.split('\n')
          for (const line of lines) {
            processLine(line.trim(), currentEvent, dataLines)
          }
          // Emit final event if we have data
          if (dataLines.length > 0) {
            yield {
              ...currentEvent,
              data: dataLines.join('\n'),
            } as SSEEvent
          }
        }
        break
      }

      buffer += decoder.decode(value, { stream: true })

      // Process complete lines
      const lines = buffer.split('\n')
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmedLine = line.trim()

        // Empty line marks end of event
        if (trimmedLine === '') {
          if (dataLines.length > 0) {
            yield {
              ...currentEvent,
              data: dataLines.join('\n'),
            } as SSEEvent
            // Reset for next event
            currentEvent = {}
            dataLines = []
          }
          continue
        }

        processLine(trimmedLine, currentEvent, dataLines)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Process a single SSE line
 */
function processLine(line: string, currentEvent: Partial<SSEEvent>, dataLines: string[]): void {
  // Skip comments
  if (line.startsWith(':')) {
    return
  }

  // Parse field: value format
  const colonIndex = line.indexOf(':')
  if (colonIndex === -1) {
    // Field with no value (treated as empty string)
    return
  }

  const field = line.slice(0, colonIndex)
  // Value starts after colon, with optional leading space
  let value = line.slice(colonIndex + 1)
  if (value.startsWith(' ')) {
    value = value.slice(1)
  }

  switch (field) {
    case 'id':
      currentEvent.id = value
      break
    case 'event':
      currentEvent.event = value
      break
    case 'data':
      dataLines.push(value)
      break
    case 'retry': {
      const retryMs = parseInt(value, 10)
      if (!isNaN(retryMs)) {
        currentEvent.retry = retryMs
      }
      break
    }
    // Unknown fields are ignored per SSE spec
  }
}

// ============================================================================
// SSE Writer (for Server)
// ============================================================================

/**
 * SSE writer interface for sending events
 */
export interface SSEWriter {
  /**
   * Write a raw SSE event
   */
  writeEvent(event: SSEEvent): void

  /**
   * Write a JSON message as SSE data
   */
  writeMessage(data: unknown, eventType?: string, id?: string): void

  /**
   * Close the SSE stream
   */
  close(): void

  /**
   * Check if the stream is closed
   */
  isClosed(): boolean
}

/**
 * Create an SSE stream and writer pair.
 *
 * @returns Object with stream (for HTTP response) and writer (for sending events)
 */
export function createSSEStream(): {
  stream: ReadableStream<Uint8Array>
  writer: SSEWriter
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let closed = false
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    cancel() {
      closed = true
    },
  })

  const writer: SSEWriter = {
    writeEvent(event: SSEEvent): void {
      if (closed || !controller) return

      let output = ''

      if (event.id !== undefined) {
        output += `id: ${event.id}\n`
      }
      if (event.event !== undefined) {
        output += `event: ${event.event}\n`
      }
      if (event.retry !== undefined) {
        output += `retry: ${event.retry}\n`
      }

      // Data can be multiline - each line needs its own "data:" prefix
      const dataLines = event.data.split('\n')
      for (const line of dataLines) {
        output += `data: ${line}\n`
      }

      // End of event
      output += '\n'

      controller.enqueue(encoder.encode(output))
    },

    writeMessage(data: unknown, eventType?: string, id?: string): void {
      if (closed) return

      const event: SSEEvent = {
        data: JSON.stringify(data),
      }
      if (eventType) {
        event.event = eventType
      }
      if (id) {
        event.id = id
      }

      this.writeEvent(event)
    },

    close(): void {
      if (closed || !controller) return
      closed = true
      controller.close()
    },

    isClosed(): boolean {
      return closed
    },
  }

  return { stream, writer }
}

// ============================================================================
// SSE Content Type
// ============================================================================

/**
 * Standard SSE content type
 */
export const SSE_CONTENT_TYPE = 'text/event-stream'

/**
 * Check if an Accept header prefers SSE over JSON
 */
export function prefersSSE(acceptHeader: string | null): boolean {
  if (!acceptHeader) return false

  // Parse Accept header and check for text/event-stream
  const types = acceptHeader.split(',').map((t) => t.trim().split(';')[0])

  // Check if SSE is present and comes before application/json
  const sseIndex = types.indexOf('text/event-stream')
  const jsonIndex = types.indexOf('application/json')

  if (sseIndex === -1) return false
  if (jsonIndex === -1) return true

  return sseIndex < jsonIndex
}
