// mermaid cannot render in jsdom and pulls in a large ESM-only dependency
// tree, so tests get a stub instead. Wired up via moduleNameMapper in
// jest.config.cts.
module.exports = {
  __esModule: true,
  default: {
    initialize: () => {},
    parse: async () => false,
    render: async () => ({ svg: '' }),
  },
};
