/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import type { OfflineDB, OfflineEventName, OfflineEvents, StorageAdapter } from "@offlinejs/types";
import { createDevtoolsController, openOfflineDevtools } from "./index";

describe("devtools ui", () => {
  it("records events, live-renders via mount, and disposes listeners", () => {
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
    const target = document.createElement("div");

    controller.mount(target);
    expect(target.innerHTML).toContain("Waiting for sync");
    expect(target.innerHTML).toContain("OfflineJS DevTools");

    listeners.get("coordination:message")?.({
      id: "1",
      payload: "<unsafe>",
      source: "test",
      timestamp: 1,
      type: "sync:request"
    });

    expect(controller.events()).toHaveLength(1);
    expect(controller.events()[0]?.event).toBe("coordination:message");
    expect(target.innerHTML).toContain("coordination:message");
    expect(target.innerHTML).toContain("&lt;unsafe&gt;");
    expect(target.innerHTML).toContain("Action");
    expect(target.innerHTML).toContain("State / Outbox");

    controller.destroy();
    expect(disposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });

  it("opens a floating dock, pauses recording, and inspects outbox state", async () => {
    const listeners = new Map<OfflineEventName, (payload: unknown) => void>();
    const storage = {
      find: vi.fn(async () => [{ id: "m1", collection: "stock", operation: "update", status: "pending" }])
    } as unknown as StorageAdapter;
    const db = {
      on(name: OfflineEventName, listener: (payload: OfflineEvents[typeof name]) => void) {
        listeners.set(name, listener as (payload: unknown) => void);
        return vi.fn();
      }
    } as unknown as OfflineDB;

    const controller = openOfflineDevtools(db, { storage, position: "bottom" });
    const dock = document.querySelector<HTMLElement>("[data-offlinejs-devtools='true']");
    expect(dock).toBeTruthy();
    expect(dock?.className).toContain("ojd-dock");

    listeners.get("queue:add")?.({
      id: "q1",
      collection: "stock",
      operation: "update",
      recordId: "r1",
      createdAt: 1,
      priority: 0,
      retries: 0,
      status: "pending",
      payload: { qty: 3 }
    });

    expect(controller.events()[0]?.seq).toBe(1);
    expect(dock?.innerHTML).toContain("queue:add");

    controller.pause();
    listeners.get("sync:start")?.({ mode: "full", queued: 1 });
    expect(controller.events()).toHaveLength(1);

    controller.resume();
    listeners.get("error")?.(new Error("boom"));
    expect(controller.events()[0]?.payload).toMatchObject({ message: "boom" });

    const stateTab = dock?.querySelector<HTMLElement>('[data-ojd-action="tab-state"]');
    stateTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(storage.find).toHaveBeenCalled();
    expect(dock?.innerHTML).toContain("Outbox snapshot");

    controller.clear();
    expect(controller.events()).toHaveLength(0);

    controller.close();
    expect(document.querySelector("[data-offlinejs-devtools='true']")).toBeNull();
    controller.destroy();
  });
});
