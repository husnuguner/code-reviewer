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

export interface ChatModel {
  /** One non-streaming completion. Rejects on transport or provider failure. */
  generate(messages: readonly ChatMessage[]): Promise<ChatResponse>;
}
