import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ROOT_ID } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import { useIsMobile } from '../../../hooks/useMediaQuery';

/**
 * 맵 안 텍스트 검색 바 — 툴바 🔍 버튼 또는 Ctrl/⌘+F로 연다.
 *
 * - 노드·메모(이미지 제외) 텍스트를 대소문자 무시 부분 일치로 찾는다.
 *   노드는 **트리 순서**(DFS)로 — 위에서 아래로 읽는 순서와 일치해 다음/이전
 *   이동이 예측 가능하다. 접힌 가지 안의 노드는 화면에 없으므로 제외한다
 *   (자동으로 펼치면 문서를 건드리는 셈이라 하지 않는다).
 * - 일치 대상 전부에 노란 링(`searchMarks` — NodeLayer/FloatLayer가 그림),
 *   Enter/버튼으로 이동한 **현재 항목**은 실제 선택 + 뷰포트 중앙 이동.
 *   타이핑만으로는 화면을 움직이지 않는다(글자마다 캔버스가 튀면 어지럽다).
 * - Enter=다음, Shift+Enter=이전, Esc=닫기. 닫으면 링·선택 상태를 정리한다.
 */
export function SearchBar({ controller }: { controller: EditorController }) {
  const isMobile = useIsMobile();
  const th = controller.uiTheme;
  const open = controller.searchOpen;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  // 아직 이동한 적 없음 — 첫 Enter는 다음이 아니라 **첫 번째 일치로** 간다
  // (브라우저 페이지 찾기와 같은 기대).
  const [visited, setVisited] = useState(false);

  const doc = controller.doc;
  const geom = controller.geom;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!open || !q) return [] as Array<{ kind: 'node' | 'float'; id: string }>;
    const out: Array<{ kind: 'node' | 'float'; id: string }> = [];
    // 노드: 루트부터 DFS(형제 순서 유지) + 자유 도형 — 화면에 있는 것만(geom 존재).
    const visit = (id: string): void => {
      const n = doc.nodes[id];
      if (!n) return;
      if (geom[id] && (n.text || '').toLowerCase().includes(q)) out.push({ kind: 'node', id });
      if (!n.collapsed) (n.children || []).forEach(visit);
    };
    visit(ROOT_ID);
    Object.keys(doc.nodes).forEach((id) => {
      if (doc.nodes[id]?.free) visit(id);
    });
    doc.floats.forEach((f) => {
      if (!f.img && (f.text || '').toLowerCase().includes(q)) out.push({ kind: 'float', id: f.id });
    });
    return out;
  }, [open, query, doc, geom]);

  // 일치 목록이 바뀌면 하이라이트 링을 갱신하고 커서를 처음으로.
  // `controller`는 렌더마다 새 객체라 deps에 넣으면 setSearchMarks(새 Set)→리렌더→
  // 다시 effect…로 무한 루프가 된다 — **일치 구성이 실제로 바뀐 때만** 밀어 넣는다.
  const marksSigRef = useRef('');
  useEffect(() => {
    const sig = matches.map((m) => `${m.kind}:${m.id}`).join('|');
    if (sig === marksSigRef.current) return;
    marksSigRef.current = sig;
    setIndex(0);
    setVisited(false);
    controller.setSearchMarks(
      matches.length
        ? {
            nodes: new Set(matches.filter((m) => m.kind === 'node').map((m) => m.id)),
            floats: new Set(matches.filter((m) => m.kind === 'float').map((m) => m.id)),
          }
        : null,
    );
  });

  // 열릴 때 포커스(+이미 열린 채 Ctrl+F를 또 누른 경우에도), 닫힐 때 정리.
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    setQuery('');
    setIndex(0);
    setVisited(false);
    marksSigRef.current = '';
    controllerRef.current.setSearchMarks(null);
  }, [open]);

  if (!open) return null;

  const go = (delta: number): void => {
    if (!matches.length) return;
    const next = !visited ? (delta > 0 ? 0 : matches.length - 1) : (index + delta + matches.length) % matches.length;
    setVisited(true);
    setIndex(next);
    const m = matches[next]!;
    if (m.kind === 'node') {
      controller.selectNode(m.id);
      const g = geom[m.id];
      if (g) controller.panToCanvasPoint(g.x, g.y);
    } else {
      controller.selectFloat(m.id);
      const f = doc.floats.find((x) => x.id === m.id);
      if (f) controller.panToCanvasPoint(f.x + (f.w || 160) / 2, f.y + (f.h || 44) / 2);
    }
  };

  const close = (): void => controller.setSearchOpen(false);

  // `narrow`: ↑/↓ 화살표 쌍 — 각각 정사각 버튼이면 글리프가 작아 두 화살표
  // 사이가 벌어져 보인다(제보). 폭만 줄여 나란히 붙이고 높이(터치 타깃)는 유지.
  const btn = (label: string, title: string, onClick: () => void, disabled = false, narrow = false): JSX.Element => (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: isMobile ? (narrow ? 32 : 40) : (narrow ? 22 : 30),
        height: isMobile ? 40 : 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        borderRadius: 8,
        background: 'transparent',
        color: disabled ? th.subtext : th.text,
        fontSize: 14,
        cursor: disabled ? 'default' : 'pointer',
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );

  const wrap: CSSProperties = isMobile
    ? { position: 'absolute', top: 8, left: 8, right: 8, zIndex: 30 }
    : { position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 30, width: 384 };

  return (
    <div style={wrap} data-search-bar>
      <div
        // 캔버스로 새는 포인터를 막는다 — 바 위에서 드래그를 시작해도 마퀴/팬이
        // 뜨지 않게(툴바·서식 툴바와 같은 규칙).
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: isMobile ? '4px 6px' : '4px 6px 4px 12px',
          background: th.panel,
          border: `1px solid ${th.border}`,
          borderRadius: 12,
          boxShadow: '0 8px 26px rgba(0,0,0,.14)',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" style={{ flexShrink: 0, color: th.subtext, margin: isMobile ? '0 4px 0 8px' : '0 2px 0 0' }}>
          <circle cx="6.4" cy="6.4" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <line x1="10" y1="10" x2="13.6" y2="13.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              close();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(e.shiftKey ? -1 : 1);
            }
          }}
          placeholder="맵에서 검색…"
          aria-label="맵에서 검색"
          // 홈 검색창과 같은 이유로 브라우저 자동완성을 막는다(이름 없는 단독
          // 텍스트 입력에 크롬이 이메일을 채워 넣는다).
          type="search"
          name="mf-map-search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            height: isMobile ? 40 : 30,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: th.text,
            font: 'inherit',
            fontSize: isMobile ? 16 : 13.5, // 모바일 16px = iOS 자동 확대 방지
          }}
        />
        <span
          aria-live="polite"
          style={{ flexShrink: 0, fontSize: 12, color: query.trim() && !matches.length ? '#d92626' : th.subtext, fontVariantNumeric: 'tabular-nums', padding: '0 4px', whiteSpace: 'nowrap' }}
        >
          {query.trim() ? (matches.length ? `${index + 1}/${matches.length}` : '없음') : ''}
        </span>
        {btn('↑', '이전 (Shift+Enter)', () => go(-1), !matches.length, true)}
        {btn('↓', '다음 (Enter)', () => go(1), !matches.length, true)}
        <div style={{ width: 1, height: 18, background: th.border, flexShrink: 0 }} />
        {btn('✕', '닫기 (Esc)', close)}
      </div>
    </div>
  );
}
