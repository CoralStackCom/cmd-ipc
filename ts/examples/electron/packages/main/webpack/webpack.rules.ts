import path from 'path'
import type { ModuleOptions, RuleSetRule } from 'webpack'

/**
 * Helper function to create a TS rule for a specific package in monorepo to ensure
 * each package is built with its own tsconfig.json settings.
 *
 * @param entryPackage  The package name to create the rule for
 * @returns             The TS rule for the package
 */
function createTSRule(entryPackage: string, tsConfigFile: string = 'tsconfig.json'): RuleSetRule {
  const entrySrc = path.resolve(__dirname, `../../${entryPackage}/src`)
  const configPath = path.resolve(__dirname, `../../${entryPackage}/${tsConfigFile}`)

  return {
    test: /\.tsx?$/,
    include: [entrySrc],
    use: {
      loader: 'ts-loader',
      options: {
        configFile: configPath,
        transpileOnly: true,
      },
    },
  }
}

export const rules: Required<ModuleOptions>['rules'] = [
  // Add support for native node modules
  {
    // We're specifying native_modules in the test because the asset relocator loader generates a
    // "fake" .node file which is really a cjs file.
    test: /native_modules[/\\].+\.node$/,
    use: 'node-loader',
  },
  {
    test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
    parser: { amd: false },
    use: {
      loader: '@vercel/webpack-asset-relocator-loader',
      options: {
        outputAssetBase: 'native_modules',
      },
    },
  },
  createTSRule('main', 'tsconfig.build.json'),
  createTSRule('core', 'tsconfig.build.json'),
  createTSRule('sandbox'),
  createTSRule('frontend'),
  createTSRule('worker'),
]
