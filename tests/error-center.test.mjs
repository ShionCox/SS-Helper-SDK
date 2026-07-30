import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SS_HELPER_DIAGNOSTICS,
  SS_HELPER_REASON_CODES,
  createSSHelperError,
  describeSSHelperFailure,
  readSSHelperFailure,
  transportCodeFor,
} from '../packages/sdk/dist/index.js';

test('the SDK diagnostic catalog is the single complete Chinese definition source', () => {
  assert.equal(SS_HELPER_REASON_CODES.length, new Set(SS_HELPER_REASON_CODES).size);
  assert.deepEqual([...SS_HELPER_REASON_CODES].sort(), Object.keys(SS_HELPER_DIAGNOSTICS).sort());
  for (const reasonCode of SS_HELPER_REASON_CODES) {
    assert.match(reasonCode, /^[A-Z][A-Z0-9_]*$/);
    const definition = SS_HELPER_DIAGNOSTICS[reasonCode];
    assert.match(definition.title, /[\u3400-\u9fff]/);
    assert.match(definition.reason, /[\u3400-\u9fff]/);
    assert.match(definition.action, /[\u3400-\u9fff]/);
    assert.equal(typeof definition.retryable, 'boolean');
    assert.equal(transportCodeFor(reasonCode), definition.transportCode);
  }
});

test('factory, reader and descriptor preserve one structured failure context', () => {
  const error = createSSHelperError('SCHEMA_VALIDATION_FAILED', {
    stage: 'llm.structured.validate',
    requestId: 'request-1',
    attemptId: 'attempt-1',
    batchIndex: 4,
    collection: 'claims',
    path: '$.claims[2].objectRef',
    keyword: 'required',
    expected: 'property to be present',
  });
  const failure = readSSHelperFailure(error);
  assert.deepEqual(failure, {
    reasonCode: 'SCHEMA_VALIDATION_FAILED',
    stage: 'llm.structured.validate',
    requestId: 'request-1',
    attemptId: 'attempt-1',
    batchIndex: 4,
    collection: 'claims',
    path: '$.claims[2].objectRef',
    keyword: 'required',
    expected: 'property to be present',
  });
  const diagnostic = describeSSHelperFailure(error);
  assert.equal(diagnostic.transportCode, 'INVALID_PAYLOAD');
  assert.equal(diagnostic.reasonCode, failure.reasonCode);
  assert.equal(diagnostic.requestId, failure.requestId);
});

test('reader preserves a structured root cause instead of an outer wrapper', () => {
  const root = createSSHelperError('AUTH_FAILED', {
    stage: 'provider.http.response',
    requestId: 'request-auth',
    attemptId: 'attempt-auth',
    httpStatus: 401,
  });
  const outer = new Error('untrusted provider wrapper', { cause: root });
  assert.deepEqual(readSSHelperFailure(outer), readSSHelperFailure(root));
});

test('unknown exceptions only use an explicit safe fallback and do not expose messages', () => {
  const failure = readSSHelperFailure(new Error('secret response body'), {
    reasonCode: 'INTERNAL_ERROR',
    stage: 'provider.unknown',
    requestId: 'request-safe',
  });
  assert.deepEqual(failure, {
    reasonCode: 'INTERNAL_ERROR',
    stage: 'provider.unknown',
    requestId: 'request-safe',
  });
  assert.equal(JSON.stringify(failure).includes('secret response body'), false);
});
