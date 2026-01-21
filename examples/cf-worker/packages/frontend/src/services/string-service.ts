import { Command } from '@coralstack/cmd-ipc'

import type { CommandRequest, CommandResponse } from '../schemas'
import { CommandIDs } from '../schemas'

/**
 * Local string manipulation commands that run in the browser
 */
class StringServiceClass {
  @Command(CommandIDs.STRING_REVERSE)
  public async reverse({
    text,
  }: CommandRequest<typeof CommandIDs.STRING_REVERSE>): CommandResponse<
    typeof CommandIDs.STRING_REVERSE
  > {
    const result = text.split('').reverse().join('')
    return { result, length: result.length }
  }

  @Command(CommandIDs.STRING_UPPERCASE)
  public async uppercase({
    text,
  }: CommandRequest<typeof CommandIDs.STRING_UPPERCASE>): CommandResponse<
    typeof CommandIDs.STRING_UPPERCASE
  > {
    return { result: text.toUpperCase() }
  }
}

/**
 * Export instance of StringServiceClass
 */
export const StringService = new StringServiceClass()
