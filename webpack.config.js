'use strict';

const fs = require('fs');
const path = require('path');

class CopyFilePlugin {
  constructor(patterns) {
    this.patterns = patterns;
  }

  apply(compiler) {
    compiler.hooks.afterEmit.tap('CopyFilePlugin', () => {
      for (const pattern of this.patterns) {
        const source = path.resolve(__dirname, pattern.from);
        const target = path.resolve(__dirname, 'dist', pattern.to);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      }
    });
  }
}

/** @type {import('webpack').Configuration} */
const nodeConfig = {
  target: 'node',
  mode: 'development',
  entry: {
    extension: './src/extension.ts',
    'test/runTests': './src/test/runTests.ts',
    'cli/onec-tools': './src/cli/onec-tools.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    vscode: 'commonjs vscode',
    '@vscode/test-electron': 'commonjs @vscode/test-electron',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: 'ts-loader',
      },
    ],
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: 'log',
  },
};

/** @type {import('webpack').Configuration} */
const webviewConfig = {
  target: 'web',
  mode: 'development',
  entry: {
    formEditor: './src/formEditor/webview/formEditor.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, 'src/formEditor/webview/tsconfig.json'),
          },
        },
      },
    ],
  },
  plugins: [
    new CopyFilePlugin([
      { from: 'src/formEditor/webview/styles.css', to: 'formEditor.css' },
    ]),
  ],
  devtool: 'nosources-source-map',
};

module.exports = [nodeConfig, webviewConfig];
