// Hand-rolled shape checks for the two API contracts. These mirror
// contracts/resolve.schema.json and contracts/intel.schema.json without
// pulling in a JSON-schema validator.

function isResolveResponse(d: unknown): boolean {
  if (!d || typeof d !== 'object') return false;
  const data = d as Record<string, unknown>;
  return (
    Array.isArray(data.hops) &&
    data.hops.every((h) => typeof h === 'string') &&
    typeof data.final === 'string'
  );
}

function isIntelResponse(d: unknown): boolean {
  if (!d || typeof d !== 'object') return false;
  const data = d as Record<string, unknown>;
  if (!('urlhaus' in data)) return false;
  const urlhaus = data.urlhaus;
  return urlhaus === null || typeof urlhaus === 'object';
}

test('resolve schema', () => {
  expect(isResolveResponse({ hops: ['a', 'b'], final: 'b' })).toBe(true);
  expect(isResolveResponse({ hops: 'a', final: 'b' })).toBe(false);
  expect(isResolveResponse({ final: 'b' })).toBe(false);
});

test('intel schema', () => {
  expect(isIntelResponse({ urlhaus: {}, phishtank: {} })).toBe(true);
  expect(isIntelResponse({ urlhaus: null })).toBe(true);
  expect(isIntelResponse({})).toBe(false);
});
