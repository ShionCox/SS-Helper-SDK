import type { BoundaryValidator } from './plain-data.js';

export interface EventContract<Provider extends string, Name extends string, Version extends number, Payload> {
  readonly kind: 'event';
  readonly provider: Provider;
  readonly name: Name;
  readonly version: Version;
  readonly schemaId?: string;
  readonly validatePayload?: BoundaryValidator<Payload>;
}

export type AnyEventContract = EventContract<string, string, number, unknown>;
export type EventPayload<Contract> = Contract extends EventContract<string, string, number, infer Payload> ? Payload : never;

export interface EventPort {
  publish<Contract extends AnyEventContract>(contract: Contract, payload: EventPayload<Contract>): void;
  subscribe<Contract extends AnyEventContract>(
    contract: Contract,
    listener: (payload: EventPayload<Contract>) => void,
  ): () => void;
}
