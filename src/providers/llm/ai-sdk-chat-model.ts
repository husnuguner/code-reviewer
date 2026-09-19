/**
 * The `ChatModel` port over the AI SDK: one call, once. Retrying is `RetryingChatModel`'s.
 * @packageDocumentation
 */

import { type JSONObject } from "@ai-sdk/provider";
import { type LanguageModel, type ModelMessage, type SystemModelMessage, generateText } from "ai";

import {
  type ChatCallOptions,
  type ChatMessage,
  type ChatModel,
  type ChatResponse,
} from "../../core/ports/chat-model";

/** Per-message provider options keyed by vendor, e.g. `{ anthropic: { cacheControl: … } }`. */
export type ProviderOptions = Record<string, JSONObject>;

/** Options for {@link AiSdkChatModel}. */
export interface AiSdkChatModelOptions {
  /** Attached to every `stable` message; `undefined` leaves the flag without effect. */
  readonly stablePrefix?: ProviderOptions;
}

/** Adapts an AI SDK `LanguageModel` to the `ChatModel` port. */
export class AiSdkChatModel implements ChatModel {
  private readonly stablePrefix: ProviderOptions | undefined;

  constructor(
    private readonly model: LanguageModel,
    options: AiSdkChatModelOptions = {},
  ) {
    this.stablePrefix = options.stablePrefix;
  }

  /**
   * Runs one completion with the SDK's own retry off.
   *
   * @remarks `maxRetries: 0` because the decorator above retries; two loops would multiply, and the SDK's
   * loop is invisible and skips errors that crossed a proxy.
   */
  async generate(
    messages: readonly ChatMessage[],
    options: ChatCallOptions = {},
  ): Promise<ChatResponse> {
    const { instructions, conversation } = toPrompt(messages, this.stablePrefix);
    const result = await generateText({
      model: this.model,
      ...(instructions.length > 0 && { instructions }),
      messages: conversation,
      maxRetries: 0,
      ...(options.signal !== undefined && { abortSignal: options.signal }),
    });
    const { usage } = result;
    return {
      text: result.text,
      // The SDK spells "not reported" as `undefined`; the port spells it `null`.
      usage: {
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? null,
        cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? null,
      },
    };
  }
}

/** The conversation as the SDK takes it: system messages apart from the turns. */
export interface SdkPrompt {
  /** The system messages, in order. */
  readonly instructions: SystemModelMessage[];
  readonly conversation: ModelMessage[];
}

/**
 * Splits the port's messages the way the SDK wants them, attaching `stablePrefix` to every stable one.
 *
 * @remarks `instructions` is a list of system messages, not one joined string, so each block can carry
 * the option that asks a vendor to keep it.
 */
export function toPrompt(
  messages: readonly ChatMessage[],
  stablePrefix: ProviderOptions | undefined,
): SdkPrompt {
  const instructions: SystemModelMessage[] = [];
  const conversation: ModelMessage[] = [];
  for (const message of messages) {
    const options =
      stablePrefix !== undefined && message.stable === true
        ? { providerOptions: stablePrefix }
        : {};
    if (message.role === "system") {
      instructions.push({ role: "system", content: message.content, ...options });
    } else {
      conversation.push({ role: message.role, content: message.content, ...options });
    }
  }
  return { instructions, conversation };
}
