/**
 * What a provider is: a named, self-describing thing that builds one kind of
 * port implementation out of one input.
 *
 * Several places in this program have to offer *one of many* -- a model
 * vendor (`LLM_PROVIDER`: local, claude, ...), a hosting system to post to
 * (`--provider`: github, gitlab, ...), a rendering of the report (`--format`:
 * text, ndjson, github). Each is the same idea: an operator writes a name, and
 * that name builds an implementation of one port out of one input. This class
 * is that idea, once, so the places that need it declare a *kind* of provider
 * (an abstract subclass) instead of re-deriving the pattern, and each
 * implementation is a class of that kind.
 *
 * Deliberately three members. `name` is what the operator writes and what a
 * registry selects by; `description` is what `--help` and a refusal quote, so
 * neither is written by hand somewhere else; `create` is the one thing a
 * provider does. Anything a kind needs beyond this (a default model, a token
 * variable) belongs on that kind, in that kind's own module -- this one knows
 * no domain.
 */
// `In` and `Out` each appear once here, which is the point: they are the
// contract a kind pins (`ModelProvider extends Provider<ModelChoice, ChatModel>`)
// and the registry reads back, so a registry of one kind cannot be handed a
// provider of another.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see above
export abstract class Provider<In, Out> {
  /** Unique id, as an operator spells it on the command line or in the env. */
  abstract readonly name: string;
  /** One line, shown in `--help` and quoted where this provider is listed. */
  abstract readonly description: string;

  /** Build the one thing this provider provides. */
  abstract create(input: In): Out;
}
