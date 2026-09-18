/**
 * The default `IEventPublisher`: a set of listeners and a way to tell them.
 *
 * Its owner keeps the publisher private and hands out `addListener` as the
 * public event, so subscribing is possible from outside and emitting is not.
 *
 * Not `EventTarget`, and not named `EventEmitter`: both of those carry a
 * string-keyed API, and a string key is exactly what this design removes --
 * a subscriber that misspells an event name should not compile.
 */

import { type Event, type IEventPublisher, type Listener } from "./event.abstraction";

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

  /**
   * Tell every current listener.
   *
   * Over a snapshot: a listener that unsubscribes itself while being called is
   * ordinary, and mutating the set mid-iteration would skip its neighbour.
   */
  emit(data: T): void {
    const current = [...this.listeners];
    for (const listener of current) listener(data);
  }
}
