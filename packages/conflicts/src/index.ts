import type { ConflictResolver, EntityRecord } from "@offlinejs/types";

export type FieldMergeStrategy =
  | "client"
  | "server"
  | "lastWriteWins"
  | "max"
  | "min"
  | "setUnion"
  | "growOnly";

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
        merged[field] = mergeField(strategy, client[field], server[field], client, server);
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

/** OR-Map style merge: union keys, LWW per key when timestamps are present. */
export const mergeOrMap = (
  client: Record<string, unknown> = {},
  server: Record<string, unknown> = {}
): Record<string, unknown> => {
  const keys = new Set([...Object.keys(server), ...Object.keys(client)]);
  const merged: Record<string, unknown> = {};

  for (const key of keys) {
    const clientValue = client[key];
    const serverValue = server[key];

    if (clientValue === undefined) {
      merged[key] = serverValue;
      continue;
    }

    if (serverValue === undefined) {
      merged[key] = clientValue;
      continue;
    }

    if (
      isTimestamped(clientValue) &&
      isTimestamped(serverValue)
    ) {
      merged[key] = mergeLastWriteWinsRegister(clientValue, serverValue);
      continue;
    }

    merged[key] = clientValue;
  }

  return merged;
};

export const mergeWithTombstones = <TValue>(
  client: Array<{ id: string; deleted?: boolean; value: TValue; updatedAt?: number }>,
  server: Array<{ id: string; deleted?: boolean; value: TValue; updatedAt?: number }>
): Array<{ id: string; deleted?: boolean; value: TValue; updatedAt?: number }> => {
  const byId = new Map<string, { id: string; deleted?: boolean; value: TValue; updatedAt?: number }>();

  for (const entry of [...server, ...client]) {
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      continue;
    }

    const existingTime = existing.updatedAt ?? 0;
    const nextTime = entry.updatedAt ?? 0;
    if (nextTime >= existingTime) {
      byId.set(entry.id, entry);
    }
  }

  return [...byId.values()].filter((entry) => !entry.deleted);
};

const mergeField = (
  strategy: FieldMergeStrategy,
  clientValue: unknown,
  serverValue: unknown,
  clientRecord: EntityRecord,
  serverRecord: EntityRecord
): unknown => {
  if (strategy === "client") {
    return clientValue;
  }

  if (strategy === "server") {
    return serverValue;
  }

  if (strategy === "max" || strategy === "growOnly") {
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

  if (isTimestamped(clientValue) && isTimestamped(serverValue)) {
    return mergeLastWriteWinsRegister(clientValue, serverValue);
  }

  const clientTimestamp = Number(
    (clientValue as { updatedAt?: number } | undefined)?.updatedAt ??
      clientRecord.updatedAt ??
      0
  );
  const serverTimestamp = Number(
    (serverValue as { updatedAt?: number } | undefined)?.updatedAt ??
      serverRecord.updatedAt ??
      0
  );

  return clientTimestamp >= serverTimestamp ? clientValue : serverValue;
};

const isTimestamped = (
  value: unknown
): value is { timestamp: number; value: unknown } =>
  typeof value === "object" &&
  value !== null &&
  "timestamp" in value &&
  "value" in value &&
  typeof (value as { timestamp: unknown }).timestamp === "number";
