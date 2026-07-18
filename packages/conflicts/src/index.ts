import type { ConflictResolver, EntityRecord } from "@offlinejs/types";

export type FieldMergeStrategy = "client" | "server" | "lastWriteWins" | "max" | "min" | "setUnion";

export type FieldMergePolicy<TRecord extends EntityRecord> = Partial<
  Record<keyof TRecord | string, FieldMergeStrategy>
>;

export const createFieldMergeResolver = <TRecord extends EntityRecord>(
  policy: FieldMergePolicy<TRecord>
): ConflictResolver<TRecord> => {
  return ({ client, server }) => {
    if (!client) {
      return server;
    }

    if (!server) {
      return client;
    }

    const merged: EntityRecord = { ...server, ...client, id: client.id };

    for (const [field, strategy] of Object.entries(policy)) {
      if (strategy) {
        merged[field] = mergeField(strategy, client[field], server[field]);
      }
    }

    return merged as TRecord;
  };
};

export const mergeGrowOnlyCounter = (client = 0, server = 0): number => Math.max(client, server);

export const mergePositiveNegativeCounter = (
  client: { decrement: number; increment: number },
  server: { decrement: number; increment: number }
): { decrement: number; increment: number; value: number } => {
  const increment = Math.max(client.increment, server.increment);
  const decrement = Math.max(client.decrement, server.decrement);

  return {
    decrement,
    increment,
    value: increment - decrement
  };
};

export const mergeSetUnion = <TValue>(client: TValue[] = [], server: TValue[] = []): TValue[] => [
  ...new Set([...server, ...client])
];

export const mergeLastWriteWinsRegister = <TValue>(
  client: { timestamp: number; value: TValue },
  server: { timestamp: number; value: TValue }
): TValue => (client.timestamp >= server.timestamp ? client.value : server.value);

const mergeField = (
  strategy: FieldMergeStrategy,
  clientValue: unknown,
  serverValue: unknown
): unknown => {
  if (strategy === "client") {
    return clientValue;
  }

  if (strategy === "server") {
    return serverValue;
  }

  if (strategy === "max") {
    return Math.max(Number(clientValue ?? 0), Number(serverValue ?? 0));
  }

  if (strategy === "min") {
    return Math.min(Number(clientValue ?? 0), Number(serverValue ?? 0));
  }

  if (strategy === "setUnion") {
    return mergeSetUnion(
      Array.isArray(clientValue) ? clientValue : [],
      Array.isArray(serverValue) ? serverValue : []
    );
  }

  const clientTimestamp = Number(
    (clientValue as { updatedAt?: number } | undefined)?.updatedAt ?? 0
  );
  const serverTimestamp = Number(
    (serverValue as { updatedAt?: number } | undefined)?.updatedAt ?? 0
  );

  return clientTimestamp >= serverTimestamp ? clientValue : serverValue;
};
