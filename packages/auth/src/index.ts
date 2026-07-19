import type {
  OfflinePlugin,
  SyncTransport,
  TransportRequest,
  TransportResponse
} from "@offlinejs/types";

export interface AuthTokenProvider {
  getToken(): Promise<string | null> | string | null;
}

export interface AuthTransportOptions {
  headerName?: string;
  scheme?: string;
  tokenProvider: AuthTokenProvider | (() => Promise<string | null> | string | null);
}

export const createAuthTransport = (
  transport: SyncTransport,
  options: AuthTransportOptions
): SyncTransport => ({
  async request<TData = unknown, TBody = unknown>(
    request: TransportRequest<TBody>
  ): Promise<TransportResponse<TData>> {
    const token = await resolveToken(options.tokenProvider);
    const headerName = options.headerName ?? "authorization";
    const scheme = options.scheme ?? "Bearer";

    return transport.request<TData, TBody>({
      ...request,
      headers: {
        ...request.headers,
        ...(token ? { [headerName]: `${scheme} ${token}` } : {})
      }
    });
  }
});

export const authPlugin = (options: AuthTransportOptions): OfflinePlugin => ({
  name: "auth",
  setup({ events }) {
    void resolveToken(options.tokenProvider).then((token) => {
      if (!token) {
        events.emit("error", new Error("OfflineJS auth plugin did not receive a token"));
      }
    });
  }
});

const resolveToken = (
  provider: AuthTokenProvider | (() => Promise<string | null> | string | null)
): Promise<string | null> => {
  if (typeof provider === "function") {
    return Promise.resolve(provider());
  }

  return Promise.resolve(provider.getToken());
};
