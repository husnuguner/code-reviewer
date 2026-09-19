/**
 * Typed events: an event is its own subscribe function, so a misspelt name does not compile.
 * @packageDocumentation
 */

import { type IDisposable } from "./disposable.abstraction";

/** Receives one event. */
export type Listener<T> = (data: T) => void;

/** Subscribes to an event; the result unsubscribes. */
export type Event<T> = (listener: Listener<T>) => IDisposable;

/** The writable half, which an owner keeps to itself. */
export interface IEventPublisher<T> {
  /** The readable half, handed out as the event itself. */
  readonly addListener: Event<T>;
  emit(data: T): void;
}
