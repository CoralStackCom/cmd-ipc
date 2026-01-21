import type { GoogleGenerativeAIProvider } from '@ai-sdk/google'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { ChatRequestOptions, ChatTransport, ToolSet, UIMessage, UIMessageChunk } from 'ai'
import { convertToModelMessages, stepCountIs, streamText } from 'ai'

/**
 * Supported Google Generative AI model IDs for Gemini.
 * (see @ai-sdk/google docs for the latest list)
 */
type GoogleGenerativeAIModelId =
  | 'gemini-1.5-flash'
  | 'gemini-1.5-flash-latest'
  | 'gemini-1.5-flash-001'
  | 'gemini-1.5-flash-002'
  | 'gemini-1.5-flash-8b'
  | 'gemini-1.5-flash-8b-latest'
  | 'gemini-1.5-flash-8b-001'
  | 'gemini-1.5-pro'
  | 'gemini-1.5-pro-latest'
  | 'gemini-1.5-pro-001'
  | 'gemini-1.5-pro-002'
  | 'gemini-2.0-flash'
  | 'gemini-2.0-flash-001'
  | 'gemini-2.0-flash-live-001'
  | 'gemini-2.0-flash-lite'
  | 'gemini-2.0-pro-exp-02-05'
  | 'gemini-2.0-flash-thinking-exp-01-21'
  | 'gemini-2.0-flash-exp'
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-flash-image-preview'
  | 'gemini-2.5-flash-lite'
  | 'gemini-2.5-flash-lite-preview-09-2025'
  | 'gemini-2.5-flash-preview-04-17'
  | 'gemini-2.5-flash-preview-09-2025'
  | 'gemini-3-pro-preview'
  | 'gemini-3-pro-image-preview'
  | 'gemini-3-flash-preview'
  | 'gemini-pro-latest'
  | 'gemini-flash-latest'
  | 'gemini-flash-lite-latest'
  | 'gemini-2.5-pro-exp-03-25'
  | 'gemini-exp-1206'
  | 'gemma-3-12b-it'
  | 'gemma-3-27b-it'
  | (string & {})

/**
 * Token usage information from Gemini responses.
 */
interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/**
 * Callback for when token usage is updated.
 */
export type UsageUpdateCallback = (usage: TokenUsage) => void

/**
 * Constructor options for `GeminiChatTransport`.
 */
export type GeminiChatTransportOptions = {
  /**
   * Your Google API key for authenticating requests.
   * @default Vite GOOGLE_AI_API_KEY environment variable value if set
   */
  apiKey?: string
  /**
   * Gemini model id, e.g. "gemini-2.0-flash"
   * (see @ai-sdk/google docs for the latest list)
   * @default 'gemini-2.0-flash'
   */
  modelId?: GoogleGenerativeAIModelId
  /**
   * An array of Tool definitions to enable tool calling.
   */
  tools?: ToolSet
  /**
   * Callback for when token usage is updated after streaming completes.
   */
  onUsageUpdate?: UsageUpdateCallback
}

/**
 * Chat transport for Google Gemini via @ai-sdk/google to use with `useChat` hook.
 */
export class GeminiChatTransport<UI_MESSAGE extends UIMessage = UIMessage>
  implements ChatTransport<UI_MESSAGE>
{
  // Readonly copy of options passed to the constructor
  private readonly options: Required<Pick<GeminiChatTransportOptions, 'modelId' | 'apiKey'>> &
    Omit<GeminiChatTransportOptions, 'modelId'>

  // Google Generative AI provider instance
  private google: GoogleGenerativeAIProvider | null = null

  // Token usage tracking
  private tokenUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  }

  // Callback for usage updates
  private onUsageUpdate?: UsageUpdateCallback

  /**
   * Default constructor.
   *
   * @param options GeminiChatTransportOptions
   * @throws Will throw an error if Google API key is not provided or invalid.
   */
  constructor(options: GeminiChatTransportOptions) {
    this.options = {
      apiKey: options.apiKey || import.meta.env.VITE_GOOGLE_AI_API_KEY || '',
      modelId: options.modelId ?? 'gemini-2.0-flash',
      tools: options.tools,
    }
    this.onUsageUpdate = options.onUsageUpdate
    // eslint-disable-next-line no-console
    console.log('GeminiChatTransport initialized with options:', this.options)
    if (this.options.apiKey) {
      this.google = createGoogleGenerativeAI({
        apiKey: this.options.apiKey,
      })
    }
  }

  get apiKey(): string {
    return this.options.apiKey
  }

  get modelId(): GoogleGenerativeAIModelId {
    return this.options.modelId
  }

  get tools(): ToolSet | undefined {
    return this.options.tools
  }

  get usage(): TokenUsage {
    return this.tokenUsage
  }

  /**
   * Sends messages to the chat API endpoint and returns a streaming response.
   *
   * This method handles both new message submission and message regeneration.
   * It supports real-time streaming of responses through UIMessageChunk events.
   */
  async sendMessages({
    abortSignal,
    messages,
  }: {
    /** The type of message submission - either new message or regeneration */
    trigger: 'submit-message' | 'regenerate-message'
    /** Unique identifier for the chat session */
    chatId: string
    /** ID of the message to regenerate, or undefined for new messages */
    messageId: string | undefined
    /** Array of UI messages representing the conversation history */
    messages: UI_MESSAGE[]
    /** Signal to abort the request if needed */
    abortSignal: AbortSignal | undefined
  } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk>> {
    if (!this.google) {
      throw new Error('Google Generative AI provider is not initialized.')
    }
    const result = streamText({
      model: this.google(this.options.modelId),
      messages: await convertToModelMessages(messages),
      tools: this.options.tools,
      // Allow up to 5 steps for tool execution
      stopWhen: stepCountIs(5),
      abortSignal,
      // Update token usage after streaming completes
      onFinish: (event) => {
        const usage = event.usage
        if (usage) {
          this.tokenUsage = {
            inputTokens: this.tokenUsage.inputTokens + (usage.inputTokens ?? 0),
            outputTokens: this.tokenUsage.outputTokens + (usage.outputTokens ?? 0),
            totalTokens: this.tokenUsage.totalTokens + (usage.totalTokens ?? 0),
          }
          // Notify listener of usage update
          this.onUsageUpdate?.(this.tokenUsage)
        }
      },
    })

    // Convert the model stream into a UI message chunk stream for the UI.
    // This returns an AsyncIterableStream that can be consumed as a ReadableStream.
    const uiStream = result.toUIMessageStream({
      originalMessages: messages,
    })

    // If you want to guarantee abort behavior even if upstream ignores it:
    if (abortSignal) {
      abortSignal.addEventListener(
        'abort',
        () => {
          try {
            // AsyncIterableStream implements ReadableStream; cancel should propagate.
            uiStream.cancel?.('aborted')
          } catch {
            // ignore
          }
        },
        { once: true },
      )
    }

    return uiStream as unknown as ReadableStream<UIMessageChunk>
  }

  /**
   * Reconnects to an existing streaming response for the specified chat session.
   *
   * This method is used to resume streaming when a connection is interrupted
   * or when resuming a chat session. It's particularly useful for maintaining
   * continuity in long-running conversations or recovering from network issues.
   *
   * As this is a client-to-Gemini direct streaming implementation, there is no built-in
   * support for resuming streams. If you need this functionality, you would have to
   * implement your own state management and message history tracking to recreate
   * the context for the stream.
   *
   * @param args - The arguments containing chat session details.
   * @returns null
   */
  async reconnectToStream(
    _args: { chatId: string } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }
}
