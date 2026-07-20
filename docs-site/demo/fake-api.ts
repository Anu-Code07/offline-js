import {
  SYNC_TRANSPORT_CONTRACT_VERSION,
  type EntityRecord,
  type SyncTransport,
  type TransportRequest,
  type TransportResponse
} from "@offlinejs/types";

/** Warehouse stock line — quantity conflicts are easy to see side-by-side. */
export type StockItem = EntityRecord & {
  sku: string;
  name: string;
  qty: number;
  aisle: string;
  createdAt: number;
  updatedAt: number;
};

const NAMES = [
  "Espresso beans",
  "Oat milk",
  "Paper cups",
  "Cold brew concentrate",
  "Sugar sticks",
  "Croissant dough",
  "Matcha powder",
  "Ceramic mugs",
  "Cleaning tablets",
  "Vanilla syrup"
];

const AISLES = ["A1", "A2", "B1", "B2", "C1", "Cold"];

const randomItem = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)] as T;

const createId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `stock_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const createSku = (): string =>
  `SKU-${Math.floor(1000 + Math.random() * 9000)}`;

export class FakeStockApi {
  private readonly records = new Map<string, StockItem>();
  private readonly conflictOnce = new Set<string>();

  constructor() {
    this.seedRandom(4);
  }

  list(): StockItem[] {
    return [...this.records.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): StockItem | null {
    return this.records.get(id) ?? null;
  }

  seedRandom(count = 5): StockItem[] {
    const created: StockItem[] = [];

    for (let index = 0; index < count; index += 1) {
      const now = Date.now() - Math.floor(Math.random() * 50_000);
      const item: StockItem = {
        id: createId(),
        sku: createSku(),
        name: randomItem(NAMES),
        qty: 4 + Math.floor(Math.random() * 24),
        aisle: randomItem(AISLES),
        createdAt: now,
        updatedAt: now
      };
      this.records.set(item.id, item);
      created.push(item);
    }

    return created;
  }

  /** Change the server copy and force the next client write to 409. */
  prepareConflict(id: string): StockItem | null {
    const current = this.records.get(id);

    if (!current) {
      return null;
    }

    const serverEdit: StockItem = {
      ...current,
      qty: current.qty + 3 + Math.floor(Math.random() * 5),
      aisle: randomItem(AISLES),
      updatedAt: Date.now() + 1
    };
    this.records.set(id, serverEdit);
    this.conflictOnce.add(id);
    return serverEdit;
  }

  clear(): void {
    this.records.clear();
    this.conflictOnce.clear();
  }

  createTransport(isOnline: () => boolean): SyncTransport {
    return {
      contractVersion: SYNC_TRANSPORT_CONTRACT_VERSION,
      request: async <TData = unknown, TBody = unknown>(
        request: TransportRequest<TBody>
      ): Promise<TransportResponse<TData>> => {
        if (!isOnline()) {
          const error = new Error("Remote warehouse API is offline");
          Object.assign(error, { status: 0 });
          throw error;
        }

        await delay(140 + Math.floor(Math.random() * 200));
        return this.handle(request) as Promise<TransportResponse<TData>>;
      }
    };
  }

  private async handle<TBody>(request: TransportRequest<TBody>): Promise<TransportResponse> {
    const [collection, id] = request.path.replace(/^\//, "").split("/");

    if (collection !== "stock") {
      return { data: null, status: 404 };
    }

    if (request.method === "GET" && !id) {
      return { data: this.list(), status: 200 };
    }

    if (request.method === "POST" && !id) {
      const body = (request.body ?? {}) as Partial<StockItem>;
      const now = Date.now();
      const item: StockItem = {
        id: typeof body.id === "string" ? body.id : createId(),
        sku: String(body.sku ?? createSku()),
        name: String(body.name ?? "Untitled item"),
        qty: Number(body.qty ?? 0),
        aisle: String(body.aisle ?? "A1"),
        createdAt: Number(body.createdAt ?? now),
        updatedAt: Number(body.updatedAt ?? now)
      };
      this.records.set(item.id, item);
      return { data: item, status: 201 };
    }

    if (!id) {
      return { data: null, status: 400 };
    }

    if (request.method === "DELETE") {
      this.records.delete(id);
      return { data: null, status: 204 };
    }

    if (request.method === "PATCH" || request.method === "PUT") {
      const existing = this.records.get(id);

      if (this.conflictOnce.has(id) && existing) {
        this.conflictOnce.delete(id);
        const error = new Error("Conflict");
        Object.assign(error, { status: 409, data: existing });
        throw error;
      }

      const body = (request.body ?? {}) as Partial<StockItem>;
      const now = Date.now();
      const next: StockItem = {
        id,
        sku: String(body.sku ?? existing?.sku ?? createSku()),
        name: String(body.name ?? existing?.name ?? "Untitled item"),
        qty: Number(body.qty ?? existing?.qty ?? 0),
        aisle: String(body.aisle ?? existing?.aisle ?? "A1"),
        createdAt: Number(body.createdAt ?? existing?.createdAt ?? now),
        updatedAt: Number(body.updatedAt ?? now)
      };
      this.records.set(id, next);
      return { data: next, status: 200 };
    }

    return { data: null, status: 405 };
  }
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
