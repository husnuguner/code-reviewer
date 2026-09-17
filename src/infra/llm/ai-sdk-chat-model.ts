/**
 * The `ChatModel` port implemented over the AI SDK.
 *
 * One adapter serves every provider the AI SDK knows, so adding a vendor means
 * adding a `LanguageModel` factory, never another chat loop. The review layer
 * sees only `generate(messages) -> { text }`.
 */

import { type LanguageModel, type ModelMessage, generateText } from "ai";

import { type ChatMessage, type ChatModel, type ChatResponse } from "../../core/ports/chat-model";

/** How many times a failed call is retried by the SDK before it surfaces. */
export const MAX_RETRIES = 3;

export class AiSdkChatModel implements ChatModel {
  constructor(
    private readonly model: LanguageModel,
    private readonly maxRetries: number = MAX_RETRIES,
  ) {}

  async generate(messages: readonly ChatMessage[]): Promise<ChatResponse> {
    const { instructions, conversation } = splitSystem(messages);
    const result = await generateText({
      model: this.model,
      ...(instructions !== undefined && { instructions }),
      messages: conversation,
      maxRetries: this.maxRetries,
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
