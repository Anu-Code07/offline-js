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
});
