import {
  SYNC_TRANSPORT_CONTRACT_VERSION,
  type EntityRecord,
  type SyncTransport,
  type TransportRequest,
  type TransportResponse
} from "@offlinejs/types";

export type DemoTodo = EntityRecord & {
  title: string;
  completed: boolean;
  assignee?: string;
  createdAt: number;
  updatedAt: number;
};

const TITLES = [
  "Ship offline sync",
  "Draft release notes",
  "Fix flaky queue retry",
  "Review conflict strategy",
  "Polish demo UI",
  "Add IndexedDB indexes",
  "Write FAQ answer",
  "Benchmark OPFS writes",
  "Wire service worker sync",
  "Tighten auth refresh"
];

const ASSIGNEES = ["Ada", "Grace", "Linus", "Margaret", "Alan", "Katherine"];

const randomItem = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)] as T;

const createId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `todo_${Date.now()}_${Math.random().toString(16).slice(2)}`;

export class FakeTodoApi {
  private readonly records = new Map<string, DemoTodo>();
  private readonly conflictOnce = new Set<string>();

  constructor() {
    this.seedRandom(4);
  }

  list(): DemoTodo[] {
    return [...this.records.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  seedRandom(count = 5): DemoTodo[] {
    const created: DemoTodo[] = [];

    for (let index = 0; index < count; index += 1) {
      const now = Date.now() - Math.floor(Math.random() * 50_000);
      const todo: DemoTodo = {
        id: createId(),
        title: randomItem(TITLES),
        completed: Math.random() > 0.65,
        assignee: randomItem(ASSIGNEES),
        createdAt: now,
        updatedAt: now
      };
      this.records.set(todo.id, todo);
      created.push(todo);
    }

    return created;
  }

  /** Mutate server copy and force the next client write to 409. */
  prepareConflict(id: string): DemoTodo | null {
    const current = this.records.get(id);

    if (!current) {
      return null;
    }

    const serverEdit: DemoTodo = {
      ...current,
      title: `SERVER: ${randomItem(TITLES)}`,
      assignee: randomItem(ASSIGNEES),
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
          const error = new Error("Fake API is offline");
          Object.assign(error, { status: 0 });
          throw error;
        }

        // Simulate latency so queue/sync feel real.
        await delay(120 + Math.floor(Math.random() * 180));
        return this.handle(request) as Promise<TransportResponse<TData>>;
      }
    };
  }

  private async handle<TBody>(request: TransportRequest<TBody>): Promise<TransportResponse> {
    const [collection, id] = request.path.replace(/^\//, "").split("/");

    if (collection !== "todos") {
      return { data: null, status: 404 };
    }

    if (request.method === "GET" && !id) {
      return { data: this.list(), status: 200 };
    }

    if (request.method === "POST" && !id) {
      const body = (request.body ?? {}) as Partial<DemoTodo>;
      const now = Date.now();
      const todo: DemoTodo = {
        id: typeof body.id === "string" ? body.id : createId(),
        title: String(body.title ?? "Untitled"),
        completed: Boolean(body.completed),
        ...(body.assignee ? { assignee: String(body.assignee) } : {}),
        createdAt: Number(body.createdAt ?? now),
        updatedAt: Number(body.updatedAt ?? now)
      };
      this.records.set(todo.id, todo);
      return { data: todo, status: 201 };
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

      const body = (request.body ?? {}) as Partial<DemoTodo>;
      const now = Date.now();
      const next: DemoTodo = {
        id,
        title: String(body.title ?? existing?.title ?? "Untitled"),
        completed: body.completed ?? existing?.completed ?? false,
        ...(body.assignee || existing?.assignee
          ? { assignee: String(body.assignee ?? existing?.assignee) }
          : {}),
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
