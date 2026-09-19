/**
 * The LLM port: a conversation in, text out. Vendor, SDK and retries live behind it.
 * @packageDocumentation
 */

/** Who a message is from. */
export type ChatRole = "system" | "user" | "assistant";

/** One message of a conversation. */
export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
  /**
   * Marks a prefix the run resends byte for byte (standing prompt, skills block).
   *
   * @remarks A fact, not a vendor instruction: an adapter with prompt caching uses it, others ignore it.
   * Only a leading run of marked messages is a prefix.
   */
  readonly stable?: boolean;
}

/** What one completion cost, as the vendor counted it; `null` where it did not say. */
export interface ChatUsage {
  /** Every input token, reused ones included. */
  readonly inputTokens: number | null;
  /** Output tokens generated. */
  readonly outputTokens: number | null;
  /** Input tokens served from a kept prefix. */
  readonly cacheReadTokens?: number | null;
  /** Input tokens written to the vendor's cache this call. */
  readonly cacheWriteTokens?: number | null;
}

/** One completion. */
export interface ChatResponse {
  /** The assistant's text, reasoning blocks dropped. */
  readonly text: string;
  /** Token counts; absent when the adapter has none. */
  readonly usage?: ChatUsage;
}

/** Per-call options beyond the conversation. */
export interface ChatCallOptions {
  /** Abandons the call when it aborts. Supplied by the adapter side, not the review layer. */
  readonly signal?: AbortSignal;
}

/** A language model that answers one conversation with one completion. */
export interface ChatModel {
  /**
   * Runs one non-streaming completion.
   *
   * @throws On transport or provider failure.
   */
  generate(messages: readonly ChatMessage[], options?: ChatCallOptions): Promise<ChatResponse>;
}
