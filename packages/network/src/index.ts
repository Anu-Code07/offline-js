import type {
  NetworkMonitor,
  NetworkState,
  SyncTransport,
  TransportOptions,
  TransportRequest,
  TransportResponse
} from "@offlinejs/types";
import { toQueryString } from "@offlinejs/utils";

export interface BrowserNetworkMonitorOptions {
  initialOnline?: boolean;
}

export class BrowserNetworkMonitor implements NetworkMonitor {
  private listeners = new Set<(state: NetworkState) => void>();
  private state: NetworkState;

  constructor(options: BrowserNetworkMonitorOptions = {}) {
    const navigatorOnline =
      typeof globalThis.navigator !== "undefined" ? globalThis.navigator.onLine : true;

    this.state = {
      online: options.initialOnline ?? navigatorOnline,
      since: Date.now()
    };

    globalThis.addEventListener?.("online", this.handleOnline);
    globalThis.addEventListener?.("offline", this.handleOffline);
  }

  getState(): NetworkState {
    return { ...this.state };
  }

  isOnline(): boolean {
    return this.state.online;
  }

  setOnline(online: boolean): void {
    this.update(online);
  }

  subscribe(listener: (state: NetworkState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());

    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    globalThis.removeEventListener?.("online", this.handleOnline);
    globalThis.removeEventListener?.("offline", this.handleOffline);
    this.listeners.clear();
  }

  private handleOnline = (): void => {
    this.update(true);
  };

  private handleOffline = (): void => {
    this.update(false);
  };

  private update(online: boolean): void {
    if (this.state.online === online) {
      return;
    }

    this.state = { online, since: Date.now() };

    for (const listener of this.listeners) {
      listener(this.getState());
    }
  }
}

export type FetchTransportOptions = TransportOptions;

export class FetchTransport implements SyncTransport {
  private readonly baseURL: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly headers: FetchTransportOptions["headers"] | undefined;
  private readonly middlewares: NonNullable<FetchTransportOptions["middlewares"]>;
  private readonly timeoutMs: number | undefined;

  constructor(options: FetchTransportOptions) {
    this.baseURL = options.baseURL.replace(/\/$/, "");
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.headers = options.headers;
    this.middlewares = options.middlewares ?? [];
    this.timeoutMs = options.timeoutMs;

    if (!this.fetchImplementation) {
      throw new Error("A fetch implementation is required for this runtime");
    }
  }

  async request<TData = unknown, TBody = unknown>(
    request: TransportRequest<TBody>
  ): Promise<TransportResponse<TData>> {
    const preparedRequest = await this.applyMiddlewares(request);
    const headers = {
      "content-type": "application/json",
      ...(await this.resolveHeaders()),
      ...preparedRequest.headers
    };
    const timeoutMs = preparedRequest.timeoutMs ?? this.timeoutMs;
    const controller = timeoutMs ? new AbortController() : undefined;
    const timeoutId = timeoutMs
      ? globalThis.setTimeout(() => controller?.abort(), timeoutMs)
      : undefined;

    try {
      const response = await this.fetchImplementation(
        `${this.baseURL}${preparedRequest.path}${toQueryString(preparedRequest.query)}`,
        {
          headers,
          method: preparedRequest.method,
          ...(controller ? { signal: controller.signal } : {}),
          ...(preparedRequest.body === undefined
            ? {}
            : { body: JSON.stringify(preparedRequest.body) })
        }
      );

      const text = await response.text();
      const data = text.length > 0 ? (JSON.parse(text) as TData) : (undefined as TData);

      if (!response.ok) {
        const error = new Error(`Request failed with status ${response.status}`);
        Object.assign(error, { data, status: response.status });
        throw error;
      }

      return {
        data,
        status: response.status,
        ...(response.headers.get("etag") ? { etag: response.headers.get("etag") as string } : {})
      };
    } finally {
      if (timeoutId) {
        globalThis.clearTimeout(timeoutId);
      }
    }
  }

  private async resolveHeaders(): Promise<Record<string, string>> {
    if (!this.headers) {
      return {};
    }

    return typeof this.headers === "function" ? this.headers() : this.headers;
  }

  private async applyMiddlewares<TBody>(
    request: TransportRequest<TBody>
  ): Promise<TransportRequest<TBody>> {
    let nextRequest = request;

    for (const middleware of this.middlewares) {
      nextRequest = await middleware({ request: nextRequest });
    }

    return nextRequest;
  }
}

export const createNetworkMonitor = (
  options?: BrowserNetworkMonitorOptions
): BrowserNetworkMonitor => new BrowserNetworkMonitor(options);

export const createFetchTransport = (options: FetchTransportOptions): FetchTransport =>
  new FetchTransport(options);
