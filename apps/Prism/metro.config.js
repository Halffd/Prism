const { withNxMetro } = require('@nx/expo');
const { getDefaultConfig } = require('@expo/metro-config');
const { mergeConfig } = require('metro-config');
const path = require('path');

const defaultConfig = getDefaultConfig(__dirname);
const { assetExts, sourceExts } = defaultConfig.resolver;

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const customConfig = {
  cacheVersion: '@prism/Prism',
  transformer: {
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  },
  resolver: {
    assetExts: assetExts.filter((ext) => ext !== 'svg'),
    sourceExts: [...sourceExts, 'cjs', 'mjs', 'svg'],
    // Add support for monorepo path aliases
    extraNodeModules: {
      '@prism/api-client': path.resolve(__dirname, '../../libs/api-client/src'),
      '@prism/shared-types': path.resolve(__dirname, '../../libs/shared-types/src'),
      '@prism/ocr': path.resolve(__dirname, '../../libs/ocr/src'),
      '@prism/stt': path.resolve(__dirname, '../../libs/stt/src'),
      '@prism/tts': path.resolve(__dirname, '../../libs/tts/src'),
      '@prism/inpaint': path.resolve(__dirname, '../../libs/inpaint/src'),
      '@prism/model-gen': path.resolve(__dirname, '../../libs/model-gen/src'),
      '@prism/audio-gen': path.resolve(__dirname, '../../libs/audio-gen/src'),
      '@prism/video-gen': path.resolve(__dirname, '../../libs/video-gen/src'),
      '@prism/llm': path.resolve(__dirname, '../../libs/llm/src'),
      '@prism/agent': path.resolve(__dirname, '../../libs/agent/src'),
      '@prism/ai-factory': path.resolve(__dirname, '../../libs/ai-factory/src'),
      '@prism/ai-builder': path.resolve(__dirname, '../../libs/ai-builder/src'),
    },
    resolverMainFields: ['browser', 'main'],
  },
};

module.exports = withNxMetro(mergeConfig(defaultConfig, customConfig), {
  // Change this to true to see debugging info.
  // Useful if you have issues resolving modules
  debug: false,
  // all the file extensions used for imports other than 'ts', 'tsx', 'js', 'jsx', 'json'
  extensions: [],
  // Specify folders to watch, in addition to Nx defaults (workspace libraries and node_modules)
  watchFolders: [
    path.resolve(__dirname, '../../libs/api-client'),
    path.resolve(__dirname, '../../libs/shared-types'),
    path.resolve(__dirname, '../../libs/ocr'),
    path.resolve(__dirname, '../../libs/stt'),
    path.resolve(__dirname, '../../libs/tts'),
    path.resolve(__dirname, '../../libs/inpaint'),
    path.resolve(__dirname, '../../libs/model-gen'),
    path.resolve(__dirname, '../../libs/audio-gen'),
    path.resolve(__dirname, '../../libs/video-gen'),
    path.resolve(__dirname, '../../libs/llm'),
    path.resolve(__dirname, '../../libs/agent'),
    path.resolve(__dirname, '../../libs/ai-factory'),
    path.resolve(__dirname, '../../libs/ai-builder'),
  ],
});
