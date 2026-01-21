import { useCallback, useEffect, useRef, useState } from 'react'

import type { CommandRegistry } from '@coralstack/cmd-ipc'

import { ChannelIDs } from './ipc/channel-ids'
import { CommandIDs, type WebWorkerCommandSchema } from './ipc/command-schema'
import { EventIDs, type WebWorkerEventSchema } from './ipc/event-schema'

interface AppProps {
  registry: CommandRegistry<typeof WebWorkerCommandSchema, typeof WebWorkerEventSchema>
}

interface WorkerStatus {
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

interface Notification {
  id: number
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
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
  // Worker status tracking
  const [workers, setWorkers] = useState<WorkerStatus[]>([
    { id: ChannelIDs.CALC, ready: false, commandCount: 0 },
    { id: ChannelIDs.DATA, ready: false, commandCount: 0 },
    { id: ChannelIDs.CRYPTO, ready: false, commandCount: 0 },
  ])

  // Calc worker state
  const [addA, setAddA] = useState(5)
  const [addB, setAddB] = useState(3)
  const [addResult, setAddResult] = useState<number | null>(null)
  const [mulA, setMulA] = useState(4)
  const [mulB, setMulB] = useState(7)
  const [mulResult, setMulResult] = useState<number | null>(null)
  const [factN, setFactN] = useState(6)
  const [factResult, setFactResult] = useState<number | null>(null)

  // Crypto worker state
  const [hashText, setHashText] = useState('Hello World')
  const [hashAlgo, setHashAlgo] = useState<'SHA-256' | 'SHA-384' | 'SHA-512'>('SHA-256')
  const [hashResult, setHashResult] = useState<string | null>(null)
  const [randomMin, setRandomMin] = useState(1)
  const [randomMax, setRandomMax] = useState(100)
  const [randomResult, setRandomResult] = useState<number | null>(null)
  const [uuidResult, setUuidResult] = useState<string | null>(null)

  // Data worker state
  const [dataUrl, setDataUrl] = useState('https://jsonplaceholder.typicode.com/users')
  const [currentData, setCurrentData] = useState<any[]>([])
  const [filterField, setFilterField] = useState('id')
  const [filterOp, setFilterOp] = useState<'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'>(
    'gt',
  )
  const [filterValue, setFilterValue] = useState('5')
  const [sortField, setSortField] = useState('name')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  // Chain demo state
  const [chainResult, setChainResult] = useState<string | null>(null)
  const [chainRunning, setChainRunning] = useState(false)

  // Event log
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logIdRef = useRef(0)

  // Notifications
  const [notifications, setNotifications] = useState<Notification[]>([])

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

  // Listen for worker ready events
  useEffect(() => {
    const unsubscribe = registry.addEventListener(EventIDs.WORKER_READY, (payload) => {
      setWorkers((prev) =>
        prev.map((w) =>
          w.id === payload.workerId ? { ...w, ready: true, commandCount: payload.commandCount } : w,
        ),
      )
      addLog(payload.workerId, 'in', `Worker ready with ${payload.commandCount} commands`)
    })

    return () => unsubscribe()
  }, [registry, addLog])

  // Listen for data updated events
  useEffect(() => {
    const unsubscribe = registry.addEventListener(EventIDs.DATA_UPDATED, (payload) => {
      addLog('data', 'in', `Data ${payload.operation}: ${payload.count} items`)
      // Refresh data display
      registry.executeCommand(CommandIDs.DATA_GET).then((result) => {
        setCurrentData(result.data)
      })
    })

    return () => unsubscribe()
  }, [registry, addLog])

  // Listen for UI notifications
  useEffect(() => {
    const handler = (event: CustomEvent<{ message: string; type: string }>) => {
      const id = Date.now()
      setNotifications((prev) => [
        ...prev,
        { id, message: event.detail.message, type: event.detail.type as any },
      ])
      // Auto-remove after 3 seconds
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id))
      }, 3000)
    }

    window.addEventListener('ui-notify', handler as EventListener)
    return () => window.removeEventListener('ui-notify', handler as EventListener)
  }, [])

  // Calc handlers
  const handleAdd = async () => {
    addLog('main', 'out', `math.add { a: ${addA}, b: ${addB} }`)
    const result = await registry.executeCommand(CommandIDs.MATH_ADD, { a: addA, b: addB })
    setAddResult(result.result)
    addLog('calc', 'in', `Result: ${result.result}`)
  }

  const handleMultiply = async () => {
    addLog('main', 'out', `math.multiply { a: ${mulA}, b: ${mulB} }`)
    const result = await registry.executeCommand(CommandIDs.MATH_MULTIPLY, { a: mulA, b: mulB })
    setMulResult(result.result)
    addLog('calc', 'in', `Result: ${result.result}`)
  }

  const handleFactorial = async () => {
    addLog('main', 'out', `math.factorial { n: ${factN} }`)
    const result = await registry.executeCommand(CommandIDs.MATH_FACTORIAL, { n: factN })
    setFactResult(result.result)
    addLog('calc', 'in', `Result: ${result.result}`)
  }

  // Crypto handlers
  const handleHash = async () => {
    addLog('main', 'out', `crypto.hash { text: "${hashText}", algorithm: "${hashAlgo}" }`)
    const result = await registry.executeCommand(CommandIDs.CRYPTO_HASH, {
      text: hashText,
      algorithm: hashAlgo,
    })
    setHashResult(result.hash)
    addLog('crypto', 'in', `Hash: ${result.hash.substring(0, 20)}...`)
  }

  const handleRandom = async () => {
    addLog('main', 'out', `crypto.random { min: ${randomMin}, max: ${randomMax} }`)
    const result = await registry.executeCommand(CommandIDs.CRYPTO_RANDOM, {
      min: randomMin,
      max: randomMax,
    })
    setRandomResult(result.value)
    addLog('crypto', 'in', `Random: ${result.value}`)
  }

  const handleUuid = async () => {
    addLog('main', 'out', 'crypto.uuid')
    const result = await registry.executeCommand(CommandIDs.CRYPTO_UUID)
    setUuidResult(result.uuid)
    addLog('crypto', 'in', `UUID: ${result.uuid}`)
  }

  // Data handlers
  const handleFetch = async () => {
    addLog('main', 'out', `data.fetch { url: "${dataUrl}" }`)
    try {
      const result = await registry.executeCommand(CommandIDs.DATA_FETCH, { url: dataUrl })
      if (Array.isArray(result.data)) {
        setCurrentData(result.data)
      }
      addLog('data', 'in', `Fetched ${Array.isArray(result.data) ? result.data.length : 1} items`)
    } catch (error) {
      addLog('data', 'in', `Error: ${error}`)
    }
  }

  const handleFilter = async () => {
    const value = isNaN(Number(filterValue)) ? filterValue : Number(filterValue)
    addLog(
      'main',
      'out',
      `data.filter { field: "${filterField}", op: "${filterOp}", value: ${value} }`,
    )
    const result = await registry.executeCommand(CommandIDs.DATA_FILTER, {
      field: filterField,
      operator: filterOp,
      value,
    })
    setCurrentData(result.data)
    addLog('data', 'in', `Filtered to ${result.count} items`)
  }

  const handleSort = async () => {
    addLog('main', 'out', `data.sort { field: "${sortField}", order: "${sortOrder}" }`)
    const result = await registry.executeCommand(CommandIDs.DATA_SORT, {
      field: sortField,
      order: sortOrder,
    })
    setCurrentData(result.data)
    addLog('data', 'in', `Sorted ${result.data.length} items`)
  }

  // Chain demo - demonstrates cross-worker routing
  const handleChainDemo = async () => {
    setChainRunning(true)
    setChainResult(null)
    addLog('main', 'out', 'Starting chain demo...')

    try {
      // Step 1: Generate random number from crypto worker
      addLog('main', 'out', 'Step 1: crypto.random { min: 1, max: 10 }')
      const randomResult = await registry.executeCommand(CommandIDs.CRYPTO_RANDOM, {
        min: 1,
        max: 10,
      })
      addLog('crypto', 'in', `Random: ${randomResult.value}`)

      // Step 2: Calculate factorial in calc worker
      addLog('main', 'out', `Step 2: math.factorial { n: ${randomResult.value} }`)
      const factResult = await registry.executeCommand(CommandIDs.MATH_FACTORIAL, {
        n: randomResult.value,
      })
      addLog('calc', 'in', `Factorial: ${factResult.result}`)

      // Step 3: Store result in data worker
      addLog('main', 'out', `Step 3: data.store { value: ${factResult.result} }`)
      const storeResult = await registry.executeCommand(CommandIDs.DATA_STORE, {
        value: { random: randomResult.value, factorial: factResult.result },
      })
      addLog('data', 'in', `Stored at index ${storeResult.index}`)

      setChainResult(
        `Random: ${randomResult.value} -> Factorial: ${factResult.result} -> Stored at index ${storeResult.index}`,
      )
    } catch (error) {
      setChainResult(`Error: ${error}`)
      addLog('main', 'in', `Chain error: ${error}`)
    }

    setChainRunning(false)
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
    const channels = registry.listChannels()
    setAllChannels(channels)
    addLog('main', 'out', `Listed ${channels.length} channels`)
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
      {/* Notifications */}
      <div className="notifications">
        {notifications.map((n) => (
          <div key={n.id} className={`notification ${n.type}`}>
            {n.message}
          </div>
        ))}
      </div>

      <header>
        <h1>cmd-ipc Web Workers Demo</h1>
        <a
          href="https://github.com/CoralStackCom/cmd-ipc"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link"
        >
          GitHub
        </a>
      </header>

      {/* Worker Status */}
      <section className="worker-status">
        <h2>Worker Status</h2>
        <div className="status-cards">
          {workers.map((worker) => (
            <div key={worker.id} className={`status-card ${worker.ready ? 'ready' : 'pending'}`}>
              <span className="status-indicator">{worker.ready ? '●' : '○'}</span>
              <span className="worker-name">{worker.id}</span>
              <span className="command-count">{worker.commandCount} commands</span>
            </div>
          ))}
        </div>
      </section>

      <div className="panels">
        {/* Calc Worker Panel */}
        <section className="panel">
          <h2>Calc Worker</h2>

          <div className="command-group">
            <h3>math.add</h3>
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
            <h3>math.multiply</h3>
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
            <h3>math.factorial</h3>
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

        {/* Crypto Worker Panel */}
        <section className="panel">
          <h2>Crypto Worker</h2>

          <div className="command-group">
            <h3>crypto.hash</h3>
            <div className="input-column">
              <input
                type="text"
                value={hashText}
                onChange={(e) => setHashText(e.target.value)}
                placeholder="Text to hash"
              />
              <div className="input-row">
                <select value={hashAlgo} onChange={(e) => setHashAlgo(e.target.value as any)}>
                  <option value="SHA-256">SHA-256</option>
                  <option value="SHA-384">SHA-384</option>
                  <option value="SHA-512">SHA-512</option>
                </select>
                <button onClick={handleHash}>Hash</button>
              </div>
              {hashResult && <code className="hash-result">{hashResult}</code>}
            </div>
          </div>

          <div className="command-group">
            <h3>crypto.random</h3>
            <div className="input-row">
              <span>Min:</span>
              <input
                type="number"
                value={randomMin}
                onChange={(e) => setRandomMin(Number(e.target.value))}
                className="small-input"
              />
              <span>Max:</span>
              <input
                type="number"
                value={randomMax}
                onChange={(e) => setRandomMax(Number(e.target.value))}
                className="small-input"
              />
              <button onClick={handleRandom}>Generate</button>
              {randomResult !== null && <span className="result">= {randomResult}</span>}
            </div>
          </div>

          <div className="command-group">
            <h3>crypto.uuid</h3>
            <div className="input-row">
              <button onClick={handleUuid}>Generate UUID</button>
              {uuidResult && <code className="uuid-result">{uuidResult}</code>}
            </div>
          </div>
        </section>

        {/* Data Worker Panel */}
        <section className="panel">
          <h2>Data Worker</h2>

          <div className="command-group">
            <h3>data.fetch</h3>
            <div className="input-column">
              <input
                type="text"
                value={dataUrl}
                onChange={(e) => setDataUrl(e.target.value)}
                placeholder="URL to fetch"
              />
              <button onClick={handleFetch}>Fetch JSON</button>
            </div>
          </div>

          <div className="command-group">
            <h3>data.filter</h3>
            <div className="input-row">
              <input
                type="text"
                value={filterField}
                onChange={(e) => setFilterField(e.target.value)}
                placeholder="Field"
                className="small-input"
              />
              <select value={filterOp} onChange={(e) => setFilterOp(e.target.value as any)}>
                <option value="eq">=</option>
                <option value="neq">!=</option>
                <option value="gt">&gt;</option>
                <option value="gte">&gt;=</option>
                <option value="lt">&lt;</option>
                <option value="lte">&lt;=</option>
                <option value="contains">contains</option>
              </select>
              <input
                type="text"
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                placeholder="Value"
                className="small-input"
              />
              <button onClick={handleFilter}>Filter</button>
            </div>
          </div>

          <div className="command-group">
            <h3>data.sort</h3>
            <div className="input-row">
              <input
                type="text"
                value={sortField}
                onChange={(e) => setSortField(e.target.value)}
                placeholder="Field"
                className="small-input"
              />
              <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as any)}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <button onClick={handleSort}>Sort</button>
            </div>
          </div>

          <div className="data-preview">
            <h4>Current Data ({currentData.length} items)</h4>
            <pre>{JSON.stringify(currentData.slice(0, 5), null, 2)}</pre>
            {currentData.length > 5 && (
              <span className="more">...and {currentData.length - 5} more</span>
            )}
          </div>
        </section>

        {/* Chain Demo Panel */}
        <section className="panel chain-panel">
          <h2>Cross-Worker Chain Demo</h2>
          <p className="description">Demonstrates command routing across multiple workers:</p>
          <ol className="chain-steps">
            <li>Crypto worker generates a random number (1-10)</li>
            <li>Calc worker computes the factorial</li>
            <li>Data worker stores the result</li>
          </ol>
          <button onClick={handleChainDemo} disabled={chainRunning} className="chain-button">
            {chainRunning ? 'Running...' : 'Run Chain Demo'}
          </button>
          {chainResult && <div className="chain-result">{chainResult}</div>}
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
