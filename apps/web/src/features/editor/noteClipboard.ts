// 공책의 **클립보드 두 벌** — 평문(`text/plain`)과 서식(`text/html`).
//
// 평문 규칙은 한 글자도 바꾸지 않는다(`selectionText`): 목록은 `- `·`3. ` 같은
// 마크다운 마커를 글자로 붙여 나간다 — 마크다운을 읽는 앱과 우리 `parseNoteText`
// 왕복이 그 규칙에 서 있다. 바뀌는 것은 **한 벌 더 싣는다**는 것뿐이다(제보 12:
// "워드·카톡에 붙이면 서식이 오지 않고 마커가 글자로 들어간다").

import { clipLinesToHtml, type ClipLine } from '@mindflow/mindmap-core';
import { liveEditValue } from './richtextDom';
import { selectionText, type LineSel } from './noteTextSelect';

/** 클립보드에 실을 두 벌. */
export interface ClipPayload {
  plain: string;
  html: string;
}

/** 그 키가 **표의 칸**인가 — 칸은 목록으로 내보내지 않는다(`NoteEditor`와 같은 규칙). */
function isCellKey(key: string): boolean {
  return /^[^:]+:r\d+c\d+$/.test(key);
}

/** 한 줄의 **모델 조각** — 화면(`data-note-*`)에서 종류·단계·번호를 읽어 온다. */
function clipLineOf(s: LineSel): ClipLine {
  const v = liveEditValue(s.el);
  const chars = [...v.text];
  const from = Math.max(0, Math.min(s.from, chars.length));
  const to = Math.max(from, Math.min(s.to, chars.length));
  const text = chars.slice(from, to).join('');
  const row = s.el.closest('[data-note-mark]');
  const mark = row?.getAttribute('data-note-mark') ?? '';
  // 표의 칸은 목록으로 내보내지 않는다 — 표를 표로 붙이는 길은 표 메뉴의 `CSV로 복사`다.
  const kind = isCellKey(s.key) ? 'cell' : (s.el.closest('[data-note-block]')?.getAttribute('data-note-kind') ?? 'p');
  const whole = from === 0 && to >= chars.length;
  return {
    kind,
    // 조각만 골랐으면 런을 자르는 대신 글자만 싣는다(서식보다 정확함이 먼저다).
    runs: whole ? (v.rich ?? null) : null,
    text,
    depth: Number(row?.getAttribute('data-note-item-depth') ?? 0) || 0,
    done: /\[x\]/.test(mark),
    ...(/^(\d+)\./.exec(mark.trim()) ? { num: Number(/^(\d+)\./.exec(mark.trim())![1]) } : {}),
  };
}

/** 칠해 둔 선택을 두 벌로. */
export function selectionClipboard(sel: LineSel[]): ClipPayload {
  return { plain: selectionText(sel), html: clipLinesToHtml(sel.map(clipLineOf)) };
}

/** 줄 조각들(모델에서 바로)을 두 벌로 — 우클릭 메뉴의 `복사`가 쓴다. */
export function linesClipboard(plain: string, lines: ClipLine[]): ClipPayload {
  return { plain, html: clipLinesToHtml(lines) };
}

/**
 * 두 벌을 **같은 태스크에서** 쓴다.
 *
 * 비동기로 미루면 사파리가 "사용자 제스처 밖"이라며 거절한다(`NotAllowedError`) —
 * 그래서 `setTimeout`으로 감싸지 않는다. `ClipboardItem`을 모르는 환경(옛 브라우저·
 * 테스트)에서는 평문 한 벌로 물러선다.
 */
export function writeClipboard(payload: ClipPayload): void {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const plainOnly = (): void => {
    void nav?.clipboard?.writeText?.(payload.plain)?.catch?.(() => undefined);
  };
  const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!nav?.clipboard?.write || !Item) {
    plainOnly();
    return;
  }
  try {
    void nav.clipboard
      .write([
        new Item({
          'text/plain': new Blob([payload.plain], { type: 'text/plain' }),
          'text/html': new Blob([payload.html], { type: 'text/html' }),
        }),
      ])
      .catch(() => plainOnly());
  } catch {
    plainOnly();
  }
}

/**
 * 그림 한 장을 **PNG 덩어리**로 — 클립보드가 받는 그림 형식이 사실상 PNG 하나다.
 *
 * 우리가 올리는 파일은 WebP다(용량을 조이려고) — 그대로 실으면 크롬이 거절하므로
 * 캔버스로 한 번 굽는다. `fetch`로 먼저 받는 이유는 **오염(taint)을 피하려는** 것이다:
 * 다른 출처의 주소를 `<img>`로 캔버스에 그리면 `toBlob`이 보안 오류로 막히는데,
 * 받아 온 덩어리는 출처가 우리 쪽이라 그 문제가 없다.
 */
export function imageToPng(src: string): Promise<Blob> {
  return fetch(src)
    .then((r) => r.blob())
    .then(async (blob) => {
      if (blob.type === 'image/png') return blob;
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bitmap, 0, 0);
      return await new Promise<Blob>((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error('png failed'))), 'image/png'));
    });
}

/**
 * 그림을 **시스템 클립보드**로(요청 3) — 다른 앱에 그대로 붙여넣을 수 있게.
 *
 * 글 복사와 달리 여기서는 `text/plain`을 함께 싣지 않는다: 두 벌을 실으면 받는 쪽이
 * 그림 대신 글자를 고르는 앱이 있어(메일·메신저) "붙였더니 주소만 들어왔다"가 된다.
 *
 * **약속을 그대로 넘긴다**(`new ClipboardItem({ 'image/png': <Promise> })`) — 사파리는
 * 사용자 제스처가 살아 있는 동안에만 쓰기를 받아, 덩어리를 `await`한 뒤에 쓰면 늦는다.
 * 클립보드를 막아 둔 환경(권한·옛 브라우저·테스트)에서는 `false`로 돌아선다.
 */
export async function writeImageClipboard(src: string): Promise<boolean> {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!src || !nav?.clipboard?.write || !Item) return false;
  const png = imageToPng(src);
  // 클립보드가 거절하면 이 약속을 **아무도 읽지 않는다** — 떠도는 거부가 되어 콘솔을
  // 채우므로(테스트에서는 실행 자체가 실패한다) 여기서 한 번 받아 둔다.
  png.catch(() => undefined);
  try {
    await nav.clipboard.write([new Item({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}
