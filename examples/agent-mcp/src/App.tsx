import { useChat } from '@ai-sdk/react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'

import { GeminiChatTransport } from './agent/gemini-chat-transport'
import { listTools } from './agent/list-tools'

interface ToolInfo {
  name: string
  description: string
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
}

// Streaming message component with deferred updates for smoother rendering
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

export default function App() {
  const [apiKey, setApiKey] = useState<string | undefined>(undefined)
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  const transport = useMemo(() => {
    const tools = listTools()
    return new GeminiChatTransport({
      apiKey,
      tools,
      onUsageUpdate: (newUsage) => setUsage({ ...newUsage }),
    })
  }, [apiKey])
  const [apiKeyInput, setApiKeyInput] = useState(transport.apiKey || '')
  const availableTools: ToolInfo[] = useMemo(() => {
    const tools = transport?.tools ?? {}
    return Object.entries(tools).map(([name, tool]) => ({
      name,
      description: (tool as { description?: string })?.description ?? 'No description',
    }))
  }, [transport])
  const { messages, sendMessage, setMessages, stop, error, status } = useChat({
    transport,
  })

  const [input, setInput] = useState('')
  const [showTools, setShowTools] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isLoading = status === 'submitted' || status === 'streaming'
  const isConfigured = Boolean(apiKey)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when configured or when loading completes
  useEffect(() => {
    if (isConfigured && !isLoading) {
      inputRef.current?.focus()
    }
  }, [isConfigured, isLoading])

  const handleSend = () => {
    if (!input.trim()) return
    sendMessage({ text: input.trim() })
    setInput('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // API Key Configuration Screen
  if (!isConfigured) {
    return (
      <div className="app">
        <header>
          <h1>CMD-IPC Agent MCP Example</h1>
        </header>

        <main className="config-container">
          <div className="config-card">
            <h2>Configure API Key</h2>
            <p>
              Enter your Google AI API key to start chatting with Gemini.
              <br />
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get an API key here
              </a>
            </p>

            <div className="api-key-input">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  setApiKey(apiKeyInput)
                }}
              >
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      setApiKey(apiKeyInput)
                    }
                  }}
                  placeholder="Enter your Google AI API key"
                  autoFocus
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore="true"
                  data-form-type="other"
                />
                <button type="submit">Start Chatting</button>
              </form>
            </div>

            {error && <div className="error-message">{error.message}</div>}

            <p className="security-note">
              Your API key is stored only in browser memory and is never sent to any server other
              than Google&apos;s API.
            </p>

            <p className="env-hint">
              Tip: Create a <code>.env</code> file with <code>VITE_GOOGLE_AI_API_KEY=your_key</code>{' '}
              to auto-fill this field.
            </p>
          </div>
        </main>

        <footer>
          <p>
            Powered by{' '}
            <a href="https://ai.google.dev/" target="_blank" rel="noopener noreferrer">
              Google Gemini
            </a>
          </p>
        </footer>
      </div>
    )
  }

  // Chat Interface
  return (
    <div className="app">
      <header>
        <h1>CMD-IPC Agent MCP Example</h1>
        <div className="header-actions">
          <span className="model-badge">Gemini 2.0 Flash</span>
          <button
            onClick={() => {
              stop()
              setMessages([])
            }}
            className="clear-button"
          >
            Clear Chat
          </button>
          <button onClick={() => setApiKey(undefined)} className="clear-button">
            Reset API Key
          </button>
          <a
            href="https://github.com/CoralStackCom/cmd-ipc"
            target="_blank"
            rel="noopener noreferrer"
            className="github-button"
          >
            GitHub
          </a>
        </div>
      </header>

      <main className="chat-container">
        <div className="messages">
          {messages.length === 0 && (
            <div className="welcome-message">
              <h2>Welcome to Agent MCP</h2>
              <p>
                This is an AI chat interface powered by Google Gemini with MCP (Model Context
                Protocol) tools for interacting with external systems.
              </p>
              <p>Start a conversation by typing a message below.</p>

              {availableTools.length > 0 && (
                <div className="tools-panel">
                  <button
                    className="tools-toggle"
                    onClick={() => setShowTools(!showTools)}
                    type="button"
                  >
                    {showTools ? 'Hide' : 'Show'} Available Tools ({availableTools.length})
                  </button>
                  {showTools && (
                    <div className="tools-list">
                      {availableTools.map((tool) => (
                        <div key={tool.name} className="tool-item">
                          <div className="tool-item-name">{tool.name}</div>
                          <div className="tool-item-description">{tool.description}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
                            <pre className="tool-args">
                              {JSON.stringify(toolPart.input, null, 2)}
                            </pre>
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
            placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
            disabled={isLoading}
            rows={3}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="send-button"
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </main>

      <footer>
        <div className="token-usage">
          <span>Input Tokens: {usage.inputTokens.toLocaleString()}</span>
          <span>Output Tokens: {usage.outputTokens.toLocaleString()}</span>
          <span>Total Tokens: {usage.totalTokens.toLocaleString()}</span>
        </div>
        <p>
          Powered by{' '}
          <a href="https://ai.google.dev/" target="_blank" rel="noopener noreferrer">
            Google Gemini
          </a>
        </p>
      </footer>
    </div>
  )
}
