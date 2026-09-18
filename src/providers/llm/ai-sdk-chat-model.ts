/**
 * The `ChatModel` port implemented over the AI SDK.
 *
 * One adapter serves every provider the AI SDK knows, so adding a vendor means
 * adding a `LanguageModel` factory, never another chat loop. The review layer
 * sees only `generate(messages) -> { text, usage }`.
 *
 * One call, once. Trying again is a policy, and it lives in a decorator
 * (`RetryingChatModel`) rather than in here -- so that it is the same policy
 * the HTTP transport uses, says what it did, and cannot be configured twice.
 *
 * The one vendor-shaped thing this adapter is handed is `stablePrefix`: the
 * provider options that ask a vendor to keep a message for reuse. The core
 * marks which messages are stable (`ChatMessage.stable`); the vendor class
 * says what that means to its API (`AiSdkProvider.stablePrefix`); this
 * adapter only joins the two, so neither has to know the other exists.
 */

import { type JSONObject } from "@ai-sdk/provider";
import { type LanguageModel, type ModelMessage, type SystemModelMessage, generateText } from "ai";

import {
  type ChatCallOptions,
  type ChatMessage,
  type ChatModel,
  type ChatResponse,
} from "../../core/ports/chat-model";

/**
 * Provider options the AI SDK forwards per message, keyed by vendor
 * (`{ anthropic: { cacheControl: ... } }`). A vendor ignores every key that
 * is not its own, so options meant for one cannot upset another.
 */
export type ProviderOptions = Record<string, JSONObject>;

export interface AiSdkChatModelOptions {
  /**
   * What to attach to a `stable` message so the vendor keeps it; `undefined`
   * for a vendor with nothing to ask for, which is also what leaves the
   * flag without effect.
   */
  readonly stablePrefix?: ProviderOptions;
}

export class AiSdkChatModel implements ChatModel {
  private readonly stablePrefix: ProviderOptions | undefined;

  constructor(
    private readonly model: LanguageModel,
    options: AiSdkChatModelOptions = {},
  ) {
    this.stablePrefix = options.stablePrefix;
  }

  async generate(
    messages: readonly ChatMessage[],
    options: ChatCallOptions = {},
  ): Promise<ChatResponse> {
    const { instructions, conversation } = toPrompt(messages, this.stablePrefix);
    const result = await generateText({
      model: this.model,
      ...(instructions.length > 0 && { instructions }),
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
    const { usage } = result;
    return {
      text: result.text,
      // The vendor's own count, handed up so the log can say what a slow call
      // spent its time on. The SDK spells "not reported" as `undefined`; the
      // port spells it `null`, so a reader cannot mistake it for a key left out.
      usage: {
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? null,
        cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? null,
      },
    };
  }
}

/** The port's conversation as the SDK takes it: system prompt apart from the turns. */
export interface SdkPrompt {
  /** The system messages, in order; empty when there were none. */
  readonly instructions: SystemModelMessage[];
  readonly conversation: ModelMessage[];
}

/**
 * Split the port's messages the way the SDK wants them, with the vendor's
 * "keep this" attached to every stable message.
 *
 * The SDK carries the system prompt as `instructions`, apart from the turns,
 * and refuses a system message among them. It does take `instructions` as a
 * *list* of system messages, each with its own options -- and that is what
 * is used here rather than one joined string, because a string cannot carry
 * the option that asks a vendor to keep it, and the reviewer's standing
 * prompt is exactly the message the vendor most needs to be told about.
 * Several system messages stay several: the vendors that take a system
 * prompt take a list of blocks, and a block is what a cache boundary sits on.
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
