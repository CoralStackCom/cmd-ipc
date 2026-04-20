/**
 * Chat Tab Component
 *
 * Handles the chat interface with message display, input handling,
 * prompt history navigation, and markdown rendering.
 */

import { useChat } from '@ai-sdk/react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'

import { GeminiChatTransport } from '../agent/gemini-chat-transport'
import { listTools } from '../agent/list-tools'

/**
 * Token usage information
 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/**
 * Props for the ChatTab component
 */
export interface ChatTabProps {
  apiKey: string
  onUsageUpdate: (usage: TokenUsage) => void
  onClearChat: () => void
}

// Memoized markdown components to prevent recreation on each render
const markdownComponents = {
  code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
    const match = /language-(\w+)/.exec(className || '')
    const isInline = !match && !String(children).includes('\n')
    return isInline ? (
      <code className="inline-code" {...props}>
        {children}
      </code>
    ) : (
      <SyntaxHighlighter style={oneDark} language={match?.[1] || 'text'} PreTag="div">
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    )
  },
  // Make all links open in a new window
  a({ href, children, ...props }: { href?: string; children?: React.ReactNode }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    )
  },
}

/**
 * Streaming message component with deferred updates for smoother rendering
 */
function StreamingMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const deferredContent = useDeferredValue(content)

  return (
    <>
      {deferredContent ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {deferredContent}
        </ReactMarkdown>
      ) : null}
      {isStreaming && <span className="cursor" />}
    </>
  )
}

/**
 * ChatTab component - handles the chat interface
 */
export function ChatTab({ apiKey, onUsageUpdate, onClearChat }: ChatTabProps) {
  // Transport uses getTools() to fetch tools dynamically on each message send
  const transport = useMemo(() => {
    return new GeminiChatTransport({
      apiKey,
      getTools: listTools,
      onUsageUpdate,
    })
  }, [apiKey, onUsageUpdate])

  const { messages, sendMessage, setMessages, stop, error, status } = useChat({
    transport,
  })

  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isLoading = status === 'submitted' || status === 'streaming'

  // Prompt history state (like terminal shell history)
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [savedInput, setSavedInput] = useState('') // Saves current input when navigating history

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when loading completes
  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus()
    }
  }, [isLoading])

  // Handle clear chat from parent
  const handleClear = () => {
    stop()
    setMessages([])
    onClearChat()
  }

  // Expose clear function to parent via callback on mount
  useEffect(() => {
    // Store the clear handler reference for the parent to call
    ;(window as unknown as { __chatClearHandler?: () => void }).__chatClearHandler = handleClear
    return () => {
      delete (window as unknown as { __chatClearHandler?: () => void }).__chatClearHandler
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSend = () => {
    if (!input.trim()) return
    const trimmedInput = input.trim()
    // Add to history (avoid duplicates of the last entry)
    if (promptHistory.length === 0 || promptHistory[promptHistory.length - 1] !== trimmedInput) {
      setPromptHistory((prev) => [...prev, trimmedInput])
    }
    // Reset history navigation state
    setHistoryIndex(-1)
    setSavedInput('')
    sendMessage({ text: trimmedInput })
    setInput('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
      return
    }

    // Handle arrow up/down for history navigation
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // Only handle if cursor is at start (up) or end (down) of input, or input is single line
      const textarea = e.target as HTMLTextAreaElement
      const isAtStart = textarea.selectionStart === 0
      const isAtEnd = textarea.selectionStart === textarea.value.length
      const isSingleLine = !textarea.value.includes('\n')

      if (e.key === 'ArrowUp' && (isAtStart || isSingleLine) && promptHistory.length > 0) {
        e.preventDefault()
        if (historyIndex === -1) {
          // Save current input before navigating history
          setSavedInput(input)
          // Start from the most recent history item
          setHistoryIndex(promptHistory.length - 1)
          setInput(promptHistory[promptHistory.length - 1])
        } else if (historyIndex > 0) {
          // Go to older history
          setHistoryIndex(historyIndex - 1)
          setInput(promptHistory[historyIndex - 1])
        }
      } else if (e.key === 'ArrowDown' && (isAtEnd || isSingleLine) && historyIndex !== -1) {
        e.preventDefault()
        if (historyIndex < promptHistory.length - 1) {
          // Go to newer history
          setHistoryIndex(historyIndex + 1)
          setInput(promptHistory[historyIndex + 1])
        } else {
          // Return to saved input (what user was typing before navigating history)
          setHistoryIndex(-1)
          setInput(savedInput)
        }
      }
    }
  }

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.length === 0 && (
          <div className="welcome-message">
            <h2>Welcome to Agent MCP</h2>
            <p>
              This is an AI chat interface powered by Google Gemini with MCP (Model Context
              Protocol) tools for interacting with external systems.
            </p>
            <p>Start a conversation by typing a message below.</p>
            <p className="welcome-hint">Available tools are listed in the sidebar on the right.</p>
          </div>
        )}

        {messages.map((message, messageIndex) => (
          <div key={message.id}>
            {message.parts.map((part, partIndex) => {
              const isLastPart =
                messageIndex === messages.length - 1 && partIndex === message.parts.length - 1
              const isStreamingPart =
                isLoading && isLastPart && part.type === 'text' && message.role === 'assistant'

              switch (part.type) {
                case 'text':
                  return (
                    <div
                      key={`${message.id}-part-${partIndex}`}
                      className={`message ${message.role}`}
                    >
                      <div className="message-header">
                        <span className="message-role">
                          {message.role === 'user' ? 'You' : 'Assistant'}
                        </span>
                      </div>
                      <div className="message-content markdown-body">
                        <StreamingMessage content={part.text} isStreaming={isStreamingPart} />
                      </div>
                    </div>
                  )
                default:
                  // Handle tool parts (type starts with 'tool-')
                  if (part.type.startsWith('tool-')) {
                    const toolName = part.type.replace('tool-', '')
                    const toolPart = part as {
                      type: string
                      toolCallId: string
                      state: string
                      input?: unknown
                      output?: unknown
                    }
                    return (
                      <div key={`${message.id}-part-${partIndex}`} className="message tool-call">
                        <div className="message-header">
                          <span className="message-role">Tool Call</span>
                        </div>
                        <div className="message-content tool-content">
                          <div className="tool-name">{toolName}</div>
                          <pre className="tool-args">{JSON.stringify(toolPart.input, null, 2)}</pre>
                          {toolPart.state === 'output-available' &&
                            toolPart.output !== undefined && (
                              <>
                                <div className="tool-result-label">Result:</div>
                                <pre className="tool-result-data">
                                  {JSON.stringify(toolPart.output, null, 2)}
                                </pre>
                              </>
                            )}
                        </div>
                      </div>
                    )
                  }
                  return null
              }
            })}
          </div>
        ))}

        {error && (
          <div className="error-message">
            <strong>Error:</strong> {error.message}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="input-container">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message... (Enter to send, Shift+Enter for new line, ↑/↓ for history)"
          disabled={isLoading}
          rows={3}
        />
        <button onClick={handleSend} disabled={isLoading || !input.trim()} className="send-button">
          {isLoading ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
