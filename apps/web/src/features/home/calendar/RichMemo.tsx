// 일정 메모의 **서식 편집기**(요청 — 구글 캘린더의 그 도구 모음: 굵게·기울임·밑줄·
// 번호 매기기·글머리 기호·링크 삽입·서식 제거).
//
// 저장은 HTML이다(`richMemo.ts` 머리말) — 구글의 `description`이 원래 HTML이고
// 우리 표도 같은 문자열을 담는다. 그래서 **모델을 새로 두지 않고** 브라우저의
// `execCommand`로 그 HTML을 직접 만든다.
//
// `execCommand`는 표준에서 물러난(deprecated) API다. 그런데도 쓰는 이유는 셋이다:
//   ① 모든 브라우저가 여전히 구현하고 있고(대체 표준이 없다),
//   ② 우리가 원하는 결과물이 **정확히 그 출력**(HTML)이라 변환 계층이 필요 없다,
//   ③ 직접 구현하면 일곱 명령의 선택·중첩·되돌리기를 전부 다시 짜야 한다.
// 캔버스 편집기가 `execCommand`를 피한 것과 어긋나지 않는다 — 그쪽은 저장 모델이
// 우리 `RichRun`이라 DOM 결과를 다시 해석해야 했다.
//
// 값이 나갈 때는 **언제나 위생 처리**를 지난다(`sanitizeMemoHtml`) — 편집기가 만든
// 것이든 붙여넣은 것이든 허용 목록 밖 태그·주소는 남지 않는다.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { normalizeUrl } from '@mindflow/mindmap-core';
import { memoHtml, sanitizeMemoHtml } from './richMemo';

interface Cmd {
  key: string;
  label: string;
  cmd: string;
  arg?: string;
  icon: JSX.Element;
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const CMDS: Cmd[] = [
  { key: 'bold', label: '굵게', cmd: 'bold', icon: <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}><path d="M7 5h6.5a3.5 3.5 0 0 1 0 7H7zM7 12h7.5a3.5 3.5 0 0 1 0 7H7z" /></svg> },
  { key: 'italic', label: '기울임', cmd: 'italic', icon: <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}><path d="M15 5h-5M14 19H9M14 5l-4 14" /></svg> },
  { key: 'underline', label: '밑줄', cmd: 'underline', icon: <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}><path d="M7 4v6a5 5 0 0 0 10 0V4M5 20h14" /></svg> },
  { key: 'ol', label: '번호 매기기', cmd: 'insertOrderedList', icon: <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}><path d="M10 6h10M10 12h10M10 18h10M4 5h1v4M4 13h2l-2 3h2" /></svg> },
  { key: 'ul', label: '글머리 기호', cmd: 'insertUnorderedList', icon: <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></svg> },
];

const LINK: Cmd = { key: 'link', label: '링크 삽입', cmd: 'createLink', icon: <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg> };
const CLEAR: Cmd = { key: 'clear', label: '서식 제거', cmd: 'removeFormat', icon: <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}><path d="M6 5h13M9 5 7 19M14 12l6 7M20 12l-6 7" /></svg> };

/** `execCommand`가 없는 환경(jsdom·아주 오래된 브라우저)에서는 도구 모음을 감춘다. */
function canFormat(): boolean {
  return typeof document !== 'undefined' && typeof (document as Document & { execCommand?: unknown }).execCommand === 'function';
}

export function RichMemo({
  value,
  onChange,
  placeholder = '자유롭게 적어 두세요',
  attr,
  height = 110,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** 테스트·프로브가 이 상자를 집는 표식(`data-event-note` 등). */
  attr?: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [empty, setEmpty] = useState(true);
  const formatting = canFormat();

  // 밖에서 값이 바뀔 때만 다시 심는다 — 타이핑마다 심으면 캐럿이 맨 뒤로 튄다
  // (캔버스 편집 박스에서 겪은 그 함정).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = memoHtml(value);
    if (el.innerHTML !== next) el.innerHTML = next;
    setEmpty(!(el.textContent ?? '').trim() && !el.querySelector('li, img'));
  }, [value]);

  const push = (): void => {
    const el = ref.current;
    if (!el) return;
    setEmpty(!(el.textContent ?? '').trim() && !el.querySelector('li, img'));
    onChange(sanitizeMemoHtml(el.innerHTML));
  };

  const run = (cmd: Cmd): void => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (cmd.key === 'link') {
      const raw = window.prompt('링크 주소');
      if (raw === null) return;
      const href = normalizeUrl(raw.trim());
      // 열 수 없는 주소는 넣지 않는다 — 값에 들어가지도 못하게(위생 처리와 같은 규칙).
      if (!href) return;
      document.execCommand('createLink', false, href);
    } else {
      document.execCommand(cmd.cmd, false, cmd.arg);
    }
    push();
  };

  const btn: CSSProperties = {
    width: 28,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 0,
    borderRadius: 8,
    background: 'transparent',
    color: 'var(--mf-subtext)',
    cursor: 'pointer',
    padding: 0,
  };

  return (
    <div style={{ border: '1px solid var(--mf-border)', borderRadius: 12, background: 'var(--mf-card)', overflow: 'hidden' }}>
      {formatting && (
        <div
          data-memo-toolbar
          role="toolbar"
          aria-label="메모 서식"
          style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '5px 6px', borderBottom: '1px solid var(--mf-border-soft)', background: 'var(--mf-panel2)' }}
          // 버튼을 누르는 순간 편집 상자가 blur되면 선택이 사라져 명령이 **아무 데도**
          // 걸리지 않는다(서식 툴바에서 겪은 그 함정) — 기본 동작을 막아 선택을 지킨다.
          onMouseDown={(e) => e.preventDefault()}
        >
          {CMDS.map((c) => (
            <button key={c.key} type="button" className="mf-ctl" data-memo-cmd={c.key} title={c.label} aria-label={c.label} onClick={() => run(c)} style={btn}>
              {c.icon}
            </button>
          ))}
          <span aria-hidden="true" style={{ width: 1, height: 16, background: 'var(--mf-border)', margin: '0 4px' }} />
          {[LINK, CLEAR].map((c) => (
            <button key={c.key} type="button" className="mf-ctl" data-memo-cmd={c.key} title={c.label} aria-label={c.label} onClick={() => run(c)} style={btn}>
              {c.icon}
            </button>
          ))}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="메모"
          {...(attr ? { [attr]: '' } : {})}
          onInput={push}
          onBlur={push}
          className="lnb-scroll mf-memo-rich"
          style={{
            minHeight: height,
            maxHeight: 260,
            overflowY: 'auto',
            padding: '11px 12px',
            font: 'inherit',
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--mf-text)',
            outline: 'none',
          }}
        />
        {empty && (
          <span aria-hidden="true" style={{ position: 'absolute', left: 12, top: 11, fontSize: 13, lineHeight: 1.6, color: 'var(--mf-faint2)', pointerEvents: 'none' }}>
            {placeholder}
          </span>
        )}
      </div>
    </div>
  );
}
