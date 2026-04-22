import 'reflect-metadata'

import { Command } from '@coralstack/cmd-ipc'

import type { CommandRequest, CommandResponse } from '../command-schema'
import { CommandIDs } from '../command-schema'

/**
 * Calc Service
 *
 * Provides mathematical operations that run on Cloudflare's edge network.
 */
class CalcServiceClass {
  @Command(CommandIDs.MATH_ADD)
  add({
    a,
    b,
  }: CommandRequest<typeof CommandIDs.MATH_ADD>): CommandResponse<typeof CommandIDs.MATH_ADD> {
    return Promise.resolve({ result: a + b })
  }

  @Command(CommandIDs.MATH_MULTIPLY)
  multiply({
    a,
    b,
  }: CommandRequest<typeof CommandIDs.MATH_MULTIPLY>): CommandResponse<
    typeof CommandIDs.MATH_MULTIPLY
  > {
    return Promise.resolve({ result: a * b })
  }

  @Command(CommandIDs.MATH_FACTORIAL)
  factorial({
    n,
  }: CommandRequest<typeof CommandIDs.MATH_FACTORIAL>): CommandResponse<
    typeof CommandIDs.MATH_FACTORIAL
  > {
    let result = 1
    for (let i = 2; i <= n; i++) {
      result *= i
    }
    return Promise.resolve({ result })
  }
}

export const CalcService = new CalcServiceClass()
