import path from 'path'
import type { ResolveOptions } from 'webpack'

export const alias: ResolveOptions['alias'] = {
  '@coralstack/cmd-ipc': path.resolve(__dirname, '../../../../../dist'),
}
