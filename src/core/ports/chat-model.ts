/**
 * The LLM port: the one thing the review layer needs from a language model.
 *
 * A conversation goes in, text comes out. Which vendor answers, over which
 * SDK, with which retry policy, is an infrastructure concern behind this
 * interface; the review layer never imports a provider.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface ChatResponse {
  /** The assistant's text, with any reasoning/thinking blocks dropped. */
  readonly text: string;
}

/** What a caller may say about one call, beyond the conversation itself. */
export interface ChatCallOptions {
  /**
   * Abandon the call when this aborts.
   *
   * The port carries it because a deadline that cannot cancel the work is not
   * a deadline: without a signal reaching the vendor's client, a model that
   * never answers would hold its concurrency slot for the length of the run.
   * The review layer supplies none -- it is the adapter side that imposes
   * limits -- which is why it is optional.
   */
  readonly signal?: AbortSignal;
}

export interface ChatModel {
  /** One non-streaming completion. Rejects on transport or provider failure. */
  generate(messages: readonly ChatMessage[], options?: ChatCallOptions): Promise<ChatResponse>;
}
