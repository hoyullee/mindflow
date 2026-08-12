import type { CSSProperties, ReactNode } from 'react';
import { useEffect } from 'react';
import type { EditorController } from '../useEditorState';
import { useIsMobile } from '../../../hooks/useMediaQuery';

/**
 * 키보드 단축키 도움말 — `?` 키(편집 중이 아닐 때) 또는 보기/☰ 메뉴의
 * "단축키 도움말"로 연다. Esc·배경 클릭·✕로 닫는다.
 * 내용은 실제 구현된 단축키만 나열한다(코드와 어긋난 도움말은 없느니만 못하다).
 */
export function ShortcutHelp({ controller }: { controller: EditorController }) {
  const isMobile = useIsMobile();
  const th = controller.uiTheme;
  const open = controller.helpOpen;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        controller.setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, controller]);

  if (!open) return null;

  const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl';

  const kbd = (k: string): JSX.Element => (
    <kbd
      key={k}
      style={{
        display: 'inline-block',
        padding: '1.5px 7px',
        borderRadius: 6,
        border: `1px solid ${th.border}`,
        background: th.panel2,
        color: th.text,
        fontSize: 11.5,
        fontFamily: 'inherit',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        boxShadow: '0 1px 0 rgba(0,0,0,.05)',
      }}
    >
      {k}
    </kbd>
  );

  const row = (keys: string[], label: string): JSX.Element => (
    <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '5px 0' }}>
      <span style={{ fontSize: 13, color: th.text }}>{label}</span>
      <span style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>{keys.map(kbd)}</span>
    </div>
  );

  const section = (title: string, children: ReactNode): JSX.Element => (
    <div key={title} style={{ breakInside: 'avoid', marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: th.subtext, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );

  const panel: CSSProperties = {
    position: 'relative',
    width: isMobile ? '100%' : 640,
    maxWidth: '100%',
    maxHeight: isMobile ? '86vh' : '82vh',
    overflowY: 'auto',
    background: th.panel,
    borderRadius: isMobile ? '16px 16px 0 0' : 16,
    border: `1px solid ${th.border}`,
    boxShadow: '0 18px 60px rgba(0,0,0,.22)',
    padding: isMobile ? '18px 18px 26px' : '22px 26px',
    boxSizing: 'border-box',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="키보드 단축키"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        if (e.target === e.currentTarget) controller.setHelpOpen(false);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        background: 'rgba(0,0,0,.34)',
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 24,
      }}
    >
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: th.text }}>키보드 단축키</div>
          <button
            type="button"
            aria-label="닫기"
            onClick={() => controller.setHelpOpen(false)}
            style={{ width: isMobile ? 40 : 30, height: isMobile ? 40 : 30, border: 'none', borderRadius: 8, background: 'transparent', color: th.subtext, fontSize: 16, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        <div style={{ columns: isMobile ? 1 : 2, columnGap: 30 }}>
          {/* 화이트보드에서만 뜨는 구획 — 그리기 도구는 board에만 있다. */}
          {controller.isBoard &&
            section(
              '화이트보드 도구',
              <>
                {row(['V'], '선택')}
                {row(['P'], '펜')}
                {row(['E'], '지우개')}
                {row(['Esc'], '선택 도구로 돌아가기')}
              </>,
            )}
          {section(
            '일반',
            <>
              {row([`${mod}+S`], '저장')}
              {row([`${mod}+F`], '맵에서 검색')}
              {row([`${mod}+Z`], '실행 취소')}
              {row([`${mod}+Y`, `${mod}+Shift+Z`], '다시 실행')}
              {row(['?'], '이 도움말')}
            </>,
          )}
          {section(
            '선택·이동',
            <>
              {row(['클릭'], '선택')}
              {row(['드래그'], '이동 (빈 곳은 여러 개 선택)')}
              {row(['방향키'], '이웃 주제로 선택 이동')}
              {row([`${mod}+C`, `${mod}+V`], '주제 복사·붙여넣기')}
              {row(['Tab'], '하위 추가')}
              {row(['Enter'], '형제 추가')}
              {row(['Delete'], '선택 삭제')}
              {row(['Esc'], '선택 해제 · 닫기')}
              {row(['휠', '핀치'], '확대/축소 (두 손가락 스크롤 = 이동)')}
              {row(['우클릭', '길게 누르기'], '상황 메뉴')}
            </>,
          )}
          {section(
            '텍스트 편집',
            <>
              {row(['더블클릭'], '편집 시작')}
              {row(['Enter'], '편집 확정')}
              {row(['Shift+Enter'], '줄바꿈')}
              {row(['Esc'], '편집 취소')}
              {row([`${mod}+B`, `${mod}+I`], '굵게 · 기울임')}
            </>,
          )}
          {section(
            '리스트',
            <>
              {row(['- ', '1. '], '줄 앞에 입력 = 리스트 시작')}
              {row(['Tab', 'Shift+Tab'], '들여쓰기 · 내어쓰기')}
              {row(['Shift+Enter'], '다음 항목 이어쓰기')}
              {row(['Backspace'], '마커 앞에서 = 내어쓰기/항목 삭제')}
            </>,
          )}
          {section(
            '서식 입력',
            <>
              {row(['**굵게**'], '굵게')}
              {row(['*기울임*'], '기울임')}
              {row(['~~취소선~~'], '취소선')}
              {row(['URL 입력'], '확정 시 자동 링크')}
              {row([`${mod}+클릭`], '링크 열기')}
            </>,
          )}
        </div>
      </div>
    </div>
  );
}
