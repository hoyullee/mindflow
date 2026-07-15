// Browser file-download helper — port of `Component#downloadFile`
// (MindFlow.dc.html:606-612). DOM-only, so it lives in the web layer rather
// than `@mindflow/mindmap-core`.

export function downloadFile(name: string, data: string | Blob, mime?: string): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
