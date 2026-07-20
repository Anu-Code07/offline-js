import type {
  OfflinePlugin,
  SyncTransport,
  TransportRequest,
  TransportResponse
} from "@offlinejs/types";

export interface AuthTokenProvider {
  getToken(): Promise<string | null> | string | null;
  refreshToken?(): Promise<string | null> | string | null;
}

export interface AuthTransportOptions {
  headerName?: string;
  onUnauthorized?: () => Promise<void> | void;
  refreshToken?: () => Promise<string | null> | string | null;
  retryOnUnauthorized?: boolean;
  scheme?: string;
  tokenProvider: AuthTokenProvider | (() => Promise<string | null> | string | null);
}

export const createAuthTransport = (
  transport: SyncTransport,
  options: AuthTransportOptions
): SyncTransport => ({
  ...(transport.contractVersion === undefined
    ? {}
    : { contractVersion: transport.contractVersion }),
  async request<TData = unknown, TBody = unknown>(
    request: TransportRequest<TBody>
  ): Promise<TransportResponse<TData>> {
    const send = async (): Promise<TransportResponse<TData>> => {
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
    };

    try {
      return await send();
    } catch (error) {
      if (!shouldRetryUnauthorized(error, options)) {
        throw error;
      }

      const refreshed = await refreshAuthToken(options);
      if (!refreshed) {
        await options.onUnauthorized?.();
        throw error;
      }

      return send();
    }
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

    if (typeof events.on !== "function") {
      return;
    }

    return events.on("error", (error) => {
      if (!isUnauthorizedError(error)) {
        return;
      }

      void refreshAuthToken(options)
        .then((token) => {
          if (!token) {
            return options.onUnauthorized?.();
          }
        })
        .catch((refreshError) => {
          events.emit(
            "error",
            refreshError instanceof Error ? refreshError : new Error(String(refreshError))
          );
        });
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

const refreshAuthToken = async (options: AuthTransportOptions): Promise<string | null> => {
  if (options.refreshToken) {
    return Promise.resolve(options.refreshToken());
  }

  if (typeof options.tokenProvider !== "function" && options.tokenProvider.refreshToken) {
    return Promise.resolve(options.tokenProvider.refreshToken());
  }

  return null;
};

const shouldRetryUnauthorized = (error: unknown, options: AuthTransportOptions): boolean => {
  if (!isUnauthorizedError(error)) {
    return false;
  }

  if (options.retryOnUnauthorized === false) {
    return false;
  }

  return Boolean(
    options.refreshToken ||
      (typeof options.tokenProvider !== "function" && options.tokenProvider.refreshToken)
  );
};

const isUnauthorizedError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  (error as { status?: number }).status === 401;
