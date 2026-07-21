export const SS_HELPER_ERROR_CODES = [
  'CORE_MISSING', 'CORE_TIMEOUT', 'API_INCOMPATIBLE', 'CORE_ALREADY_ACTIVE', 'CORE_DISPOSED',
  'CORE_RECONNECT_EXHAUSTED', 'BRIDGE_CORRUPTED', 'STALE_SESSION', 'CAPABILITY_NOT_GRANTED',
  'DUPLICATE_PLUGIN_ID', 'UNKNOWN_SERVICE', 'SERVICE_VERSION_MISMATCH', 'PAYLOAD_INVALID',
  'CALL_TIMEOUT', 'CALL_ABORTED', 'PLUGIN_DISPOSED', 'SETTINGS_ADAPTER_ERROR',
  'HOST_NOT_READY', 'BOOTSTRAP_CALLBACK_TIMEOUT',
] as const;

export type SSHelperErrorCode = (typeof SS_HELPER_ERROR_CODES)[number];

export interface SSHelperErrorDetails { readonly [key: string]: null | boolean | number | string | readonly string[] | undefined; }

export class SSHelperError extends Error {
  readonly code: SSHelperErrorCode;
  readonly details?: SSHelperErrorDetails;
  constructor(code: SSHelperErrorCode, message: string, details?: SSHelperErrorDetails) {
    super(message);
    this.name = 'SSHelperError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
