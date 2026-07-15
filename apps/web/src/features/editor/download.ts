// Browser file-download helper — port of `Component#downloadFile`
// (MindFlow.dc.html:606-612). DOM-only, so it lives in the web layer rather
// than `@mindflow/mindmap-core`.
//
// M7: inside the Capacitor native shell there's no anchor-tag download (and
// no Downloads folder to save it to) — `downloadOrShare` routes to the
// native Share sheet there instead, falling back to this same anchor-tag
// path on any failure. In a plain browser (including every existing test,
// where `isNativePlatform()` is false) this is unchanged from before M7.
import { downloadOrShare } from '../../platform/nativeBridge';

export function downloadFile(name: string, data: string | Blob, mime?: string): void {
  downloadOrShare(name, data, mime, () => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}
