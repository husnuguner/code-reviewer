/**
 * Typed events: an event is its own subscribe function, and the result of
 * subscribing is the way to stop.
 *
 * `EventPublisher` is exported here for the policies that emit; the library's
 * public surface (`../index`) deliberately leaves it out, because a consumer
 * only ever subscribes.
 */

export { type IDisposable } from "./disposable.abstraction";
export { type Event, type IEventPublisher, type Listener } from "./event.abstraction";
export { EventPublisher } from "./event.publisher";
