module.exports = {
  displayName: '@prism/extension',
  preset: '../../jest.preset.js',
  transform: {
    '^(?!.*\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
    '^.+\\.[cm]?[tj]sx?$': [
      'babel-jest',
      {
        presets: ['@nx/react/babel'],
        // mermaid (and its ESM deps) use static class blocks, which the
        // shared preset does not down-level.
        plugins: ['@babel/plugin-transform-class-static-block'],
      },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  moduleNameMapper: {
    '^mermaid$': '<rootDir>/src/__mocks__/mermaid.ts',
    // The esm build is not requireable from CommonJS test code; the cjs build
    // exposes the same styles.
    '^react-syntax-highlighter/dist/esm/(.*)$':
      'react-syntax-highlighter/dist/cjs/$1',
  },
  // These packages ship ESM only and must go through babel to be requireable
  // from CommonJS test code (nanoid, react-markdown and its unified/remark tree).
  transformIgnorePatterns: [
    'node_modules/(?!(?:micromark-util-decode-numeric-character-reference|micromark-extension-gfm-autolink-literal|micromark-extension-gfm-task-list-item|micromark-extension-gfm-strikethrough|micromark-util-normalize-identifier|micromark-util-classify-character|micromark-util-combine-extensions|micromark-extension-gfm-tagfilter|decode-named-character-reference|micromark-extension-gfm-footnote|mdast-util-gfm-autolink-literal|estree-util-is-identifier-name|micromark-factory-destination|unist-util-stringify-position|mdast-util-gfm-task-list-item|micromark-extension-gfm-table|micromark-factory-whitespace|micromark-util-html-tag-name|micromark-util-decode-string|mdast-util-gfm-strikethrough|micromark-util-sanitize-uri|character-reference-invalid|mdast-util-find-and-replace|micromark-util-resolve-all|micromark-util-subtokenize|mdast-util-mdx-expression|micromark-core-commonmark|character-entities-legacy|hast-util-to-jsx-runtime|mdast-util-from-markdown|micromark-util-character|unist-util-visit-parents|character-entities-html4|hast-util-parse-selector|micromark-factory-label|micromark-factory-space|micromark-factory-title|@ungap/structured-clone|mdast-util-gfm-footnote|micromark-extension-gfm|comma-separated-tokens|micromark-util-chunked|mdast-util-to-markdown|space-separated-tokens|micromark-util-symbol|micromark-util-encode|hast-util-whitespace|mdast-util-to-string|micromark-util-types|mdast-util-mdxjs-esm|property-information|escape-string-regexp|mdast-util-gfm-table|mdast-util-phrasing|unist-util-position|html-url-attributes|character-entities|mdast-util-mdx-jsx|stringify-entities|mdast-util-to-hast|is-alphanumerical|unist-util-visit|remark-stringify|is-alphabetical|react-markdown|longest-streak|parse-entities|is-hexadecimal|mdast-util-gfm|markdown-table|unist-util-is|vfile-message|remark-rehype|remark-parse|is-plain-obj|is-decimal|trim-lines|remark-gfm|hastscript|micromark|refractor|unified|devlop|zwitch|ccount|trough|nanoid|vfile|bail|idb)/)',
  ],
  coverageDirectory: 'test-output/jest/coverage',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};
