# @tournamental/spec-client

Client-side spec stream consumer for Tournamental renderers.

Owned by [AGENT-PROMPTS.md](../../AGENT-PROMPTS.md) section 2 (the renderer
agent), but designed so other consumers (analyst tools, alt-renderers, the
clip pipeline) can reuse the same store + driver verbatim.

## What it does

1. Opens a WebSocket to a producer (or accepts a custom `StreamSource`
   implementation, e.g. the in-process AR-FR synthetic fixture for offline
   demos).
2. Maintains a Zustand vanilla store with:
   - the most recent `MatchInit`,
   - the previous and current `StateFrame` for client-side lerp,
   - a bounded ring buffer of recent events (size 64),
   - score / shootout / period / clock / commentary slices,
   - lag, frame count, and connection status for diagnostics.
3. Exports `useMatchStream(url | source)` for React consumers and
   `createMatchStore()` for non-React consumers.

## Public API

```ts
import {
  useMatchStream,
  useMatchSlice,
  createMatchStore,
  syntheticArFrSource,
  buildArFrMessages,
  wsSource,
} from "@tournamental/spec-client";
```

- `useMatchStream(input)` — React hook. `input` is either a `ws://` /
  `wss://` URL string, or a `StreamSource` instance. Returns the Zustand
  store API.
- `useMatchSlice(store, selector)` — `useSyncExternalStore` wrapper for
  reading individual slices without re-rendering on every `StateFrame`.
- `createMatchStore()` — non-React store factory.
- `syntheticArFrSource()` — in-process AR-FR 2022 final replay; emits a
  spec stream that ends 3-3 (regulation+ET) and 4-2 (penalties).
- `buildArFrMessages()` — the same fixture as a static array, for tests
  and offline analysis.
- `wsSource(url)` — `StreamSource` backed by a WebSocket with capped
  exponential-backoff reconnect.

## Spec contract

Consumes `@tournamental/spec` workspace dep. Does not modify the spec.
