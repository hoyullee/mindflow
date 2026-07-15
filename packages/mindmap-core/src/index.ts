// @mindflow/mindmap-core — the framework-agnostic mind-map engine.
//
// This package is the crown jewel (see docs/architecture/0001-architecture.md).
// It is PURE TypeScript: no DOM, React, network, or storage imports. Platform
// concerns arrive through injected ports (TextMeasurer, Clock, IdGen, DocStore).
// The core-purity ESLint rule (eslint.config.mjs) fails CI on any such import.
//
// M0 scaffold: only a version marker + placeholder port types. The real model,
// layout, serialization, history, and export logic land in M1 (core extraction).

/** Semantic version of the core engine surface. */
export const CORE_VERSION = '0.0.0';

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
