import { useCallback, useEffect, useState } from 'react'

import { ChatTab, type TokenUsage } from './components/ChatTab'
import { MCPServersTab } from './components/MCPServersTab'
import { ToolsSidebar } from './components/ToolsSidebar'
import { writeOAuthCallback } from './utils/oauth-popup'

type TabType = 'chat' | 'mcp-servers'

/**
 * Handle OAuth callback if this page was opened as a redirect.
 * Sends the authorization code back to the opener window and closes.
 *
 * Uses two methods to communicate with the opener:
 * 1. postMessage (primary) - works when window.opener is available
 * 2. localStorage (fallback) - works when opener is lost due to cross-origin redirects
 */
function handleOAuthCallback(): boolean {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')
  const state = params.get('state')

  // Check if this is an OAuth callback (has code or error in URL params)
  if (code || error) {
    const callbackData = {
      code: code || undefined,
      error: error || undefined,
      state: state || undefined,
    }

    // Try postMessage first (preferred method)
    if (window.opener) {
      window.opener.postMessage(
        {
          type: 'mcp-oauth-callback',
          ...callbackData,
        },
        window.location.origin,
      )
    }

    // Always write to localStorage as fallback
    // (handles case where window.opener is lost due to cross-origin redirects)
    writeOAuthCallback(callbackData)

    // Close this popup/redirect window after a brief delay
    setTimeout(() => window.close(), 200)
    return true
  }

  return false
}

export default function App() {
  const [apiKey, setApiKey] = useState<string | undefined>(undefined)
  const [apiKeyInput, setApiKeyInput] = useState(import.meta.env.VITE_GOOGLE_AI_API_KEY || '')
  const [usage, setUsage] = useState<TokenUsage>({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  })
  const [activeTab, setActiveTab] = useState<TabType>('chat')
  // Counter to trigger UI updates when tools change (for the tools list display)
  const [toolsVersion, setToolsVersion] = useState(0)

  const isConfigured = Boolean(apiKey)

  // Handle OAuth callback on mount (if this is a callback redirect)
  useEffect(() => {
    handleOAuthCallback()
  }, [])

  // Callback when MCP tools change - trigger re-render to update tools display
  const handleToolsChanged = useCallback(() => {
    setToolsVersion((v) => v + 1)
  }, [])

  // Callback for usage updates from ChatTab
  const handleUsageUpdate = useCallback((newUsage: TokenUsage) => {
    setUsage({ ...newUsage })
  }, [])

  // Clear chat handler
  const handleClearChat = useCallback(() => {
    // Chat is cleared inside ChatTab, this is just for any App-level cleanup if needed
  }, [])

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

  // Main Chat Interface
  return (
    <div className="app">
      <header>
        <h1>CMD-IPC Agent MCP Example</h1>
        <div className="header-actions">
          <span className="model-badge">Gemini 2.0 Flash</span>
          <button
            onClick={() => {
              // Call the chat clear handler if available
              const handler = (window as unknown as { __chatClearHandler?: () => void })
                .__chatClearHandler
              handler?.()
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

      {/* Main content area with sidebar */}
      <div className="main-with-sidebar">
        {/* Left panel: tabs + content */}
        <div className="main-panel">
          {/* Tab Navigation */}
          <nav className="tab-navigation">
            <button
              className={`tab-button ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              Chat
            </button>
            <button
              className={`tab-button ${activeTab === 'mcp-servers' ? 'active' : ''}`}
              onClick={() => setActiveTab('mcp-servers')}
            >
              MCP Servers
            </button>
          </nav>

          {/* MCP Servers Tab */}
          <div className={`mcp-container ${activeTab === 'mcp-servers' ? '' : 'hidden'}`}>
            <MCPServersTab onToolsChanged={handleToolsChanged} />
          </div>

          {/* Chat Tab - always mounted to preserve history */}
          {apiKey && (
            <div className={`chat-tab-wrapper ${activeTab === 'chat' ? '' : 'hidden'}`}>
              <ChatTab
                apiKey={apiKey}
                onUsageUpdate={handleUsageUpdate}
                onClearChat={handleClearChat}
              />
            </div>
          )}
        </div>

        {/* Right sidebar: always visible */}
        <ToolsSidebar toolsVersion={toolsVersion} />
      </div>

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
