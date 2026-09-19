/**
 * Typed events. `EventPublisher` is exported here for the policies that emit; the library's public
 * surface leaves it out.
 * @packageDocumentation
 */

export { type IDisposable } from "./disposable.abstraction";
export { type Event, type IEventPublisher, type Listener } from "./event.abstraction";
export { EventPublisher } from "./event.publisher";
