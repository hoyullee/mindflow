# Golden fixtures — dc prototype behavioral baselines

These files capture the **observed output of the original dc prototype**
(`/MindFlow.dc.html` + `support.js`) so the M1 `mindmap-core` extraction can be
verified for behavior parity. They are the regression safety net referenced in
`docs/architecture/0001-architecture.md` (ADR-0001, milestone M1).

## Files

| File | What it is | Parity target for |
| --- | --- | --- |
| `input/doc-mixed.json` | A crafted representative document (root + 3 children + 3 grandchildren, a free shape, a float memo, a line, a zone). Uses the exact schemas the dc app serializes. | The canonical input fed to core functions |
| `golden/serialize-roundtrip.json` | `serializeDoc()` right after `loadDoc()` of the input (no layout change) | `parseDoc ∘ serializeDoc === identity` |
| `golden/layout-radial.json` | `serializeDoc()` after `setLayout('radial')` (coords = `_layout` output) | `layout(doc, 'radial', sizeOf)` |
| `golden/layout-right.json` | …after `setLayout('right')` | `layout(doc, 'right', sizeOf)` |
| `golden/layout-down.json` | …after `setLayout('down')` | `layout(doc, 'down', sizeOf)` |
| `golden/outline.md` | `exportOutline()` output | `toMarkdown(doc)` |
| `golden/export.json` | `exportJSON()` output (verified `=== serializeDoc()`) | `serializeDoc(doc)` |

## Document / element schemas (as observed)

```
node   = { id, text, emoji, parent, children[], collapsed, color, x, y,
           free?, rich?, bold?, ... }   // free shapes add free:true, rich:null
float  = { id, x, y, w, text }
line   = { id, x1, y1, x2, y2, startArrow, endArrow, dashed, c1, c2, label }
zone   = { id, x, y, w, h, label, color }
doc    = { v:1, nodes:{[id]:node}, floats[], lines[], zones[], layoutMode, themeKey }
layoutMode ∈ { 'radial', 'right', 'down' }
```

## ⚠️ Text-measurement caveat (ADR-0001 R1) — read before using layout goldens

`_layout` positions nodes using **measured text size**, which depends on the
font. These goldens were captured in **headless Chromium with the Pretendard web
font blocked** (system-font fallback), so the absolute pixel coordinates in
`layout-*.json` are only reproducible against the **same node sizes**.

For M1, verify layout parity by one of:
1. **Inject the exact sizes** the browser used (recommended): capture per-node
   `{w,h}` alongside coords and feed them to `layout(doc, mode, sizeOf)`; then
   assert coordinate equality. (Extend the capture script to emit sizes.)
2. **Structural/relative assertions**: same relative ordering, parent-before-child
   offsets, no overlaps — font-independent.

`serialize-roundtrip.json`, `outline.md`, and `export.json` are **font-independent**
and can be asserted for exact equality.

## Regenerating

```bash
# requires Playwright + a Chromium (see tools/capture-golden.mjs header)
node tools/capture-golden.mjs
```
Regenerate only when the dc prototype changes (it shouldn't — it is a frozen
reference) or when adding new representative cases.
