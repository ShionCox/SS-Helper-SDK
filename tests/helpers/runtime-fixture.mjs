export class TestRealm extends EventTarget {}

export const coreIdentity = (overrides = {}) => ({
  coreVersion: '2.4.0',
  sdkPackageVersion: '1.0.0',
  apiMajor: 1,
  apiMinor: 0,
  capabilities: [],
  buildId: 'test-build',
  contentDigest: 'a'.repeat(64),
  ...overrides,
});

export const pluginDescriptor = (id, overrides = {}) => ({
  id,
  displayName: id,
  pluginVersion: '0.1.0',
  sdkPackageVersion: '9.9.9',
  apiMajor: 1,
  minApiMinor: 0,
  capabilities: [],
  ...overrides,
});

export const service = (provider, name = 'echo', version = 1, overrides = {}) => Object.freeze({
  kind: 'service', provider, name, version, schemaId: `${provider}.${name}.v${version}`, ...overrides,
});

export const eventContract = (provider, name = 'changed', version = 1, overrides = {}) => Object.freeze({
  kind: 'event', provider, name, version, schemaId: `${provider}.${name}.v${version}`, ...overrides,
});

export const errorCode = (code) => (error) => error?.code === code;
