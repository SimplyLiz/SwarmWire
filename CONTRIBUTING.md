# Contributing to SwarmWire

## Quick Start

```bash
git clone https://github.com/swarmwire/swarmwire
cd swarmwire
npm install
npm test        # 265+ tests, should all pass
npm run typecheck
```

## Development

- `npm test` — run all tests (vitest)
- `npm run test:watch` — watch mode
- `npm run typecheck` — TypeScript check
- `npm run build` — compile to dist/
- `npm run lint` — ESLint

## Code Style

- TypeScript strict mode (noUncheckedIndexedAccess, noImplicitOverride)
- ES Modules
- No runtime deps beyond zod — LLM SDKs are optional peer deps
- Every public function needs a JSDoc comment
- Every new feature needs tests

## Architecture

See [CLAUDE.md](./CLAUDE.md) for the full module map and conventions.

Key principles:
- Library, not framework
- Budget is always a hard constraint
- Types are in `src/types/`, implementations reference them
- Patterns are standalone functions, composable
- Provider adapters lazy-import SDKs

## Adding a Provider

1. Create `src/providers/your-provider.ts`
2. Implement the `Provider` interface from `src/types/provider.ts`
3. Add to `createProvider()` switch in `src/providers/index.ts`
4. Add to exports in `src/index.ts`
5. Write tests

## Adding a Pattern

1. Create `src/patterns/your-pattern.ts`
2. Export a `runYourPattern()` function
3. Add to `src/patterns/index.ts`
4. Add to `src/index.ts`
5. Optionally add to `Swarm.run()` pattern switch in `src/core/swarm.ts`
6. Write tests

## Adding a Built-in Guardrail / Eval

1. Add to `src/core/guardrails.ts` or `src/testing/evals.ts`
2. Export from the respective index
3. Write tests

## Pull Requests

- One feature per PR
- Tests must pass (`npm test`)
- TypeScript must check (`npm run typecheck`)
- Include a description of what and why

## License

By contributing, you agree to the terms in [LICENSE](./LICENSE).
