import Ajv from 'ajv';
import resolveSchema from '../../contracts/resolve.schema.json';
import intelSchema from '../../contracts/intel.schema.json';

const ajv = new Ajv();

test('resolve schema', () => {
  const ok = ajv.validate(resolveSchema, { hops: ['a', 'b'], final: 'b' });
  expect(ok).toBe(true);
});

test('intel schema', () => {
  const ok = ajv.validate(intelSchema, { urlhaus: {}, phishtank: {} });
  expect(ok).toBe(true);
});
