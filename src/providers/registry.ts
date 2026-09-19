/**
 * The registry every provider kind is kept in: selection by name, listing, the default, help text, and
 * one refusal for a wrong name.
 * @packageDocumentation
 */

import { ValueError } from "../core/util/errors";
import { show, sortedByCodePoint } from "../core/util/text";

import { type Provider } from "./provider";

/**
 * Providers of one kind, by name.
 *
 * @typeParam P - The kind held.
 */
export class ProviderRegistry<In, Out, P extends Provider<In, Out> = Provider<In, Out>> {
  private readonly providers = new Map<string, P>();
  private readonly label: string;

  /**
   * @param label - The noun refusals use: `"report format"`, `"LLM provider"`.
   * @param providers - Initial registrations, in order.
   */
  constructor(label: string, providers: readonly P[] = []) {
    this.label = label;
    for (const provider of providers) this.register(provider);
  }

  /** Registers a provider; a repeated name replaces the earlier one, keeping its position. */
  register(provider: P): void {
    this.providers.set(provider.name, provider);
  }

  /** Names in registration order; the first is the default. */
  names(): string[] {
    return this.providers.keys().toArray();
  }

  /**
   * The first registered name: what a flag left unset means.
   *
   * @throws {@link ValueError} when nothing is registered.
   */
  defaultName(): string {
    const first = this.names()[0];
    if (first === undefined) throw new ValueError(`No ${this.label} is registered.`);
    return first;
  }

  /** Names in code-point order, for messages. */
  sortedNames(): string[] {
    return sortedByCodePoint(this.providers.keys());
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * The provider `name` denotes.
   *
   * @throws {@link ValueError} naming the available providers when `name` is unknown.
   */
  get(name: string): P {
    const provider = this.providers.get(name);
    if (provider === undefined) {
      throw new ValueError(
        `Unknown ${this.label} ${show(name)}; available: ${show(this.sortedNames())}`,
      );
    }
    return provider;
  }

  /** `'name' description` for every provider, for help text. */
  describe(): string {
    return this.all()
      .map((provider) => `'${provider.name}' ${provider.description}`)
      .join("; ");
  }

  /**
   * Builds what `name` provides from `input`.
   *
   * @throws {@link ValueError} when `name` is unknown.
   */
  create(name: string, input: In): Out {
    return this.get(name).create(input);
  }

  /** The registered providers, in registration order. */
  protected all(): P[] {
    return this.providers.values().toArray();
  }
}
