/**
 * The one registry, and the one error a wrong name gets.
 *
 * Three things vary in this program -- the model (`LLM_PROVIDER`), the
 * rendering (`--format`), the hosting system (`--provider`) -- and each varies
 * the same way: a named strategy is declared in `infra/`, listed in a built-in
 * array, and selected by name at the edge. Everything that is the same about
 * those three lives here; what differs is how a selected entry is *built*, and
 * that stays with each registry because that is the only part that is really
 * its own.
 *
 * Keeping the lookup in one place is worth more than the lines it saves: the
 * refusal a wrong name meets ("Unknown X 'y'; available: [...]") is then one
 * sentence with one spelling, rather than three that have to be kept in step
 * by hand.
 */

import { ValueError } from "./errors";
import { show, sortedByCodePoint } from "./text";

/** The least a registry needs of an entry: a name to select it by. */
export interface RegistryEntry {
  /** Unique id, as an operator spells it on the command line or in the env. */
  readonly name: string;
}

/** An entry that can also introduce itself in one line of generated help. */
export interface DescribedEntry extends RegistryEntry {
  /** One line, shown in `--help`. */
  readonly description: string;
}

/**
 * A name -> entry table with a refusal that names the alternatives.
 *
 * `label` is the noun the error uses ("report format"), so the message reads
 * like the flag it came from rather than like this class.
 */
export class Registry<T extends RegistryEntry> {
  private readonly entries = new Map<string, T>();
  private readonly label: string;

  constructor(label: string, entries: readonly T[] = []) {
    this.label = label;
    for (const entry of entries) this.register(entry);
  }

  /** Later registration of a name replaces the earlier one, keeping its position. */
  register(entry: T): void {
    this.entries.set(entry.name, entry);
  }

  /** Registration order, which is the order `--help` lists them in and whose first is the default. */
  names(): string[] {
    return this.entries.keys().toArray();
  }

  /** Sorted names, for an error message that should read the same every time. */
  sortedNames(): string[] {
    return sortedByCodePoint(this.entries.keys());
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** The entry `name` denotes, or a `ValueError` naming the ones that exist. */
  get(name: string): T {
    const entry = this.entries.get(name);
    if (entry === undefined) {
      throw new ValueError(
        `Unknown ${this.label} ${show(name)}; available: ${show(this.sortedNames())}`,
      );
    }
    return entry;
  }

  /** The registered entries, in registration order. */
  protected all(): T[] {
    return this.entries.values().toArray();
  }
}

/**
 * A registry whose entries document themselves, for a `--help` that is
 * generated rather than written twice.
 */
export class DescribedRegistry<T extends DescribedEntry> extends Registry<T> {
  /** `'name' description` for every entry, for generated help text. */
  describe(): string {
    return this.all()
      .map((entry) => `'${entry.name}' ${entry.description}`)
      .join("; ");
  }
}
