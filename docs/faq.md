# FAQ

## Does core depend on React, Vue, Svelte, or Next.js?

No. `@offlinejs/core` is framework agnostic.

## Can I use Axios?

Yes. Implement `SyncTransport` and pass it as `transport`.

## Does optimistic update wait for the network?

No. Local storage updates first, then the mutation is queued and synced when possible.

## What happens when sync fails?

The mutation remains queued, receives retry metadata, and is retried with exponential backoff.

## How are conflicts resolved?

Use `clientWins`, `serverWins`, `lastWriteWins`, `merge`, or a custom resolver.
