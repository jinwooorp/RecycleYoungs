const metrics = ['stores', 'sales', 'foot-traffic'];

export const quarterCatalogFixture = {
  industryCode: 'CS100010',
  defaultQuarterCode: '20262',
  quarters: ['20262', '20261'].map((quarterCode) => ({
    quarterCode,
    districtMetrics: metrics,
    dongMetrics: metrics,
  })),
};
