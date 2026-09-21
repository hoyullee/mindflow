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
