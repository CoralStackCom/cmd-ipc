import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin'
import type { WebpackPluginInstance } from 'webpack'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin')

export const plugins: (false | WebpackPluginInstance)[] = [
  new ForkTsCheckerWebpackPlugin({
    logger: 'webpack-infrastructure',
    typescript: {
      configFile: './tsconfig.build.json',
    },
  }),
]
