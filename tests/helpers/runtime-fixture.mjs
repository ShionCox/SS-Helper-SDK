export class TestRealm extends EventTarget {}

export const coreIdentity = (overrides = {}) => ({
  coreVersion: '0.0.1',
  sdkPackageVersion: '0.0.1',
  apiVersion: '0.0.1',
  capabilities: [],
  buildId: 'test-build',
  contentDigest: 'a'.repeat(64),
  ...overrides,
});

export const pluginDescriptor = (id, overrides = {}) => ({
  id,
  displayName: id,
  pluginVersion: '0.1.0',
  sdkPackageVersion: '0.0.1',
  apiVersion: '0.0.1',
  minApiVersion: '0.0.1',
  capabilities: [],
  ...overrides,
});

export const service = (provider, name = 'echo', version = 0, overrides = {}) => Object.freeze({
  kind: 'service', provider, name, version, schemaId: `${provider}.${name}.v${version}`, ...overrides,
});

export const eventContract = (provider, name = 'changed', version = 0, overrides = {}) => Object.freeze({
  kind: 'event', provider, name, version, schemaId: `${provider}.${name}.v${version}`, ...overrides,
});

export const errorCode = (code) => (error) => error?.code === code;
