import { CommandRegistry } from '../../src/registry/command-registry'
import { MessageType } from '../../src/registry/command-message-schemas'
import { MockChannel } from './mock-channel'
import { CaptureBag, match } from './matchers'
import { BEHAVIOR_DIR, listVectors, readJson } from './spec-paths'

/* eslint-disable @typescript-eslint/no-explicit-any */

type VectorStep =
  | { direction: 'inbound'; from: string; message: any; description?: string }
  | { direction: 'outbound'; to: string; expected: any; description?: string }
  | { direction: 'assert-no-outbound'; to: string; description?: string }
  | { direction: 'local-call'; trigger: LocalCallTrigger; description?: string }
  | {
      direction: 'local-result'
      expected?: any
      expectedError?: { code: string; message?: any }
      description?: string
    }
  | {
      direction: 'assert-local-listener'
      eventId: string
      invocations: number
      lastPayload?: any
      description?: string
    }
  | { direction: 'close-channel'; channel: string; description?: string }

type LocalCallTrigger =
  | { executeCommand: [string, any?] }
  | { emitEvent: [string, any?] }
  | { registerCommand: [string] }
  | { listCommands: [] }

type CommandSpec = {
  id: string
  description?: string
  returns?: any
}

type PeerSpec = {
  channelId: string
  commandImplementations?: CommandSpec[]
}

type BehaviorVector = {
  description: string
  setup: {
    registry: {
      id: string
      routerChannel?: string
      localCommands?: CommandSpec[]
      localEventListeners?: string[]
    }
    peers: PeerSpec[]
  }
  steps: VectorStep[]
}

/** Tiny expression evaluator over `request.<ident>` with + - * operators. */
function evalExpr(expr: string, request: any): unknown {
  const tokens = expr.split(/\s*([+\-*])\s*/).filter((t) => t.length > 0)
  let acc: number | undefined
  let op = '+'
  for (const tok of tokens) {
    if (tok === '+' || tok === '-' || tok === '*') {
      op = tok
      continue
    }
    const val = tok.startsWith('request.')
      ? Number((request ?? {})[tok.slice('request.'.length)])
      : Number(tok)
    if (acc === undefined) acc = val
    else if (op === '+') acc += val
    else if (op === '-') acc -= val
    else if (op === '*') acc *= val
  }
  return acc
}

function makeLocalHandler(spec: CommandSpec): (req: any) => Promise<any> {
  const returns: any = spec.returns
  return async (req: any) => {
    if (returns && typeof returns === 'object' && '$expr' in returns) {
      return evalExpr(returns['$expr'], req)
    }
    return returns
  }
}

export type ListenerTrace = { invocations: number; lastPayload?: unknown }

type LocalCallResult = { ok: true; value: unknown } | { ok: false; error: Error }
type RunResult = { ok: true } | { ok: false; error: string }

async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
}

/** Walk a value replacing `{ "$ref": "name" }` with the captured value.
 *  Used on inbound messages so vectors can refer to IDs emitted by the
 *  registry in earlier outbound steps. */
function resolveRefs(value: any, captures: CaptureBag): any {
  if (value && typeof value === 'object') {
    if (!Array.isArray(value) && '$ref' in value) {
      const name = value.$ref
      if (typeof name !== 'string' || !captures.has(name)) {
        throw new Error(`inbound $ref to unknown capture "${String(name)}"`)
      }
      return captures.get(name)
    }
    if (Array.isArray(value)) return value.map((v) => resolveRefs(v, captures))
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value)) out[k] = resolveRefs(value[k], captures)
    return out
  }
  return value
}

export async function runBehaviorVector(vector: BehaviorVector): Promise<RunResult> {
  const registry = new CommandRegistry({
    id: vector.setup.registry.id,
    routerChannel: vector.setup.registry.routerChannel,
  })

  try {
    for (const cmd of vector.setup.registry.localCommands ?? []) {
      await registry.registerCommand(cmd.id, makeLocalHandler(cmd))
    }

    const listenerTraces = new Map<string, ListenerTrace>()
    for (const eventId of vector.setup.registry.localEventListeners ?? []) {
      const trace: ListenerTrace = { invocations: 0 }
      listenerTraces.set(eventId, trace)
      registry.addEventListener(eventId, (payload?: unknown) => {
        trace.invocations += 1
        trace.lastPayload = payload
      })
    }

    const channels = new Map<string, MockChannel>()
    for (const peer of vector.setup.peers) {
      const ch = new MockChannel(peer.channelId)
      channels.set(peer.channelId, ch)
      await registry.registerChannel(ch)
      // Drain the implicit list.commands.request sent by registerChannel.
      ch.drainWhere((m: any) => m?.type === MessageType.LIST_COMMANDS_REQUEST)
    }

    const captures: CaptureBag = new Map()
    let pendingResult: Promise<LocalCallResult> | undefined

    for (let i = 0; i < vector.steps.length; i++) {
      const step = vector.steps[i]
      const tag = `step[${i}] (${step.direction})`

      switch (step.direction) {
        case 'inbound': {
          const ch = channels.get(step.from)
          if (!ch) throw new Error(`${tag}: unknown channel "${step.from}"`)
          ch.deliver(resolveRefs(step.message, captures))
          await flushMicrotasks()
          break
        }
        case 'outbound': {
          const ch = channels.get(step.to)
          if (!ch) throw new Error(`${tag}: unknown channel "${step.to}"`)
          await flushMicrotasks()
          const actual = ch.takeOutbound()
          if (actual === undefined) {
            throw new Error(`${tag}: expected outbound on ${step.to}, got none`)
          }
          match(step.expected, actual, captures, `$[${i}]`)
          break
        }
        case 'assert-no-outbound': {
          const ch = channels.get(step.to)
          if (!ch) throw new Error(`${tag}: unknown channel "${step.to}"`)
          await flushMicrotasks()
          if (ch.pendingOutboundCount() !== 0) {
            throw new Error(
              `${tag}: expected no outbound, got ${JSON.stringify(ch.peekOutbound())}`,
            )
          }
          break
        }
        case 'local-call': {
          const trig = step.trigger
          if ('executeCommand' in trig) {
            const [cmd, req] = trig.executeCommand
            pendingResult = registry
              .executeCommand(cmd, req)
              .then((value) => ({ ok: true as const, value }))
              .catch((error: Error) => ({ ok: false as const, error }))
          } else if ('emitEvent' in trig) {
            const [eventId, payload] = trig.emitEvent
            registry.emitEvent(eventId, payload)
          } else if ('registerCommand' in trig) {
            const [cmd] = trig.registerCommand
            pendingResult = registry
              .registerCommand(cmd, async () => null as any)
              .then(() => ({ ok: true as const, value: undefined }))
              .catch((error: Error) => ({ ok: false as const, error }))
          } else if ('listCommands' in trig) {
            pendingResult = Promise.resolve({
              ok: true as const,
              value: registry.listCommands().map((c) => ({ id: c.id })),
            })
          } else {
            throw new Error(`${tag}: unknown trigger`)
          }
          await flushMicrotasks()
          break
        }
        case 'local-result': {
          if (!pendingResult) throw new Error(`${tag}: no pending local-call`)
          const result = await pendingResult
          pendingResult = undefined
          if ('expectedError' in step && step.expectedError) {
            if (result.ok) {
              throw new Error(
                `${tag}: expected error ${step.expectedError.code}, got ok value ${JSON.stringify(result.value)}`,
              )
            }
            const actualCode = (result.error as unknown as { code?: string }).code
            if (actualCode !== step.expectedError.code) {
              throw new Error(
                `${tag}: expected error code "${step.expectedError.code}", got "${actualCode}" (${result.error.message})`,
              )
            }
            if (step.expectedError.message !== undefined) {
              match(step.expectedError.message, result.error.message, captures, `$[${i}].message`)
            }
            break
          }
          if (!result.ok) {
            throw new Error(`${tag}: local-call rejected: ${result.error.message}`)
          }
          if ('expected' in step) {
            match(step.expected, result.value, captures, `$[${i}].result`)
          }
          break
        }
        case 'close-channel': {
          const ch = channels.get(step.channel)
          if (!ch) throw new Error(`${tag}: unknown channel "${step.channel}"`)
          await ch.close()
          await flushMicrotasks()
          break
        }
        case 'assert-local-listener': {
          const trace = listenerTraces.get(step.eventId)
          if (!trace) {
            throw new Error(
              `${tag}: no listener pre-registered for "${step.eventId}" (add it to setup.registry.localEventListeners)`,
            )
          }
          if (trace.invocations !== step.invocations) {
            throw new Error(
              `${tag}: expected ${step.invocations} invocations of "${step.eventId}", got ${trace.invocations}`,
            )
          }
          if ('lastPayload' in step && step.lastPayload !== undefined) {
            match(step.lastPayload, trace.lastPayload, captures, `$[${i}].lastPayload`)
          }
          break
        }
      }
    }

    // No unasserted outbound unless last step was assert-no-outbound.
    const lastStep = vector.steps[vector.steps.length - 1]
    if (lastStep?.direction !== 'assert-no-outbound') {
      for (const [id, ch] of channels) {
        if (ch.pendingOutboundCount() > 0) {
          throw new Error(
            `unasserted outbound messages on channel "${id}": ${JSON.stringify(ch.peekOutbound())}`,
          )
        }
      }
    }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  } finally {
    registry.dispose()
  }
}

export function loadBehaviorVectors(): Array<{ file: string; vector: BehaviorVector }> {
  return listVectors(BEHAVIOR_DIR).map((file) => ({
    file,
    vector: readJson<BehaviorVector>(file),
  }))
}
