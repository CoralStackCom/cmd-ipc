import { useCallback, useEffect, useRef, useState } from 'react'

import type { CommandRegistry } from '@coralstack/cmd-ipc'

import type { CommandSchema } from './schemas'
import { CommandIDs } from './schemas'

interface AppProps {
  registry: CommandRegistry<typeof CommandSchema>
}

interface ChannelStatus {
  id: string
  ready: boolean
  commandCount: number
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

export default function App({ registry }: AppProps) {
  // Channel status tracking
  const [channels, setChannels] = useState<ChannelStatus[]>([
    { id: 'cf-worker', ready: false, commandCount: 0 },
  ])

  // Remote Math commands state
  const [addA, setAddA] = useState(5)
  const [addB, setAddB] = useState(3)
  const [addResult, setAddResult] = useState<number | null>(null)

  const [mulA, setMulA] = useState(4)
  const [mulB, setMulB] = useState(7)
  const [mulResult, setMulResult] = useState<number | null>(null)

  const [factN, setFactN] = useState(6)
  const [factResult, setFactResult] = useState<number | null>(null)

  // Local String commands state
  const [reverseText, setReverseText] = useState('Hello World')
  const [reverseResult, setReverseResult] = useState<{ result: string; length: number } | null>(
    null,
  )

  const [uppercaseText, setUppercaseText] = useState('hello world')
  const [uppercaseResult, setUppercaseResult] = useState<string | null>(null)

  // Local Array command state
  const [sumNumbers, setSumNumbers] = useState('1, 2, 3, 4, 5')
  const [sumResult, setSumResult] = useState<{ result: number; count: number } | null>(null)

  // Event log
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logIdRef = useRef(0)

  // Debug panel
  const [showDebug, setShowDebug] = useState(true)
  const [allCommands, setAllCommands] = useState<CommandInfo[]>([])
  const [expandedCommands, setExpandedCommands] = useState<Set<string>>(new Set())
  const [allChannels, setAllChannels] = useState<string[]>([])

  const addLog = useCallback(
    (source: string, direction: 'in' | 'out', message: string) => {
      const id = ++logIdRef.current
      setLogs((prev) => [
        { id, timestamp: new Date(), source, direction, message },
        ...prev.slice(0, 49), // Keep last 50 entries
      ])
    },
    [logIdRef],
  )

  // Check channel status on mount
  useEffect(() => {
    const checkChannelStatus = () => {
      const channelList = registry.listChannels()
      const commandList = registry.listCommands()
      const remoteCommands = commandList.filter((cmd) => !cmd.isLocal)
      const localCommands = commandList.filter((cmd) => cmd.isLocal)

      setChannels([
        {
          id: 'cf-worker',
          ready: channelList.includes('cf-worker'),
          commandCount: remoteCommands.length,
        },
      ])

      if (channelList.includes('cf-worker')) {
        addLog(
          'cf-worker',
          'in',
          `Channel ready with ${remoteCommands.length} remote, ${localCommands.length} local commands`,
        )
      }
    }

    // Check immediately and after a short delay (for async channel registration)
    checkChannelStatus()
    const timeout = setTimeout(checkChannelStatus, 1000)

    return () => clearTimeout(timeout)
  }, [registry, addLog])

  // Remote command handlers (execute on Cloudflare Worker)
  const handleAdd = async () => {
    addLog('main', 'out', `${CommandIDs.CLOUD_MATH_ADD} { a: ${addA}, b: ${addB} }`)
    try {
      const result = await registry.executeCommand(CommandIDs.CLOUD_MATH_ADD, { a: addA, b: addB })
      setAddResult(result.result)
      addLog('cf-worker', 'in', `Result: ${result.result}`)
    } catch (error) {
      addLog('cf-worker', 'in', `Error: ${error}`)
    }
  }

  const handleMultiply = async () => {
    addLog('main', 'out', `${CommandIDs.CLOUD_MATH_MULTIPLY} { a: ${mulA}, b: ${mulB} }`)
    try {
      const result = await registry.executeCommand(CommandIDs.CLOUD_MATH_MULTIPLY, {
        a: mulA,
        b: mulB,
      })
      setMulResult(result.result)
      addLog('cf-worker', 'in', `Result: ${result.result}`)
    } catch (error) {
      addLog('cf-worker', 'in', `Error: ${error}`)
    }
  }

  const handleFactorial = async () => {
    addLog('main', 'out', `${CommandIDs.CLOUD_MATH_FACTORIAL} { n: ${factN} }`)
    try {
      const result = await registry.executeCommand(CommandIDs.CLOUD_MATH_FACTORIAL, { n: factN })
      setFactResult(result.result)
      addLog('cf-worker', 'in', `Result: ${result.result}`)
    } catch (error) {
      addLog('cf-worker', 'in', `Error: ${error}`)
    }
  }

  // Local command handlers (execute in browser)
  const handleReverse = async () => {
    addLog('main', 'out', `${CommandIDs.STRING_REVERSE} { text: "${reverseText}" }`)
    try {
      const result = await registry.executeCommand(CommandIDs.STRING_REVERSE, { text: reverseText })
      setReverseResult(result)
      addLog('local', 'in', `Result: "${result.result}" (length: ${result.length})`)
    } catch (error) {
      addLog('local', 'in', `Error: ${error}`)
    }
  }

  const handleUppercase = async () => {
    addLog('main', 'out', `${CommandIDs.STRING_UPPERCASE} { text: "${uppercaseText}" }`)
    try {
      const result = await registry.executeCommand(CommandIDs.STRING_UPPERCASE, {
        text: uppercaseText,
      })
      setUppercaseResult(result.result)
      addLog('local', 'in', `Result: "${result.result}"`)
    } catch (error) {
      addLog('local', 'in', `Error: ${error}`)
    }
  }

  const handleSum = async () => {
    const numbers = sumNumbers
      .split(',')
      .map((n) => parseFloat(n.trim()))
      .filter((n) => !isNaN(n))
    addLog('main', 'out', `${CommandIDs.ARRAY_SUM} { numbers: [${numbers.join(', ')}] }`)
    try {
      const result = await registry.executeCommand(CommandIDs.ARRAY_SUM, { numbers })
      setSumResult(result)
      addLog('local', 'in', `Result: ${result.result} (${result.count} numbers)`)
    } catch (error) {
      addLog('local', 'in', `Error: ${error}`)
    }
  }

  // Debug handlers
  const handleListCommands = () => {
    const commands = registry.listCommands()
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
    addLog('main', 'out', `Listed ${commands.length} commands`)
  }

  const handleListChannels = () => {
    const channelList = registry.listChannels()
    setAllChannels(channelList)
    addLog('main', 'out', `Listed ${channelList.length} channels`)
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
        <h1>cmd-ipc Cloudflare Worker Demo</h1>
        <a
          href="https://github.com/CoralStackCom/cmd-ipc"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link"
        >
          GitHub
        </a>
      </header>

      {/* Channel Status */}
      <section className="channel-status">
        <h2>Channel Status</h2>
        <div className="status-cards">
          {channels.map((channel) => (
            <div key={channel.id} className={`status-card ${channel.ready ? 'ready' : 'pending'}`}>
              <span className="status-indicator">{channel.ready ? '●' : '○'}</span>
              <span className="channel-name">{channel.id}</span>
              <span className="command-count">{channel.commandCount} remote commands</span>
            </div>
          ))}
        </div>
      </section>

      <div className="panels">
        {/* Remote Math Operations Panel */}
        <section className="panel">
          <h2>Remote Commands</h2>
          <p className="panel-description">
            Execute on Cloudflare Worker via HTTPChannel (cloud.*)
          </p>

          <div className="command-group">
            <h3>{CommandIDs.CLOUD_MATH_ADD}</h3>
            <div className="input-row">
              <input
                type="number"
                value={addA}
                onChange={(e) => setAddA(Number(e.target.value))}
                className="small-input"
              />
              <span>+</span>
              <input
                type="number"
                value={addB}
                onChange={(e) => setAddB(Number(e.target.value))}
                className="small-input"
              />
              <button onClick={handleAdd}>Calculate</button>
              {addResult !== null && <span className="result">= {addResult}</span>}
            </div>
          </div>

          <div className="command-group">
            <h3>{CommandIDs.CLOUD_MATH_MULTIPLY}</h3>
            <div className="input-row">
              <input
                type="number"
                value={mulA}
                onChange={(e) => setMulA(Number(e.target.value))}
                className="small-input"
              />
              <span>x</span>
              <input
                type="number"
                value={mulB}
                onChange={(e) => setMulB(Number(e.target.value))}
                className="small-input"
              />
              <button onClick={handleMultiply}>Calculate</button>
              {mulResult !== null && <span className="result">= {mulResult}</span>}
            </div>
          </div>

          <div className="command-group">
            <h3>{CommandIDs.CLOUD_MATH_FACTORIAL}</h3>
            <div className="input-row">
              <span>n =</span>
              <input
                type="number"
                value={factN}
                onChange={(e) => setFactN(Number(e.target.value))}
                min={0}
                max={170}
                className="small-input"
              />
              <button onClick={handleFactorial}>Calculate</button>
              {factResult !== null && <span className="result">= {factResult}</span>}
            </div>
          </div>
        </section>

        {/* Local Commands Panel */}
        <section className="panel">
          <h2>Local Commands</h2>
          <p className="panel-description">Execute locally in browser (local.*)</p>

          <div className="command-group">
            <h3>{CommandIDs.STRING_REVERSE}</h3>
            <div className="input-column">
              <div className="input-row">
                <input
                  type="text"
                  value={reverseText}
                  onChange={(e) => setReverseText(e.target.value)}
                  placeholder="Enter text to reverse"
                  className="wide-input"
                />
                <button onClick={handleReverse}>Reverse</button>
              </div>
              {reverseResult !== null && (
                <span className="result">
                  = &quot;{reverseResult.result}&quot; ({reverseResult.length} chars)
                </span>
              )}
            </div>
          </div>

          <div className="command-group">
            <h3>{CommandIDs.STRING_UPPERCASE}</h3>
            <div className="input-column">
              <div className="input-row">
                <input
                  type="text"
                  value={uppercaseText}
                  onChange={(e) => setUppercaseText(e.target.value)}
                  placeholder="Enter text"
                  className="wide-input"
                />
                <button onClick={handleUppercase}>Uppercase</button>
              </div>
              {uppercaseResult !== null && (
                <span className="result">= &quot;{uppercaseResult}&quot;</span>
              )}
            </div>
          </div>

          <div className="command-group">
            <h3>{CommandIDs.ARRAY_SUM}</h3>
            <div className="input-column">
              <div className="input-row">
                <input
                  type="text"
                  value={sumNumbers}
                  onChange={(e) => setSumNumbers(e.target.value)}
                  placeholder="Enter numbers (comma separated)"
                  className="wide-input"
                />
                <button onClick={handleSum}>Sum</button>
              </div>
              {sumResult !== null && (
                <span className="result">
                  = {sumResult.result} ({sumResult.count} numbers)
                </span>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* How It Works Panel */}
      <section className="info-panel">
        <h2>How It Works</h2>
        <p className="description">
          This demo shows how to merge local and remote command schemas for full type safety:
        </p>
        <ol className="info-steps">
          <li>
            <strong>Local Schema</strong>: Define commands that run in the browser with{' '}
            <code>LocalCommandSchema</code>
          </li>
          <li>
            <strong>Remote Schema</strong>: Generate schemas from remote worker via CLI:{' '}
            <code>yarn generate-schema</code>
          </li>
          <li>
            <strong>Merge Schemas</strong>: Combine both for unified type-safe command execution
          </li>
        </ol>
        <pre>{`const MergedSchema = {
  ...LocalCommandSchema,   // string.*, array.*
  ...CloudCommandSchema,   // cloud.math.* (generated)
} as const`}</pre>
      </section>

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
