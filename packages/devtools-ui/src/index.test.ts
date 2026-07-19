import { describe, expect, it, vi } from "vitest";
import type { OfflineDB, OfflineEventName, OfflineEvents } from "@offlinejs/types";
import { createDevtoolsController } from "./index";

describe("devtools ui", () => {
  it("records events, renders escaped markup, and disposes listeners", () => {
    const listeners = new Map<OfflineEventName, (payload: unknown) => void>();
    const disposers: Array<ReturnType<typeof vi.fn>> = [];
    const db = {
      on(name: OfflineEventName, listener: (payload: OfflineEvents[typeof name]) => void) {
        listeners.set(name, listener as (payload: unknown) => void);
        const dispose = vi.fn();
        disposers.push(dispose);
        return dispose;
      }
    } as unknown as OfflineDB;
    const controller = createDevtoolsController(db);
    const target = { innerHTML: "" } as HTMLElement;

    listeners.get("coordination:message")?.({
      id: "1",
      payload: "<unsafe>",
      source: "test",
      timestamp: 1,
      type: "sync:request"
    });
    controller.render(target);

    expect(controller.events()).toHaveLength(1);
    expect(target.innerHTML).toContain("OfflineJS Devtools");
    expect(target.innerHTML).toContain("&lt;unsafe&gt;");

    controller.destroy();

    expect(disposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });
});
