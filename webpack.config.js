'use strict';

const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

/** @type {import('webpack').Configuration} */
module.exports = {
  target: 'node',
  entry: {
    extension: './src/extension.ts',
    'test/runTests': './src/test/runTests.ts',
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
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'node_modules/web-tree-sitter/tree-sitter.wasm', to: '.' },
        { from: 'node_modules/tree-sitter-bsl/tree-sitter-bsl.wasm', to: '.' },
      ],
    }),
  ],
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: 'log',
  },
};
