// Platform ports — injected by the host so the core stays framework-agnostic.
// (Moved out of index.ts in M1a so other core modules, e.g. history.ts, can
// depend on `Clock` without importing the barrel file and creating a cycle.)

/**
 * Measures rendered text — injected by the host (browser canvas, RN, etc.) so
 * the layout engine stays free of any rendering dependency.
 */
export interface TextMeasurer {
  measure(text: string, opts: { fontSize: number; bold: boolean }): { width: number; height: number };
}

/** Monotonic clock port (injected so history coalescing stays deterministic in tests). */
export interface Clock {
  now(): number;
}

/** Stable id generator port (injected so serialization is reproducible in tests). */
export interface IdGen {
  next(): string;
}
