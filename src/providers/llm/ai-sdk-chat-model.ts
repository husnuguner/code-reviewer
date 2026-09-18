/**
 * The `ChatModel` port implemented over the AI SDK.
 *
 * One adapter serves every provider the AI SDK knows, so adding a vendor means
 * adding a `LanguageModel` factory, never another chat loop. The review layer
 * sees only `generate(messages) -> { text }`.
 *
 * One call, once. Trying again is a policy, and it lives in a decorator
 * (`RetryingChatModel`) rather than in here -- so that it is the same policy
 * the HTTP transport uses, says what it did, and cannot be configured twice.
 */

import { type LanguageModel, type ModelMessage, generateText } from "ai";

import {
  type ChatCallOptions,
  type ChatMessage,
  type ChatModel,
  type ChatResponse,
} from "../../core/ports/chat-model";

export class AiSdkChatModel implements ChatModel {
  constructor(private readonly model: LanguageModel) {}

  async generate(
    messages: readonly ChatMessage[],
    options: ChatCallOptions = {},
  ): Promise<ChatResponse> {
    const { instructions, conversation } = splitSystem(messages);
    const result = await generateText({
      model: this.model,
      ...(instructions !== undefined && { instructions }),
      messages: conversation,
      // The SDK's own retry is off, and this adapter does not try again
      // either: `RetryingChatModel` above it does, and two loops would
      // multiply into nine calls where three were meant.
      //
      // Turning it off buys more than arithmetic. The SDK decides what is
      // retryable by asking `APICallError.isInstance(error)`, and an error
      // that crossed a gateway or a proxy does not answer to that -- so the
      // retry an operator thought they had configured silently was not one.
      // It is also invisible: the SDK offers no hook, so nothing could be
      // said about a call that was quietly made four times.
      maxRetries: 0,
      ...(options.signal !== undefined && { abortSignal: options.signal }),
    });
    return { text: result.text };
  }
}

/**
 * The SDK carries the system prompt as `instructions`, not as a message; a
 * conversation with several system messages joins them in order.
 */
export function splitSystem(messages: readonly ChatMessage[]): {
  instructions: string | undefined;
  conversation: ModelMessage[];
} {
  const systems: string[] = [];
  const conversation: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      systems.push(message.content);
    } else {
      conversation.push({ role: message.role, content: message.content });
    }
  }
  return { instructions: systems.length > 0 ? systems.join("\n\n") : undefined, conversation };
}
