import { useCallback, useEffect, useRef, useState } from 'react'

import { AppCommandIDs, AppEventIDs, ChannelIDs, CommandClient } from '@examples/electron-core'

interface ProcessStatus {
  id: string
  ready: boolean
  commandCount: number
  direct: boolean
}

interface LogEntry {
  id: number
  timestamp: Date
  source: string
  direction: 'in' | 'out'
  message: string
}

interface CommandInfo {
  id: string
  description?: string
  isLocal: boolean
  isPrivate: boolean
  channelId?: string
  requestSchema?: object
  responseSchema?: object
}

/**
 * Main Application Component
 */
export default function App() {
  // Process status tracking
  const [processes, setProcesses] = useState<ProcessStatus[]>([
    { id: ChannelIDs.MAIN, ready: false, commandCount: 0, direct: true },
    { id: ChannelIDs.WORKER, ready: false, commandCount: 0, direct: true },
    { id: ChannelIDs.SANDBOX, ready: false, commandCount: 0, direct: false },
  ])

  // Local App state
  const [count, setCount] = useState<number>(0)
  const registeredRef = useRef<boolean>(false)

  // Worker state
  const [greetName, setGreetName] = useState('World')
  const [greetResult, setGreetResult] = useState<string | null>(null)

  // Sandbox state
  const [apiUrl, setApiUrl] = useState('https://api.angelfish.app/v1/openapi.json')
  const [apiResult, setApiResult] = useState<string | null>(null)

  // Main state
  const [notifyTitle, setNotifyTitle] = useState('Test Notification')
  const [notifyBody, setNotifyBody] = useState('This is a test notification from the app.')

  // Event log
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logIdRef = useRef(0)

  // Debug panel
  const [showDebug, setShowDebug] = useState(true)
  const [allCommands, setAllCommands] = useState<CommandInfo[]>([])
  const [expandedCommands, setExpandedCommands] = useState<Set<string>>(new Set())
  const [allChannels, setAllChannels] = useState<string[]>([])

  const addLog = useCallback((source: string, direction: 'in' | 'out', message: string) => {
    const id = ++logIdRef.current
    setLogs((prev) => [
      { id, timestamp: new Date(), source, direction, message },
      ...prev.slice(0, 49),
    ])
  }, [])

  const incrementCounter = useCallback(() => {
    setCount((prevCount) => prevCount + 1)
  }, [])

  // Initialize and listen for events
  useEffect(() => {
    if (count) {
      CommandClient.emitEvent(AppEventIDs.COUNTER_CHANGED, { count })
      addLog('app', 'out', `counter.changed: ${count}`)
    }

    if (!registeredRef.current) {
      // Register local command
      CommandClient.registerCommand(AppCommandIDs.INCREMENT_COUNTER, async () => {
        incrementCounter()
        return { count }
      }).catch((error) => {
        addLog('app', 'in', `Error registering command: ${error}`)
      })

      // Listen for test events
      CommandClient.addEventListener(AppEventIDs.MAIN_TEST_EVENT, (event) => {
        addLog('main', 'in', `main.test.event: ${JSON.stringify(event.payload)}`)
      })

      // Listen for counter changes from other processes
      CommandClient.addEventListener(AppEventIDs.COUNTER_CHANGED, (event) => {
        addLog('app', 'in', `counter.changed: ${event.count}`)
      })

      // Update process status after a short delay
      setTimeout(() => {
        const channels = CommandClient.listChannels()
        const commands = CommandClient.listCommands()

        setProcesses((prev) =>
          prev.map((p) => {
            const isReady = channels.includes(p.id)
            const cmdCount = commands.filter(
              (c) => !c.isLocal && (c as any).channelId === p.id,
            ).length
            return { id: p.id, direct: p.direct, ready: isReady, commandCount: cmdCount }
          }),
        )
      }, 500)

      registeredRef.current = true
    }
  }, [count, incrementCounter, addLog])

  // Worker handlers
  const handleHelloWorld = async () => {
    addLog('app', 'out', `hello.world { name: "${greetName}" }`)
    try {
      const response = await CommandClient.executeCommand(AppCommandIDs.HELLO_WORLD, {
        name: greetName,
      })
      setGreetResult(response.message)
      addLog('worker', 'in', `Result: ${response.message}`)
    } catch (error) {
      addLog('worker', 'in', `Error: ${error}`)
    }
  }

  // Sandbox handlers
  const handleCallApi = async () => {
    addLog('app', 'out', `call.api { url: "${apiUrl}" }`)
    try {
      const response = await CommandClient.executeCommand(AppCommandIDs.CALL_API, { url: apiUrl })
      const preview = JSON.stringify(response.data).substring(0, 100)
      setApiResult(preview + (preview.length >= 100 ? '...' : ''))
      addLog('sandbox', 'in', `Result: ${preview.substring(0, 50)}...`)
    } catch (error) {
      setApiResult(`Error: ${error}`)
      addLog('sandbox', 'in', `Error: ${error}`)
    }
  }

  // Main handlers
  const handleShowNotification = async () => {
    addLog('app', 'out', `show.notification { title: "${notifyTitle}" }`)
    try {
      await CommandClient.executeCommand(AppCommandIDs.SHOW_NOTIFICATION, {
        title: notifyTitle,
        body: notifyBody,
      })
      addLog('main', 'in', 'Notification shown')
    } catch (error) {
      addLog('main', 'in', `Error: ${error}`)
    }
  }

  const handleOpenWebsite = async (url: string) => {
    addLog('app', 'out', `open.website { url: "${url}" }`)
    try {
      await CommandClient.executeCommand(AppCommandIDs.OPEN_WEBSITE, {
        url,
      })
      addLog('main', 'in', 'Website opened')
    } catch (error) {
      addLog('main', 'in', `Error: ${error}`)
    }
  }

  // Debug handlers
  const handleListCommands = () => {
    const commands = CommandClient.listCommands()
    setAllCommands(
      commands.map((cmd) => ({
        id: cmd.id,
        description: (cmd as any).description,
        isLocal: cmd.isLocal,
        isPrivate: cmd.id.startsWith('_'),
        channelId: !cmd.isLocal ? (cmd as any).channelId : undefined,
        requestSchema: (cmd as any).schema?.request,
        responseSchema: (cmd as any).schema?.response,
      })),
    )
    addLog('app', 'out', `Listed ${commands.length} commands`)
  }

  const handleListChannels = () => {
    const channels = CommandClient.listChannels()
    setAllChannels(channels)
    addLog('app', 'out', `Listed ${channels.length} channels`)
  }

  const toggleCommandExpanded = (id: string) => {
    setExpandedCommands((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className="app">
      <header>
        <h1>cmd-ipc Electron Demo</h1>
        <button
          onClick={() => handleOpenWebsite('https://github.com/CoralStackCom/cmd-ipc')}
          className="github-link"
        >
          GitHub
        </button>
      </header>

      {/* Process Status */}
      <section className="process-status">
        <h2>Process Status</h2>
        <div className="status-cards">
          {processes.map((process) => (
            <div
              key={process.id}
              className={`status-card ${process.direct ? (process.ready ? 'ready' : 'pending') : 'indirect'}`}
            >
              <span className="status-indicator">
                {process.direct ? (process.ready ? '●' : '○') : '?'}
              </span>
              <span className="process-name">{process.id}</span>
              {process.direct && (
                <span className="command-count">{process.commandCount} commands</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="panels">
        {/* Local App Panel */}
        <section className="panel">
          <h2>Local App</h2>

          <div className="command-group">
            <h3>increment.counter</h3>
            <div className="input-row">
              <span className="counter-display">{count}</span>
              <button onClick={incrementCounter}>Increment</button>
            </div>
            <p className="description">Increments local counter and emits counter.changed event</p>
          </div>
        </section>

        {/* Worker Panel */}
        <section className="panel">
          <h2>Worker Process</h2>

          <div className="command-group">
            <h3>hello.world</h3>
            <div className="input-column">
              <div className="input-row">
                <span>Name:</span>
                <input
                  type="text"
                  value={greetName}
                  onChange={(e) => setGreetName(e.target.value)}
                  placeholder="Enter name"
                />
              </div>
              <button onClick={handleHelloWorld}>Send Greeting</button>
              {greetResult && <div className="result">{greetResult}</div>}
            </div>
          </div>
        </section>

        {/* Sandbox Panel */}
        <section className="panel">
          <h2>Sandbox Process</h2>

          <div className="command-group">
            <h3>call.api</h3>
            <div className="input-column">
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="API URL"
              />
              <button onClick={handleCallApi}>Fetch API</button>
              {apiResult && <code className="api-result">{apiResult}</code>}
            </div>
            <p className="description">
              Makes HTTP requests from sandboxed renderer process. Only requests to
              api.angelfish.app and auth.angelfish.app are allowed in the Sandbox process. Try
              making a call to another domain and you should see an error.
            </p>
          </div>
        </section>

        {/* Main Panel */}
        <section className="panel">
          <h2>Main Process</h2>

          <div className="command-group">
            <h3>show.notification</h3>
            <div className="input-column">
              <input
                type="text"
                value={notifyTitle}
                onChange={(e) => setNotifyTitle(e.target.value)}
                placeholder="Title"
              />
              <input
                type="text"
                value={notifyBody}
                onChange={(e) => setNotifyBody(e.target.value)}
                placeholder="Body"
              />
              <button onClick={handleShowNotification}>Show Notification</button>
            </div>
          </div>

          <div className="command-group">
            <h3>open.website</h3>
            <button onClick={() => handleOpenWebsite('https://www.coralstack.com')}>
              Open CoralStack Website
            </button>
          </div>
        </section>
      </div>

      {/* Debug Panel */}
      <section className="debug-panel">
        <div className="debug-header" onClick={() => setShowDebug(!showDebug)}>
          <h2>Debug Panel</h2>
          <button className="toggle-button">{showDebug ? 'Collapse' : 'Expand'}</button>
        </div>

        {showDebug && (
          <div className="debug-content">
            <div className="debug-buttons">
              <button onClick={handleListCommands}>List All Commands</button>
              <button onClick={handleListChannels}>List Channels</button>
            </div>

            {allChannels.length > 0 && (
              <div className="commands-list">
                <div className="list-header">
                  <h4>Registered Channels ({allChannels.length})</h4>
                  <button className="close-btn" onClick={() => setAllChannels([])}>
                    ×
                  </button>
                </div>
                {allChannels.map((channel) => (
                  <div key={channel} className="channel-commands">
                    <strong>{channel}</strong>
                  </div>
                ))}
              </div>
            )}

            {allCommands.length > 0 && (
              <div className="commands-list">
                <div className="list-header">
                  <h4>Registered Commands ({allCommands.length})</h4>
                  <button className="close-btn" onClick={() => setAllCommands([])}>
                    ×
                  </button>
                </div>
                {allCommands.map((cmd) => {
                  const isExpanded = expandedCommands.has(cmd.id)
                  return (
                    <div key={cmd.id} className={`command-card ${isExpanded ? 'expanded' : ''}`}>
                      <div
                        className="command-card-header"
                        onClick={() => toggleCommandExpanded(cmd.id)}
                      >
                        <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                        <strong className="command-id">{cmd.id}</strong>
                        <div className="command-badges">
                          <span className={`badge ${cmd.isLocal ? 'local' : 'remote'}`}>
                            {cmd.isLocal ? 'local' : cmd.channelId}
                          </span>
                          {cmd.isPrivate && <span className="badge private">private</span>}
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="command-card-content">
                          {cmd.description && (
                            <p className="command-description">{cmd.description}</p>
                          )}
                          {(cmd.requestSchema || cmd.responseSchema) && (
                            <div className="command-schemas">
                              {cmd.requestSchema && (
                                <div className="schema-block">
                                  <span className="schema-label">Request:</span>
                                  <pre>{JSON.stringify(cmd.requestSchema, null, 2)}</pre>
                                </div>
                              )}
                              {cmd.responseSchema && (
                                <div className="schema-block">
                                  <span className="schema-label">Response:</span>
                                  <pre>{JSON.stringify(cmd.responseSchema, null, 2)}</pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="log-container">
              <h4>Message Log</h4>
              <div className="log-entries">
                {logs.map((log) => (
                  <div key={log.id} className={`log-entry ${log.direction}`}>
                    <span className="log-time">
                      {log.timestamp.toLocaleTimeString('en-US', { hour12: false })}
                    </span>
                    <span className="log-source">[{log.source}]</span>
                    <span className="log-direction">{log.direction === 'out' ? '→' : '←'}</span>
                    <span className="log-message">{log.message}</span>
                  </div>
                ))}
                {logs.length === 0 && (
                  <div className="log-empty">No messages yet. Try executing a command!</div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
