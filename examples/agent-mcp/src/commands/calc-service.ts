import { Command } from '@coralstack/cmd-ipc'

import type { CommandRequest, CommandResponse } from './command-schema'
import { CommandIDs } from './command-schema'

/**
 * Calc Service
 *
 * Provides mathematical operation commands
 */
class CalcServiceClass {
  @Command(CommandIDs.MATH_ADD)
  public async add({
    a,
    b,
  }: CommandRequest<typeof CommandIDs.MATH_ADD>): CommandResponse<typeof CommandIDs.MATH_ADD> {
    return { result: a + b }
  }

  @Command(CommandIDs.MATH_MULTIPLY)
  public async multiply({
    a,
    b,
  }: CommandRequest<typeof CommandIDs.MATH_MULTIPLY>): CommandResponse<
    typeof CommandIDs.MATH_MULTIPLY
  > {
    return { result: a * b }
  }

  @Command(CommandIDs.MATH_DIVIDE)
  public async divide({
    a,
    b,
  }: CommandRequest<typeof CommandIDs.MATH_DIVIDE>): CommandResponse<
    typeof CommandIDs.MATH_DIVIDE
  > {
    if (b === 0) {
      throw new Error('Division by zero is not allowed')
    }
    return { result: a / b }
  }

  @Command(CommandIDs.MATH_FACTORIAL)
  public async factorial({
    n,
  }: CommandRequest<typeof CommandIDs.MATH_FACTORIAL>): CommandResponse<
    typeof CommandIDs.MATH_FACTORIAL
  > {
    let result = 1
    for (let i = 2; i <= n; i++) {
      result *= i
    }
    return { result }
  }
}

// Export an instance of the CalcService
export const CalcService = new CalcServiceClass()
