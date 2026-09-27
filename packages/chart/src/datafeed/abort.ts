/**
 * Abort plumbing without the DOM typings: the library compiles against
 * ES2022 only, while hosts see their own `AbortSignal` type.
 *
 * @module
 */

/** The part of an `AbortSignal` the datafeed reads. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
}

/**
 * The host's `AbortSignal` type where its typings declare one (DOM or Node),
 * so a request's signal can go straight to `fetch`; {@link AbortSignalLike}
 * otherwise.
 */
export type DatafeedSignal = typeof globalThis extends { AbortSignal: { prototype: infer S } } ? S : AbortSignalLike;

/** The part of an `AbortController` the datafeed drives. */
export interface AbortControllerLike {
  readonly signal: DatafeedSignal;
  abort(reason?: unknown): void;
}

/** A fresh controller from the runtime's `AbortController` (browsers, Node 15+). */
export function createAbortController(): AbortControllerLike {
  return new (globalThis as unknown as { AbortController: new () => AbortControllerLike }).AbortController();
}
