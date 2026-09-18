/**
 * An event is its own subscribe function.
 *
 * Not a name passed to `on(...)`: a subscriber that misspells `"onRetry"` gets
 * silence, and silence is the one thing a telemetry hook must not produce.
 * Here the event is a property, so the compiler checks the name and the
 * listener's argument type arrives with it.
 */

import { type IDisposable } from "./disposable.abstraction";

export type Listener<T> = (data: T) => void;

/** Subscribe to an event; the result unsubscribes. */
export type Event<T> = (listener: Listener<T>) => IDisposable;

/**
 * The writable half, which an owner keeps to itself.
 *
 * Declared as an interface so a policy can depend on the ability to publish
 * without depending on the implementation that stores the listeners.
 */
export interface IEventPublisher<T> {
  /** The readable half, to hand out as the event itself. */
  readonly addListener: Event<T>;
  emit(data: T): void;
}
