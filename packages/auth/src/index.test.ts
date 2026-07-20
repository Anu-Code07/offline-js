import { describe, expect, it, vi } from "vitest";
import type { EventBus, OfflineEvents, SyncTransport } from "@offlinejs/types";
import { authPlugin, createAuthTransport } from "./index";

describe("auth", () => {
  it("adds bearer tokens to transport requests", async () => {
    const request = vi.fn(async (input) => ({ data: input.headers, status: 200 }));
    const transport = createAuthTransport({ request } as SyncTransport, {
      tokenProvider: () => "token"
    });

    await expect(transport.request({ method: "GET", path: "/users" })).resolves.toEqual({
      data: { authorization: "Bearer token" },
      status: 200
    });
  });

  it("supports custom header and token provider objects", async () => {
    const request = vi.fn(async (input) => ({ data: input.headers, status: 200 }));
    const transport = createAuthTransport({ request } as SyncTransport, {
      headerName: "x-api-key",
      scheme: "Token",
      tokenProvider: { getToken: () => "abc" }
    });

    await transport.request({ headers: { existing: "1" }, method: "POST", path: "/users" });

    expect(request).toHaveBeenCalledWith({
      headers: { existing: "1", "x-api-key": "Token abc" },
      method: "POST",
      path: "/users"
    });
  });

  it("emits an error when auth plugin has no token", async () => {
    const emit = vi.fn();
    const plugin = authPlugin({ tokenProvider: () => null });

    plugin.setup({
      db: undefined as never,
      events: { emit } as unknown as EventBus<OfflineEvents>,
      network: undefined as never,
      storage: undefined as never
    });
    await Promise.resolve();

    expect(emit).toHaveBeenCalledWith("error", expect.any(Error));
  });

  it("refreshes tokens and retries once on 401 responses", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("unauthorized"), { status: 401 }))
      .mockResolvedValueOnce({ data: { ok: true }, status: 200 });
    const refreshToken = vi.fn(async () => "fresh");
    const transport = createAuthTransport({ request } as SyncTransport, {
      refreshToken,
      tokenProvider: () => "stale"
    });

    await expect(transport.request({ method: "GET", path: "/secure" })).resolves.toEqual({
      data: { ok: true },
      status: 200
    });
    expect(refreshToken).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("invokes onUnauthorized when refresh fails", async () => {
    const onUnauthorized = vi.fn();
    const request = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("unauthorized"), { status: 401 }));
    const transport = createAuthTransport({ request } as SyncTransport, {
      onUnauthorized,
      refreshToken: async () => null,
      tokenProvider: { getToken: () => "stale", refreshToken: async () => null }
    });

    await expect(transport.request({ method: "GET", path: "/secure" })).rejects.toMatchObject({
      status: 401
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("refreshes tokens from auth plugin error events", async () => {
    const onUnauthorized = vi.fn();
    const refreshToken = vi.fn(async () => null);
    let errorListener: ((error: Error) => void) | undefined;
    const plugin = authPlugin({
      onUnauthorized,
      refreshToken,
      tokenProvider: () => "token"
    });

    plugin.setup({
      db: undefined as never,
      events: {
        emit: vi.fn(),
        on(_name: keyof OfflineEvents, listener: (payload: OfflineEvents[keyof OfflineEvents]) => void) {
          errorListener = listener as (error: Error) => void;
          return vi.fn();
        }
      } as unknown as EventBus<OfflineEvents>,
      network: undefined as never,
      storage: undefined as never
    });

    errorListener?.(Object.assign(new Error("unauthorized"), { status: 401 }));
    await vi.waitFor(() => {
      expect(refreshToken).toHaveBeenCalledOnce();
      expect(onUnauthorized).toHaveBeenCalledOnce();
    });
  });
});
