import { createDevtoolsController, type DevtoolsController, type DevtoolsUiOptions } from "@offlinejs/devtools-ui";
import type { OfflineEventName, OfflineEvents, OfflinePlugin } from "@offlinejs/types";

export interface DevtoolsPluginOptions {
  logger?: Pick<Console, "debug" | "error">;
  /**
   * Open a Redux-style floating DevTools dock when the plugin boots.
   * Pass `true` for defaults, or UI options (`position`, `maxEvents`, …).
   */
  ui?: boolean | DevtoolsUiOptions;
}

const eventNames: OfflineEventName[] = [
  "sync:start",
  "sync:end",
  "offline",
  "online",
  "queue:add",
  "queue:complete",
  "conflict",
  "error",
  "worker:message",
  "coordination:message"
];

export const devtools = (options: DevtoolsPluginOptions = {}): OfflinePlugin => ({
  name: "devtools",
  setup({ db, events, storage }) {
    const logger = options.logger ?? console;
    const disposers = eventNames.map((eventName) =>
      events.on(eventName, (payload: OfflineEvents[typeof eventName]) => {
        if (eventName === "error") {
          logger.error("[offlinejs]", eventName, payload);
          return;
        }

        logger.debug("[offlinejs]", eventName, payload);
      })
    );

    let panel: DevtoolsController | undefined;
    if (options.ui && typeof document !== "undefined") {
      const uiOptions = options.ui === true ? {} : options.ui;
      panel = createDevtoolsController(db, {
        ...uiOptions,
        storage: uiOptions.storage ?? storage
      });
      panel.open();
    }

    return () => {
      panel?.destroy();
      for (const dispose of disposers) {
        dispose();
      }
    };
  }
});

export type { DevtoolsController, DevtoolsUiOptions } from "@offlinejs/devtools-ui";
