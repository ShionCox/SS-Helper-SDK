import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearSSHelperPerformanceTimeline,
  readSSHelperPerformanceTimeline,
  startSSHelperPerformanceSpan,
  traceSSHelperPerformance,
} from '../packages/sdk/dist/index.js';

test('performance timeline is opt-in, bounded to safe stage metadata, and spans finish once', () => {
  clearSSHelperPerformanceTimeline();
  globalThis.__SSHelperPerformanceTrace = false;
  traceSSHelperPerformance('memory', 'disabled');
  assert.deepEqual(readSSHelperPerformanceTimeline(), []);

  globalThis.__SSHelperPerformanceTrace = true;
  traceSSHelperPerformance('core', 'session-ready');
  const finish = startSSHelperPerformanceSpan('memory', 'storage-open');
  const entry = finish('success');
  assert.equal(finish('error'), undefined);

  const timeline = readSSHelperPerformanceTimeline();
  assert.equal(timeline.length, 2);
  assert.equal(entry?.kind, 'span');
  assert.equal(entry?.status, 'success');
  assert.equal(typeof entry?.durationMs, 'number');
  assert.deepEqual(Object.keys(entry ?? {}).sort(), [
    'atMs', 'deltaMs', 'durationMs', 'elapsedMs', 'kind', 'plugin', 'stage', 'status',
  ]);

  clearSSHelperPerformanceTimeline();
  delete globalThis.__SSHelperPerformanceTrace;
});
