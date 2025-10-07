import { analyze } from '../../src/lib/heuristics';

test('blocks invalid URL', () => {
  expect(analyze('not a url').verdict).toBe('BLOCK');
});

test('warns suspicious TLD', () => {
  const result = analyze('https://example.zip/');
  expect(['WARN', 'BLOCK']).toContain(result.verdict);
});

test('data scheme blocks', () => {
  const result = analyze('data:text/html,hi');
  expect(result.verdict).toBe('BLOCK');
});

test('shortener flagged', () => {
  const result = analyze('https://bit.ly/x');
  expect(result.signals.find((signal) => signal.key === 'shortener')?.ok).toBe(false);
});
