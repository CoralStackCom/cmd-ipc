import { Command } from '@coralstack/cmd-ipc'

import type { CommandRequest, CommandResponse } from '../schemas'
import { CommandIDs } from '../schemas'

/**
 * Local array manipulation commands
 */
export class ArrayServiceClass {
  @Command(CommandIDs.ARRAY_SUM)
  public async sum({
    numbers,
  }: CommandRequest<typeof CommandIDs.ARRAY_SUM>): CommandResponse<typeof CommandIDs.ARRAY_SUM> {
    const result = numbers.reduce((acc, n) => acc + n, 0)
    return { result, count: numbers.length }
  }
}

/**
 * Export instance of ArrayServiceClass
 */
export const ArrayService = new ArrayServiceClass()
