/**
 * Plain-TS synchronous event bus. Handlers run in subscription order; a handler that throws is
 * logged and does not stop the others (a UI bug must not break the simulation).
 */
import type { CreateEventBus, EventBus, GameEventName } from '../types';

type AnyHandler = (payload: unknown) => void;

export const createEventBus: CreateEventBus = () => {
  const handlers = new Map<GameEventName, Set<AnyHandler>>();

  const bus: EventBus = {
    on(name, handler) {
      let set = handlers.get(name);
      if (!set) {
        set = new Set();
        handlers.set(name, set);
      }
      set.add(handler as AnyHandler);
      return () => bus.off(name, handler);
    },
    off(name, handler) {
      handlers.get(name)?.delete(handler as AnyHandler);
    },
    emit(name, payload) {
      const set = handlers.get(name);
      if (!set || set.size === 0) return;
      for (const h of [...set]) {
        try {
          h(payload);
        } catch (err) {
          console.error(`[events] handler for ${name} threw`, err);
        }
      }
    },
  };
  return bus;
};
