const path = require('path');
const { VueLoaderPlugin } = require('vue-loader');
const webpack = require('webpack');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');

module.exports = (env, argv) => {
  // 判断是否为生产模式
  const isProduction = argv.mode === 'production';
  // 是否启用 bundle 分析
  const shouldAnalyze = process.env.ANALYZE === 'true';

const extensionConfig = {
  entry: {
    extension: path.resolve(__dirname, 'src', 'extension.ts'),
    kconfigServer: path.resolve(__dirname, 'src', 'kconfig', 'server.ts'),
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]',
    clean: {
      keep: /views\//,
    },
  },
  devtool: isProduction ? false : 'source-map',
  target: 'node',
  node: {
    __dirname: false,
    __filename: true,
  },
  externals: {
    'vscode': 'commonjs vscode',
  },
  optimization: {
    minimize: isProduction,
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              compilerOptions: {
                module: 'es6',
              },
            },
          },
        ],
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.ts'],
  },
  infrastructureLogging: {
    level: 'log',
  },
};

const webViewConfig = {
  entry: {
    webview: path.resolve(__dirname, 'src', 'views', 'webview', 'main.ts'),
  },
  output: {
    path: path.resolve(__dirname, 'dist', 'views'),
    filename: '[name]-bundle.js',
  },
  devtool: isProduction ? false : 'source-map',
  optimization: {
    minimize: isProduction,
  },
  performance: {
    hints: false,
    maxEntrypointSize: 1024 * 1024, // 1MB
    maxAssetSize: 1024 * 1024, // 1MB
  },
  module: {
    rules: [
      {
        test: /\.scss$/,
        use: [
          {
            loader: 'vue-style-loader',
          },
          {
            loader: 'css-loader',
          },
          {
            loader: 'sass-loader',
            options: {
              sourceMap: true,
              api: 'legacy',
              sassOptions: {
                silenceDeprecations: ['legacy-js-api', 'import'],
                includePaths: [path.resolve(__dirname, 'node_modules')],
                quietDeps: true,
              },
            },
          },
        ],
      },
      {
        test: /\.vue$/,
        use: 'vue-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['vue-style-loader', 'css-loader'],
      },
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            appendTsSuffixTo: [/\.vue$/],
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    conditionNames: ['import'],
    extensions: ['.ts', '.js', '.vue', '.json'],
    alias: {
      Vue: 'vue/dist/vue.esm-bundler.js',
    },
    fallback: {
      os: require.resolve('os-browserify/browser'),
      path: require.resolve('path-browserify'),
      stream: require.resolve('stream-browserify'),
      assert: require.resolve('assert/'),
    },
  },
  plugins: [
    new VueLoaderPlugin(),
    new webpack.DefinePlugin({
      __VUE_OPTIONS_API__: false,
      __VUE_PROD_DEVTOOLS__: false,
    }),
    ...(shouldAnalyze ? [new BundleAnalyzerPlugin({
      analyzerMode: 'static',
      reportFilename: 'bundle-report.html',
      openAnalyzer: false,
      generateStatsFile: true,
      statsFilename: 'bundle-stats.json',
    })] : []),
  ],
};

return [extensionConfig, webViewConfig];
};