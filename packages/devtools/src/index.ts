import type { OfflineEventName, OfflineEvents, OfflinePlugin } from "@offlinejs/types";

export interface DevtoolsPluginOptions {
  logger?: Pick<Console, "debug" | "error">;
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
  setup({ events }) {
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

    return () => {
      for (const dispose of disposers) {
        dispose();
      }
    };
  }
});
