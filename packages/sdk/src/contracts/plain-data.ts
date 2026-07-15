export type PlainData = null | boolean | number | string | readonly PlainData[] | { readonly [key: string]: PlainData };

export type BoundaryValidator<Value> = (value: unknown) => value is Value;
