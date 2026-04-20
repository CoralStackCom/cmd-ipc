import ReactRefreshPlugin from '@pmmmwh/react-refresh-webpack-plugin'
import type { Configuration } from 'webpack'

import { alias } from './webpack.alias'
import { plugins } from './webpack.plugins'
import { rules } from './webpack.rules'

const isDevelopment = process.env.NODE_ENV !== 'production'

// Add any additional rules needed
rules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
})

// Add any additional plugins needed
plugins.push(
  isDevelopment &&
    new ReactRefreshPlugin({
      overlay: false,
      exclude: [/preload/, /node_modules/],
    }),
)
plugins.filter(Boolean)

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  optimization: {
    minimize: true,
  },
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
    alias,
  },
  /**
   * List all the external native modules that need to be excluded from
   * renderer build but built as native modules and packaged when packing
   * the app here
   */
  externals: {},
}
