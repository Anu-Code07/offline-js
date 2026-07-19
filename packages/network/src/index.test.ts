import { describe, expect, it, vi } from "vitest";
import {
  BrowserNetworkMonitor,
  createFetchTransport,
  createNetworkMonitor,
  FetchTransport
} from "./index";

describe("network", () => {
  it("tracks browser network state transitions", () => {
    const monitor = new BrowserNetworkMonitor({ initialOnline: false });
    const listener = vi.fn();
    const unsubscribe = monitor.subscribe(listener);

    monitor.setOnline(true);
    monitor.setOnline(true);
    unsubscribe();
    monitor.setOnline(false);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(monitor.getState().online).toBe(false);
    monitor.destroy();
  });

  it("applies middleware, headers, query strings, JSON body, and etag", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { etag: "v1" },
          status: 200
        })
    );
    const transport = new FetchTransport({
      baseURL: "https://api.example.com/",
      fetch: fetchMock as unknown as typeof fetch,
      headers: async () => ({ authorization: "Bearer token" }),
      middlewares: [
        ({ request }) => ({
          ...request,
          headers: { ...request.headers, "x-request-id": "1" },
          query: { ...request.query, page: 1 }
        })
      ],
      timeoutMs: 1000
    });

    await expect(
      transport.request({
        body: { name: "Ada" },
        method: "POST",
        path: "/users",
        query: { active: true }
      })
    ).resolves.toEqual({ data: { ok: true }, etag: "v1", status: 200 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/users?active=true&page=1",
      expect.objectContaining({
        body: JSON.stringify({ name: "Ada" }),
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "x-request-id": "1"
        },
        method: "POST"
      })
    );
  });

  it("throws response errors with status and data", async () => {
    const transport = new FetchTransport({
      baseURL: "https://api.example.com",
      fetch: vi.fn(async () => new Response(JSON.stringify({ message: "no" }), { status: 500 }))
    });

    await expect(transport.request({ method: "GET", path: "/fail" })).rejects.toMatchObject({
      status: 500
    });
  });

  it("creates monitor and transport through factories", async () => {
    const monitor = createNetworkMonitor({ initialOnline: true });
    const transport = createFetchTransport({
      baseURL: "https://api.example.com",
      fetch: vi.fn(async () => new Response("", { status: 200 }))
    });

    expect(monitor.isOnline()).toBe(true);
    await expect(transport.request({ method: "GET", path: "/empty" })).resolves.toEqual({
      data: undefined,
      status: 200
    });
    monitor.destroy();
  });
});
