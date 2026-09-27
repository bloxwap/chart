/**
 * Async WASM kernel loader with SIMD feature detection.
 *
 * {@link initWasm} decodes the embedded base64 module, verifies SIMD support
 * by compiling a tiny probe module, and returns typed kernel wrappers backed
 * by wasm linear memory. Every failure path (no SIMD, undecodable bytes,
 * compile error) returns `null` so callers fall back to scalar JS.
 *
 * @module
 */

import { KERNELS_BASE64 } from './kernels.base64.js';

/** Typed wrappers around the wasm kernels, managing linear memory for you. */
export interface WasmKernels {
  /** True when the SIMD kernels are in use. */
  readonly usingSimd: boolean;
  /** Min and max of a float array (NaN pair when empty). */
  minmax(values: Float32Array): { min: number; max: number };
  /** Simple moving average; NaN before `period - 1`. */
  sma(src: Float32Array, period: number): Float32Array;
  /** Exponential moving average, SMA-seeded; NaN before `period - 1`. */
  ema(src: Float32Array, period: number): Float32Array;
  /**
   * Sliding-window maximum over `period` values (floored); NaN before
   * `period - 1`, for windows containing NaN, and everywhere when `period`
   * is below 1 or above the length. Selection only, so results are exact
   * f32 inputs.
   */
  rollingMax(src: Float32Array, period: number): Float32Array;
  /** Sliding-window minimum; semantics as {@link rollingMax}. */
  rollingMin(src: Float32Array, period: number): Float32Array;
}

/** Options for {@link initWasm}. */
export interface WasmInitOptions {
  /** Force the no-SIMD path (returns `null`). Useful for tests and SSR. */
  forceNoSimd?: boolean;
  /** Override the SIMD probe bytes (used to simulate engines without SIMD). */
  probeBytes?: Uint8Array;
  /** Override the embedded module bytes (used to test corrupt-module handling). */
  moduleBytes?: Uint8Array;
}

interface RawKernelExports {
  memory: WebAssembly.Memory;
  minmax_f32(ptr: number, len: number): [number, number];
  sma_f32(src: number, dst: number, len: number, period: number): void;
  ema_f32(src: number, dst: number, len: number, period: number): void;
  rolling_max_f32(src: number, dst: number, tmp: number, len: number, period: number): void;
  rolling_min_f32(src: number, dst: number, tmp: number, len: number, period: number): void;
}

const WASM_PAGE_SIZE = 65536;

/**
 * Minimal module requiring SIMD validation: one function returning a
 * `v128.const`. Compiling it throws on engines without SIMD support.
 */
const SIMD_PROBE_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // type: () -> v128
  0x03, 0x02, 0x01, 0x00, // func 0 : type 0
  0x0a, 0x16, 0x01, 0x14, 0x00, // code: 1 body of 20 bytes, 0 locals
  0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // v128.const ...
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // ... i32x4 zeros
  0x0b, // end
]);

/** True when the current engine compiles a SIMD module. Probe bytes are injectable for tests. */
export function detectSimd(probeBytes: Uint8Array = SIMD_PROBE_BYTES): boolean {
  try {
    new WebAssembly.Module(probeBytes);
    return true;
  } catch {
    return false;
  }
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Dependency-free base64 decoder (no `atob`/`Buffer`, so it works in
 * browsers, workers, and Node alike). Whitespace is ignored.
 *
 * @throws On characters outside the base64 alphabet.
 */
export function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/\s+/g, '');
  const noPad = clean.endsWith('==')
    ? clean.slice(0, -2)
    : clean.endsWith('=')
      ? clean.slice(0, -1)
      : clean;
  const out = new Uint8Array(Math.floor((noPad.length * 6) / 8));
  let bits = 0;
  let nbits = 0;
  let o = 0;
  for (const ch of noPad) {
    const v = B64_ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`invalid base64 character: ${JSON.stringify(ch)}`);
    bits = (bits << 6) | v;
    nbits += 6;
    if (nbits >= 8) {
      nbits -= 8;
      out[o] = (bits >> nbits) & 0xff;
      o += 1;
      bits &= (1 << nbits) - 1;
    }
  }
  return out;
}

function wrapExports(raw: RawKernelExports, usingSimd: boolean): WasmKernels {
  const ensureCapacity = (bytes: number): void => {
    const current = raw.memory.buffer.byteLength;
    if (current < bytes) {
      const neededPages = Math.ceil(bytes / WASM_PAGE_SIZE);
      raw.memory.grow(neededPages - Math.floor(current / WASM_PAGE_SIZE));
    }
  };

  const writeInput = (src: Float32Array): void => {
    ensureCapacity(src.byteLength);
    new Float32Array(raw.memory.buffer, 0, src.length).set(src);
  };

  const rolling = (kernel: RawKernelExports['rolling_max_f32'], src: Float32Array, period: number): Float32Array => {
    const window = Math.floor(period);
    if (!(window >= 1 && window <= src.length)) return new Float32Array(src.length).fill(NaN);
    const bytes = src.byteLength;
    ensureCapacity(bytes * 3);
    writeInput(src);
    kernel(0, bytes, bytes * 2, src.length, window);
    return new Float32Array(raw.memory.buffer, bytes, src.length).slice();
  };

  return {
    usingSimd,
    minmax(values: Float32Array): { min: number; max: number } {
      writeInput(values);
      const [min, max] = raw.minmax_f32(0, values.length);
      return { min, max };
    },
    sma(src: Float32Array, period: number): Float32Array {
      const dstOffset = src.byteLength;
      ensureCapacity(dstOffset + src.byteLength);
      writeInput(src);
      raw.sma_f32(0, dstOffset, src.length, period);
      return new Float32Array(raw.memory.buffer, dstOffset, src.length).slice();
    },
    ema(src: Float32Array, period: number): Float32Array {
      const dstOffset = src.byteLength;
      ensureCapacity(dstOffset + src.byteLength);
      writeInput(src);
      raw.ema_f32(0, dstOffset, src.length, period);
      return new Float32Array(raw.memory.buffer, dstOffset, src.length).slice();
    },
    rollingMax: (src, period) => rolling(raw.rolling_max_f32, src, period),
    rollingMin: (src, period) => rolling(raw.rolling_min_f32, src, period),
  };
}

/**
 * Detects SIMD support, decodes and instantiates the embedded kernels module.
 *
 * @returns Kernel wrappers, or `null` when SIMD is unavailable or the module
 *   fails to compile — callers must then use their scalar JS path.
 */
export async function initWasm(options: WasmInitOptions = {}): Promise<WasmKernels | null> {
  if (options.forceNoSimd === true) return null;
  if (!detectSimd(options.probeBytes ?? SIMD_PROBE_BYTES)) return null;
  const bytes = options.moduleBytes ?? decodeBase64(KERNELS_BASE64);
  try {
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(module, {});
    return wrapExports(instance.exports as unknown as RawKernelExports, true);
  } catch {
    return null;
  }
}
