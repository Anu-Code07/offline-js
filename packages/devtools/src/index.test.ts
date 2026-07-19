import { describe, expect, it, vi } from "vitest";
import type { EventBus, OfflineEvents } from "@offlinejs/types";
import { devtools } from "./index";

describe("devtools plugin", () => {
  it("logs events and disposes listeners", () => {
    const debug = vi.fn();
    const error = vi.fn();
    const disposers: Array<ReturnType<typeof vi.fn>> = [];
    const listeners = new Map<string, (payload: unknown) => void>();
    const plugin = devtools({ logger: { debug, error } });
    const dispose = plugin.setup({
      db: undefined as never,
      events: {
        on(
          name: keyof OfflineEvents,
          listener: (payload: OfflineEvents[keyof OfflineEvents]) => void
        ) {
          listeners.set(String(name), listener as (payload: unknown) => void);
          const disposer = vi.fn();
          disposers.push(disposer);
          return disposer;
        }
      } as unknown as EventBus<OfflineEvents>,
      network: undefined as never,
      storage: undefined as never
    }) as () => void;

    listeners.get("sync:start")?.({ mode: "full", queued: 1 });
    listeners.get("error")?.(new Error("bad"));
    dispose();

    expect(debug).toHaveBeenCalledWith("[offlinejs]", "sync:start", { mode: "full", queued: 1 });
    expect(error).toHaveBeenCalledWith("[offlinejs]", "error", expect.any(Error));
    expect(disposers.every((disposer) => disposer.mock.calls.length === 1)).toBe(true);
  });
});
