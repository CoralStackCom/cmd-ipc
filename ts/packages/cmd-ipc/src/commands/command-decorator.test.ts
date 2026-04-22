import { Command } from './command-decorator'

describe('Command Decorator', () => {
  it('should enforce method signature types', async () => {
    class _TestClass {
      @Command('test.command.1')
      // ✅ 1. () => Promise<TResponse> - No request payload
      async command1(): Promise<{ message: string }> {
        throw new Error('Method not implemented.')
      }

      @Command('test.command.2')
      // ✅ 2. (request: TRequest) => Promise<TResponse> - With request payload
      async command2(_request: { text: string }): Promise<{ message: string }> {
        throw new Error('Method not implemented.')
      }

      @Command('test.command.3')
      // ✅ 3. () => Promise<void> - No request payload and no response
      async command3(): Promise<void> {
        throw new Error('Method not implemented.')
      }

      @Command('test.command.4')
      // ✅ 4. (request: TRequest) => Promise<void> - With request payload and no response
      async command4(_request: { text: string }): Promise<void> {
        throw new Error('Method not implemented.')
      }

      // @ts-expect-error ❌ 5. Incorrect request method signature
      @Command('test.command.5')
      async command5(_message: string): Promise<{ message: string }> {
        throw new Error('Method not implemented.')
      }

      // @ts-expect-error ❌ 6. Incorrect response type signature
      @Command('test.command.6')
      async command6(): Promise<string> {
        throw new Error('Method not implemented.')
      }
    }
  })
})
