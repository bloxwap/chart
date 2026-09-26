/**
 * Minimal WebAssembly ambient declarations. The ES2022 lib does not include
 * them and the library must not depend on the DOM lib.
 */
declare namespace WebAssembly {
  class Memory {
    constructor(descriptor: { initial: number; maximum?: number });
    readonly buffer: ArrayBuffer;
    grow(delta: number): number;
  }
  class Module {
    constructor(bytes: Uint8Array);
  }
  class Instance {
    constructor(module: Module, importObject: Record<string, never>);
    readonly exports: Record<string, unknown>;
  }
  function compile(bytes: Uint8Array): Promise<Module>;
  function instantiate(module: Module, importObject: Record<string, never>): Promise<Instance>;
}
