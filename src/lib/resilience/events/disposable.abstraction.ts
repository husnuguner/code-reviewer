/**
 * The one thing every subscription in this library hands back.
 *
 * Separate from the event that produces it because a great many things can be
 * disposed and almost none of them are events; a consumer that only needs to
 * unsubscribe should not have to name the event type to say so.
 */
export interface IDisposable {
  /** Undo the subscription. Safe to call more than once. */
  dispose(): void;
}
