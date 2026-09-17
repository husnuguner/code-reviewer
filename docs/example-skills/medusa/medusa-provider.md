---
name: medusa-provider
description: Review MedusaJS 2.x provider contracts, default implementations, loaders, provider facade services, and their medusa-config wiring.
framework: medusa
---

A provider is the module's seam to something replaceable: another module, an external system, or a pluggable strategy.

## The seven touch points — flag a missing or misplaced one
1. **Contract** `providers/<kind>/<domain>-<kind>-provider.ts`: `interface I<Domain><Kind>Provider` starting with `getIdentifier(): string`, plus `<Verb>Context` input types and `<Noun>Result` output types. `interface` is used here and only here
2. **Default implementation** `providers/<kind>/default-<domain>-<kind>-provider.ts`: a `static readonly identifier` string with `getIdentifier()` returning it, dependencies taken from a local `InjectedDependencies` type, exported both named and default
3. **Provider index** `providers/<kind>/index.ts`: `export default ModuleProvider(MODULE_KEY, { services: [Default<Domain><Kind>Provider] })`
4. **Registration constants** in `types/` (index or `constants.ts`): `<Domain><Kind>ProviderRegistrationPrefix = '<d><k>p_'` and `<Domain><Kind>ProviderIdentifierRegistrationName = '<domain>_<kind>_providers_identifier'`
5. **Loader** `loaders/<kind>/providers.ts` built with the shared provider-loader factory (`src/common/subscription/provider-registration.ts` — config-driven and domain-agnostic despite the name) and added to `loaders: [...]` in the module `index.ts`. **Reuse the factory and `resolveSingleProvider`; flag copied loader mechanics**
6. **Facade** `services/<domain>-<kind>-provider-service.ts`: one field resolved via `resolveSingleProvider(container, Prefix, '<kind>')`, then one method per interface method that is a bare `return this.provider_.x(ctx)` — no logic, methods not `async`. Registered like any helper service (`medusa-module`), injected into the module service and exposed through a getter
7. **Config** `medusa-config.ts` `options.providers[]`: `{ resolve: '<path>', id: '<domain>-<kind>', options: {} }` where `id` equals the loader's `providerId`

## Rules
- Exactly one provider per kind; `resolveSingleProvider` throws `MedusaError(INVALID_DATA)` otherwise
- Alternate implementations live outside the module tree at `src/modules/providers/<domain>/<impl>/` and are swapped in through `medusa-config.ts` only — never by branching inside the module
- Provider implementations are the **only** place inside a module tree allowed to inject other modules (`Modules.EVENT_BUS`, a pub-sub module, an external module). Each such dependency must appear in that module's `definition.dependencies` in `medusa-config.ts`. Module services and utils never do this
- Method inputs are single objects, not positional arguments
- A method a provider cannot support throws `MedusaError(NOT_FOUND)` rather than returning `null`
- Logger inside a provider: `container[ContainerRegistrationKeys.LOGGER]`, field `logger_`, log prefix `[<domain>:<kind>]`
- An empty generated `migrations/.snapshot-*.json` under a provider directory is a generator artifact, not a pattern — leave it alone, and do not flag it
