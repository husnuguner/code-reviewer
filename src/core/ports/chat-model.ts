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
  /**
   * This message is a prefix the run sends again and again, byte for byte:
   * the reviewer's standing prompt, a file's skills block.
   *
   * A fact about the conversation, not an instruction to a vendor. One that
   * can reuse a prompt prefix (Anthropic's prompt caching) is told which
   * messages are worth reusing; one that cannot, or does so on its own,
   * ignores the flag. The core therefore states what is stable and never
   * how any vendor caches -- which is why this is a boolean and not options.
   *
   * Only a leading run of messages can be a prefix, so the flag means
   * nothing on a message that follows an unmarked one.
   */
  readonly stable?: boolean;
}

/**
 * What one completion cost, as the vendor counted it.
 *
 * Carried so the log can say *why* a call was slow: a completion's wall time
 * is almost all output generation, so a file that took eighty seconds and a
 * file that took eight differ in this number before they differ in anything
 * else. `null` where the vendor did not say.
 */
export interface ChatUsage {
  /** Every input token, the reused ones included. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Input tokens served from a prompt prefix the vendor had kept (`stable`). */
  readonly cacheReadTokens?: number | null;
  /** Input tokens the vendor kept for later calls, at a premium, this time. */
  readonly cacheWriteTokens?: number | null;
}

export interface ChatResponse {
  /** The assistant's text, with any reasoning/thinking blocks dropped. */
  readonly text: string;
  /** Token counts for the call; absent when the adapter has none to give. */
  readonly usage?: ChatUsage;
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
