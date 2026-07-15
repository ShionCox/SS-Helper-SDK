import type { BoundaryValidator } from './plain-data.js';
import type { PluginId } from './plugin.js';

export interface ServiceContract<Provider extends string, Name extends string, Version extends number, Request, Response> {
  readonly kind: 'service';
  readonly provider: Provider;
  readonly name: Name;
  readonly version: Version;
  readonly schemaId?: string;
  readonly validateRequest?: BoundaryValidator<Request>;
  readonly validateResponse?: BoundaryValidator<Response>;
}

export type AnyServiceContract = ServiceContract<string, string, number, unknown, unknown>;
export type ServiceRequest<Contract> = Contract extends ServiceContract<string, string, number, infer Request, unknown> ? Request : never;
export type ServiceResponse<Contract> = Contract extends ServiceContract<string, string, number, unknown, infer Response> ? Response : never;

export interface CallOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ServiceCallContext {
  readonly signal: AbortSignal;
  readonly callerPluginId: PluginId;
}

export interface ServicePort {
  expose<Contract extends AnyServiceContract>(
    contract: Contract,
    handler: (
      request: ServiceRequest<Contract>,
      context: ServiceCallContext,
    ) => ServiceResponse<Contract> | Promise<ServiceResponse<Contract>>,
  ): () => void;
  waitFor<Contract extends AnyServiceContract>(contract: Contract, options?: CallOptions): Promise<void>;
  call<Contract extends AnyServiceContract>(
    contract: Contract,
    request: ServiceRequest<Contract>,
    options?: CallOptions,
  ): Promise<ServiceResponse<Contract>>;
}
