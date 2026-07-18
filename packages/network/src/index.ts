import type {
  NetworkMonitor,
  NetworkState,
  SyncTransport,
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

export interface FetchTransportOptions {
  baseURL: string;
  fetch?: typeof fetch;
  headers?: Record<string, string> | (() => Promise<Record<string, string>> | Record<string, string>);
}

export class FetchTransport implements SyncTransport {
  private readonly baseURL: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly headers?: FetchTransportOptions["headers"];

  constructor(options: FetchTransportOptions) {
    this.baseURL = options.baseURL.replace(/\/$/, "");
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.headers = options.headers;

    if (!this.fetchImplementation) {
      throw new Error("A fetch implementation is required for this runtime");
    }
  }

  async request<TData = unknown, TBody = unknown>(
    request: TransportRequest<TBody>
  ): Promise<TransportResponse<TData>> {
    const headers = {
      "content-type": "application/json",
      ...(await this.resolveHeaders()),
      ...request.headers
    };
    const response = await this.fetchImplementation(
      `${this.baseURL}${request.path}${toQueryString(request.query)}`,
      {
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        headers,
        method: request.method
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
      etag: response.headers.get("etag") ?? undefined,
      status: response.status
    };
  }

  private async resolveHeaders(): Promise<Record<string, string>> {
    if (!this.headers) {
      return {};
    }

    return typeof this.headers === "function" ? this.headers() : this.headers;
  }
}

export const createNetworkMonitor = (
  options?: BrowserNetworkMonitorOptions
): BrowserNetworkMonitor => new BrowserNetworkMonitor(options);

export const createFetchTransport = (options: FetchTransportOptions): FetchTransport =>
  new FetchTransport(options);
