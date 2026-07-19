# Public Contracts

OfflineJS v1 exposes stable contracts through `@offlinejs/types`.

## Version constants

- `OFFLINEJS_PUBLIC_API_VERSION`
- `STORAGE_ADAPTER_CONTRACT_VERSION`
- `SYNC_TRANSPORT_CONTRACT_VERSION`

Adapters and transports may set their contract version. `@offlinejs/core` validates versions at
database creation time and fails fast when an unsupported implementation is provided.

## Storage adapter compatibility

The v1 storage contract is:

```ts
interface StorageAdapter {
  readonly name: string;
  readonly contractVersion?: 1;
  readonly capabilities?: StorageAdapterCapabilities;
  get(collection, id);
  set(collection, value);
  delete(collection, id);
  find(collection, query?);
  clear(collection?);
  transaction(scope, run);
  migrate?(migrations);
}
```

Backwards-compatible changes may add optional methods or capabilities. Breaking changes require a
new contract version.

## Sync transport compatibility

The v1 sync transport contract is:

```ts
interface SyncTransport {
  readonly contractVersion?: 1;
  request(request): Promise<TransportResponse>;
}
```

Transport middleware, timeouts, and auth wrappers compose around this contract.
