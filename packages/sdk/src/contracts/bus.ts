import type { BoundaryValidator } from './plain-data.js';
import type { PluginId } from './plugin.js';

export interface RequestContract<Id extends string, Version extends number, Request, Response> {
  readonly kind: 'request';
  readonly id: Id;
  readonly version: Version;
  readonly validateRequest?: BoundaryValidator<Request>;
  readonly validateResponse?: BoundaryValidator<Response>;
}

export interface BusEventContract<Id extends string, Version extends number, Payload> {
  readonly kind: 'event';
  readonly id: Id;
  readonly version: Version;
  readonly validatePayload?: BoundaryValidator<Payload>;
}

export type AnyRequestContract = RequestContract<string, number, unknown, unknown>;
export type AnyBusEventContract = BusEventContract<string, number, unknown>;
export type AnyBusContract = AnyRequestContract | AnyBusEventContract;
export type RequestInput<Contract> = Contract extends RequestContract<string, number, infer Input, unknown> ? Input : never;
export type RequestOutput<Contract> = Contract extends RequestContract<string, number, unknown, infer Output> ? Output : never;
export type BusEventPayload<Contract> = Contract extends BusEventContract<string, number, infer Payload> ? Payload : never;

export interface BusRequestOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface BusRequestContext {
  readonly signal: AbortSignal;
  readonly callerPluginId: PluginId;
  readonly requestId: string;
}

export interface BusPort {
  handle<Contract extends AnyRequestContract>(
    contract: Contract,
    handler: (
      request: RequestInput<Contract>,
      context: BusRequestContext,
    ) => RequestOutput<Contract> | Promise<RequestOutput<Contract>>,
  ): () => void;
  request<Contract extends AnyRequestContract>(
    contract: Contract,
    request: RequestInput<Contract>,
    options?: BusRequestOptions,
  ): Promise<RequestOutput<Contract>>;
  publish<Contract extends AnyBusEventContract>(
    contract: Contract,
    payload: BusEventPayload<Contract>,
  ): void;
  subscribe<Contract extends AnyBusEventContract>(
    contract: Contract,
    listener: (payload: BusEventPayload<Contract>) => void,
  ): () => void;
}
