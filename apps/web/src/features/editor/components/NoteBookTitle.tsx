import { useRef } from 'react';
import type { EditorController } from '../useEditorState';

/**
 * 공책 이름 칸 — 상단 바의 이름(데스크톱)과 폰 머리(모바일 공책 디자인 E0)가 **같은 칸**을 쓴다.
 *
 * 따로 두면 조합 중 Enter 처리(아래) 같은 미세한 규칙이 한쪽에만 남는다 — 이 칸은 그 규칙이
 * 실제로 제보를 낳은 자리다(`공책 이름`이 `공책 이름름`으로 저장됐다).
 */
export function NoteBookTitle({ controller, fontSize = 13 }: { controller: EditorController; fontSize?: number }) {
  const titleEnterRef = useRef(false); // 조합 중에 눌린 Enter — 조합이 끝나면 놓는다
  return (
    <input
      data-note-book-title
      defaultValue={controller.docTitle}
      readOnly={controller.readOnly}
      maxLength={40}
      placeholder="공책 이름"
      title="눌러서 공책 이름 수정"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key !== 'Enter') return;
        e.preventDefault();
        /* **조합 중의 Enter로는 놓지 않는다**(제보: `공책 이름`이 `공책 이름름`으로
           저장됐다). 한글을 조합하는 도중 Enter의 keydown에서 칸을 놓으면 맥의 IME가
           조합을 끝내며 마지막 글자를 **한 번 더** 넣는다. 조합이 끝난 뒤에 놓는다 —
           뒤따르는 보통 Enter가 오면 그것이, 안 오면 `compositionend`가 놓는다. */
        if (e.nativeEvent.isComposing || e.keyCode === 229) {
          titleEnterRef.current = true;
          return;
        }
        titleEnterRef.current = false;
        e.currentTarget.blur();
      }}
      onCompositionEnd={(e) => {
        if (!titleEnterRef.current) return;
        const el = e.currentTarget;
        window.setTimeout(() => {
          if (!titleEnterRef.current) return;
          titleEnterRef.current = false;
          el.blur();
        }, 0);
      }}
      onBlur={(e) => {
        titleEnterRef.current = false;
        controller.commitTitle(e.currentTarget.value);
      }}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: 0,
        border: 0,
        borderBottom: '1.5px dashed transparent',
        background: 'transparent',
        fontFamily: 'inherit',
        fontSize,
        fontWeight: 800,
        letterSpacing: '-.02em',
        color: 'var(--mf-text)',
        outline: 'none',
      }}
    />
  );
}
