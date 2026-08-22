import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { HomeState } from '../../types';
import type { HomeController } from '../../useHomeController';
import { BOARD_TEMPLATES, KANBAN_TEMPLATES, MAP_TEMPLATES, buildTemplateDoc } from '../../../../templates/mapTemplates';
import { realPreview } from '../../mapPreview';
import { HOME_THEMES } from '../../theme';
import { MONO_FONT, dotGridStyle } from '../../chrome';
import { Modal } from '../../../../components/Modal';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/**
 * 갤러리에 내놓는 마인드맵 템플릿(요청: 빈 맵 포함 4칸으로).
 *
 * 일곱 칸은 고르기보다 훑기에 가까웠다 — 자주 쓰일 셋(브레인스토밍·주간 계획·
 * 학습 정리)만 남긴다. **데이터는 지우지 않는다**: 회의록 등 나머지 템플릿의
 * `tpl=<id>` 주소는 계속 동작한다(에디터가 시드하는 경로는 갤러리와 무관하다).
 */
const GALLERY_MAP_IDS = ['brainstorm', 'weekly', 'study'];

/** 템플릿의 직렬화 본문 — 내용이 고정이라 한 번만 만들면 된다(캐시 키이기도 하다). */
const rawCache = new Map<string, string>();
function templateRaw(id: string): string {
  const hit = rawCache.get(id);
  if (hit !== undefined) return hit;
  const raw = JSON.stringify(buildTemplateDoc(id));
  rawCache.set(id, raw);
  return raw;
}

type TabName = '전체' | '마인드맵' | '화이트보드' | '칸반 보드';

/**
 * 템플릿 갤러리 — "새로 만들기"가 여는 화면(디자인 원본 `Geurio 홈` 개정판 이식).
 *
 * 위에서부터: 제목 + 원형 닫기 / **종류 탭**(전체·마인드맵·화이트보드·칸반 보드 —
 * 색 점 + 이름 + 등폭 개수 알약) / 구획들(이름 + 한 줄 힌트 + 카드 그리드).
 *
 * 썸네일은 홈 카드·버전 기록이 쓰는 `realPreview` **그대로**다 — 갤러리에서 본
 * 모양과 실제로 열리는 문서가 어긋날 수 없다(디자인 원본은 목업이라 추상 도형을
 * 그렸지만, 우리는 틀만 따르고 안에는 진짜를 그린다 — 홈 카드와 같은 결정).
 *
 * 각 구획의 첫 칸은 **빈 문서**다 — 갤러리를 거치게 만든 이상 예전의 "바로 빈 맵"이
 * 사라지면 안 되고, 첫 칸에 두면 습관적으로 누르는 손이 크게 달라지지 않는다.
 */
/** 갤러리 카드 — 화면 높이를 넘기지 않고 본문만 스크롤한다(폰·가로 모드에서도
 * 헤더와 닫기 버튼이 늘 보인다). */
const GALLERY_CARD: CSSProperties = {
  width: 1000,
  maxWidth: '100%',
  maxHeight: 'calc(100dvh - 32px)',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--mf-card)',
  border: '1px solid var(--mf-border)',
  borderRadius: 24,
  boxShadow: '0 44px 90px -40px rgba(46,42,38,.6)',
  overflow: 'hidden',
};

export function TemplateGallery({ state, controller }: Props) {
  const open = state.templateOpen;
  const [tab, setTab] = useState<TabName>('전체');
  // 썸네일 hue는 지금 홈 테마의 강조색 — 카드 그리드와 같은 톤으로 보이게.
  const hue = HOME_THEMES[state.theme].accent;

  const cards = useMemo(() => MAP_TEMPLATES.filter((t) => GALLERY_MAP_IDS.includes(t.id)).map((t) => ({ tpl: t, raw: templateRaw(t.id) })), []);
  // 보드 템플릿도 완성된 `Doc`이라 썸네일은 같은 `realPreview`다(메모 배치가 그대로 보인다).
  const boardCards = useMemo(() => BOARD_TEMPLATES.map((t) => ({ tpl: t, raw: templateRaw(t.id) })), []);
  const kanbanCards = useMemo(() => KANBAN_TEMPLATES.map((t) => ({ tpl: t, raw: templateRaw(t.id) })), []);

  // 열 때마다 '전체'에서 시작한다 — 지난번에 남겨 둔 탭이 "템플릿이 사라졌다"로 보인다.
  useEffect(() => {
    if (open) setTab('전체');
  }, [open]);

  /**
   * 미리보기 캐시를 **한가할 때 미리 데운다**.
   *
   * 실측: 처음 열 때는 클릭에서 화면이 그려지기까지 78ms(롱태스크 55·60ms)가
   * 걸리고 두 번째부터는 12ms다 — 차이는 전부 `realPreview`가 문서들을
   * 레이아웃·측정하는 비용이고, 그 결과는 모듈 캐시에 남는다. hue가 캐시 키의
   * 일부라 테마를 바꾸면 다시 데운다.
   */
  useEffect(() => {
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      for (const t of MAP_TEMPLATES) realPreview(templateRaw(t.id), hue);
      for (const t of BOARD_TEMPLATES) realPreview(templateRaw(t.id), hue);
      for (const t of KANBAN_TEMPLATES) realPreview(templateRaw(t.id), hue);
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (ric) {
      ric(warm);
    } else {
      const id = setTimeout(warm, 300);
      return () => {
        cancelled = true;
        clearTimeout(id);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [hue]);

  // Escape·바깥 클릭·초점 트랩은 `Modal`(Radix Dialog)이 맡는다 — 예전에는 창마다
  // window 리스너를 하나씩 달았다.
  if (!open) return null;

  // 종류 점 색은 카드 배지와 같은 토큰(--mf-doc-*) — 갤러리·카드·배지가 같은 색으로
  // 같은 종류를 가리킨다. '전체' 탭의 점만 중립색이다.
  const tabs: { name: TabName; dot: string; count: number }[] = [
    { name: '전체', dot: 'var(--mf-faint2)', count: cards.length + boardCards.length + kanbanCards.length + 3 },
    { name: '마인드맵', dot: 'var(--mf-doc-map)', count: cards.length + 1 },
    { name: '화이트보드', dot: 'var(--mf-doc-board)', count: boardCards.length + 1 },
    { name: '칸반 보드', dot: 'var(--mf-doc-kanban)', count: kanbanCards.length + 1 },
  ];

  const showMap = tab === '전체' || tab === '마인드맵';
  const showBoard = tab === '전체' || tab === '화이트보드';
  const showKanban = tab === '전체' || tab === '칸반 보드';

  return (
    <Modal
      open={open}
      onClose={controller.closeTemplates}
      label="새로 만들기"
      // dim도 **함께 페이드**한다 — 애니메이션이 없으면 어두운 막이 한 프레임에
      // 툭 깔린 뒤 내용만 0.2초에 걸쳐 떠서, 둘이 어긋나는 것이 깜빡임으로 보였다.
      dim={{ background: 'rgba(58,52,46,.34)', backdropFilter: 'blur(5px)', zIndex: 140, padding: 16, animation: 'mf-dim-in .16s ease-out' }}
      cardClass="mf-gallery-pop"
      card={GALLERY_CARD}
    >
      <>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '22px 24px 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.03em' }}>새로 만들기</div>
            <div style={{ fontSize: 12.5, color: 'var(--mf-subtext)' }}>생각을 가지로 뻗는 마인드맵, 자유롭게 붙이는 화이트보드 중에서 골라 보세요.</div>
          </div>
          <button
            className="btn mf-ctl"
            aria-label="닫기"
            onClick={controller.closeTemplates}
            style={{ width: 32, height: 32, border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* 종류 탭 — 어느 구획으로 바로 갈지 거른다(디자인 원본). 탭이 있어도
            '전체'가 기본이라 훑는 사람의 화면은 예전과 같다. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 24px 14px', borderBottom: '1px solid var(--mf-hairline)', flexShrink: 0, flexWrap: 'wrap' }}>
          {tabs.map((t) => {
            const on = tab === t.name;
            return (
              <button
                key={t.name}
                type="button"
                className="btn"
                data-gallery-tab={t.name}
                aria-pressed={on}
                onClick={() => setTab(t.name)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  height: 32,
                  padding: '0 13px',
                  borderRadius: 999,
                  border: `1px solid ${on ? 'var(--mf-accent-mute)' : 'var(--mf-border)'}`,
                  background: on ? 'var(--mf-accent-soft)' : 'var(--mf-card)',
                  color: on ? 'var(--mf-text)' : 'var(--mf-subtext)',
                  fontFamily: 'inherit',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'background .14s ease, color .14s ease, border-color .14s ease',
                }}
              >
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2.5, background: t.dot, display: 'block' }} />
                {t.name}
                <span style={{ fontFamily: MONO_FONT, fontSize: 10, fontWeight: 500, opacity: 0.65 }}>{t.count}</span>
              </button>
            );
          })}
        </div>

        <div className="lnb-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 26 }}>
          {showMap && (
            <section style={SECTION_STYLE}>
              <SectionHead title="마인드맵" desc="중심 주제에서 가지를 뻗어 정리해요" />
              <div style={GRID_STYLE}>
                <BlankCard id="blank" dot="var(--mf-doc-map)" title="빈 맵" desc="중심 주제 하나로 시작" onPick={() => controller.createFromTemplate()} />
                {cards.map(({ tpl, raw }) => (
                  <TemplateCard key={tpl.id} id={tpl.id} dot="var(--mf-doc-map)" title={tpl.name} desc={tpl.desc} preview={realPreview(raw, hue)} onPick={() => controller.createFromTemplate(tpl.id)} />
                ))}
              </div>
            </section>
          )}

          {showBoard && (
            <section style={SECTION_STYLE}>
              <SectionHead title="화이트보드" desc="트리 없이 메모와 이미지를 자유롭게 붙여요" />
              <div style={GRID_STYLE}>
                <BlankCard id="board" dot="var(--mf-doc-board)" title="빈 화이트보드" desc="메모 하나로 시작 · 펜으로 그리기" onPick={() => controller.createFromTemplate('board')} />
                {boardCards.map(({ tpl, raw }) => (
                  <TemplateCard key={tpl.id} id={tpl.id} dot="var(--mf-doc-board)" title={tpl.name} desc={tpl.desc} preview={realPreview(raw, hue)} onPick={() => controller.createFromTemplate(tpl.id)} />
                ))}
              </div>
            </section>
          )}

          {showKanban && (
            <section style={SECTION_STYLE}>
              <SectionHead title="칸반 보드" desc="할 일을 열로 나눠 옮기며 관리해요" />
              <div style={GRID_STYLE}>
                <BlankCard id="kanban" dot="var(--mf-doc-kanban)" title="새 칸반 보드" desc="할 일 · 진행 중 · 완료로 시작" onPick={() => controller.createFromTemplate('kanban')} />
                {kanbanCards.map(({ tpl, raw }) => (
                  <TemplateCard key={tpl.id} id={tpl.id} dot="var(--mf-doc-kanban)" title={tpl.name} desc={tpl.desc} preview={realPreview(raw, hue)} onPick={() => controller.createFromTemplate(tpl.id)} />
                ))}
              </div>
            </section>
          )}
        </div>
      </>
    </Modal>
  );
}

/** 구획 머리 — 제목과 힌트가 **한 줄**(baseline)에 나란히 선다(디자인 원본). */
function SectionHead({ title, desc }: { title: string; desc: string }) {
  return (
    <div data-gallery-section={title} style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
      <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)' }}>{title}</span>
      <span style={{ fontSize: 11.5, color: 'var(--mf-faint)' }}>{desc}</span>
    </div>
  );
}

/** 템플릿 카드 — 미리보기(wash + 도트 격자 + 실렌더) 위, 점 + 이름 + 설명 아래. */
function TemplateCard({ id, dot, title, desc, preview, onPick }: { id: string; dot: string; title: string; desc: string; preview: ReturnType<typeof realPreview>; onPick: () => void }) {
  return (
    <button className="btn tpl-card" data-template={id} onClick={onPick} style={CARD_STYLE}>
      <span style={THUMB_STYLE}>
        <span aria-hidden="true" style={dotGridStyle(14)} />
        <span style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>{preview}</span>
      </span>
      <span style={BODY_STYLE}>
        <span style={NAME_ROW_STYLE}>
          <span data-template-dot aria-hidden="true" style={{ width: 6, height: 6, flexShrink: 0, borderRadius: 2, background: dot, display: 'block' }} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        </span>
        <span style={DESC_STYLE}>{desc}</span>
      </span>
    </button>
  );
}

/** 빈 문서 칸 — 점선 테두리 + 더하기(디자인 원본의 blank 칸). */
function BlankCard({ id, dot, title, desc, onPick }: { id: string; dot: string; title: string; desc: string; onPick: () => void }) {
  return (
    <button className="btn tpl-card" data-template={id} onClick={onPick} style={CARD_STYLE}>
      <span style={{ ...THUMB_STYLE, color: 'var(--mf-faint)' }}>
        <span aria-hidden="true" style={dotGridStyle(14)} />
        <span style={{ position: 'absolute', inset: 10, border: '1.5px dashed var(--mf-faint2)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mf-muted)' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
      </span>
      <span style={BODY_STYLE}>
        <span style={NAME_ROW_STYLE}>
          <span data-template-dot aria-hidden="true" style={{ width: 6, height: 6, flexShrink: 0, borderRadius: 2, background: dot, display: 'block' }} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        </span>
        <span style={DESC_STYLE}>{desc}</span>
      </span>
    </button>
  );
}

const SECTION_STYLE = { display: 'flex', flexDirection: 'column', gap: 12 } as const;

// auto-fill이라 폭에 따라 열 수가 알아서 준다 — 모바일 분기를 따로 두지 않는다.
// 디자인 원본의 minmax(196px, 1fr).
const GRID_STYLE = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(196px, 1fr))', gap: 14 } as const;

// 카드 겉면 — 패딩 0(미리보기가 위 모서리까지 찬다), transition은 home.css의
// `.tpl-card`가 정한다(hover 떠오름이 전이 없이 툭 바뀌지 않게 — 카드와 같은 함정).
const CARD_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  textAlign: 'left',
  padding: 0,
  border: '1px solid var(--mf-border-soft)',
  borderRadius: 16,
  background: 'var(--mf-card)',
  color: 'var(--mf-text)',
  fontFamily: 'inherit',
  overflow: 'hidden',
  cursor: 'pointer',
} as const;

// 미리보기 — 카드 썸네일과 같은 문법(wash + 도트 격자 + 실렌더).
const THUMB_STYLE = {
  position: 'relative',
  display: 'block',
  height: 112,
  background: 'var(--mf-wash)',
  overflow: 'hidden',
  borderBottom: '1px solid var(--mf-border-soft)',
} as const;

const BODY_STYLE = { display: 'flex', flexDirection: 'column', gap: 4, padding: '11px 13px 13px' } as const;
const NAME_ROW_STYLE = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 13, fontWeight: 700, letterSpacing: '-.015em' } as const;
// 설명은 두 줄 높이를 예약한다 — 칸마다 높이가 들쭉날쭉하지 않게(디자인 원본 min-height 34).
const DESC_STYLE = { fontSize: 11.5, lineHeight: 1.5, color: 'var(--mf-subtext)', minHeight: 34, display: 'block' } as const;
