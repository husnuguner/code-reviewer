/**
 * The default `IEventPublisher`: a set of listeners and a way to tell them.
 * @packageDocumentation
 */

import { type Event, type IEventPublisher, type Listener } from "./event.abstraction";

/** Stores listeners; the owner hands out `addListener` and keeps `emit`. */
export class EventPublisher<T> implements IEventPublisher<T> {
  private readonly listeners = new Set<Listener<T>>();

  readonly addListener: Event<T> = (listener) => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  /** Tells every current listener, over a snapshot so one that unsubscribes mid-call skips nobody. */
  emit(data: T): void {
    const current = [...this.listeners];
    for (const listener of current) listener(data);
  }
}
