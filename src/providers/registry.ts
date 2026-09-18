/**
 * The one registry every kind of provider is kept in, and the one refusal a
 * wrong name meets.
 *
 * Selection, listing, the default, generated help and "select by name, then
 * build" are the same for a vendor, a host and a format; only what is built
 * differs, and that is the type arguments. Keeping the lookup in one place is
 * worth more than the lines it saves: the refusal ("Unknown X 'y'; available:
 * [...]") is then one sentence with one spelling rather than three kept in
 * step by hand.
 *
 * `label` is the noun that refusal uses ("report format", "LLM provider"), so
 * the message reads like the flag it came from rather than like this class.
 */

import { ValueError } from "../core/util/errors";
import { show, sortedByCodePoint } from "../core/util/text";

import { type Provider } from "./provider";

export class ProviderRegistry<In, Out, P extends Provider<In, Out> = Provider<In, Out>> {
  private readonly providers = new Map<string, P>();
  private readonly label: string;

  constructor(label: string, providers: readonly P[] = []) {
    this.label = label;
    for (const provider of providers) this.register(provider);
  }

  /** Later registration of a name replaces the earlier one, keeping its position. */
  register(provider: P): void {
    this.providers.set(provider.name, provider);
  }

  /** Registration order: the order `--help` lists them in, and whose first is the default. */
  names(): string[] {
    return this.providers.keys().toArray();
  }

  /**
   * The first registered name: what a flag left unset means. A registry with
   * nothing in it has no default, and that is a wiring error, not a value.
   */
  defaultName(): string {
    const first = this.names()[0];
    if (first === undefined) throw new ValueError(`No ${this.label} is registered.`);
    return first;
  }

  /** Sorted names, for an error message that should read the same every time. */
  sortedNames(): string[] {
    return sortedByCodePoint(this.providers.keys());
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  /** The provider `name` denotes, or a `ValueError` naming the ones that exist. */
  get(name: string): P {
    const provider = this.providers.get(name);
    if (provider === undefined) {
      throw new ValueError(
        `Unknown ${this.label} ${show(name)}; available: ${show(this.sortedNames())}`,
      );
    }
    return provider;
  }

  /** `'name' description` for every provider, for generated help text. */
  describe(): string {
    return this.all()
      .map((provider) => `'${provider.name}' ${provider.description}`)
      .join("; ");
  }

  /** What `name` builds from `input`, or a `ValueError` naming the alternatives. */
  create(name: string, input: In): Out {
    return this.get(name).create(input);
  }

  /** The registered providers, in registration order. */
  protected all(): P[] {
    return this.providers.values().toArray();
  }
}
