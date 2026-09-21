/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'This dependency introduces a circular dependency.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-common-to-modules',
      severity: 'error',
      comment: 'Shared/common code must not depend on feature modules.',
      from: { path: '^src/(common|config)/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'no-database-to-modules',
      severity: 'error',
      comment: 'The database layer must not depend on feature modules.',
      from: { path: '^src/database/' },
      to: { path: '^src/modules/' },
    },
  ],
  options: {
    doNotFollow: { path: '^node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};