import { useEffect, useMemo } from 'react';
import type { HomeState } from '../../types';
import type { HomeController } from '../../useHomeController';
import { BOARD_TEMPLATES, MAP_TEMPLATES, buildTemplateDoc } from '../../../../templates/mapTemplates';
import { realPreview } from '../../mapPreview';
import { HOME_THEMES } from '../../theme';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/**
 * 갤러리 카드 제목 앞 아이콘.
 *
 * 이모지가 아니라 SVG인 이유: 이모지는 **기기마다 다른 그림으로 그려진다**(안드로이드·
 * iOS·윈도우가 서로 다른 세트를 쓴다). 여기는 앱의 크롬이므로 우리가 그린 것이 맞고,
 * 앱의 다른 아이콘(가져오기·새 폴더·공유)과 같은 선(stroke) 언어로 맞췄다.
 *
 * 문서 **안**의 이모지(루트 도형의 `emoji`)는 그대로 둔다 — 그건 크롬이 아니라
 * 사용자가 이모지 고르기로 바꿀 수 있는 내용이고, 캔버스는 이모지를 글자로 그린다.
 */
function TemplateIcon({ id }: { id: string }) {
  const path = TEMPLATE_ICON_PATHS[id];
  if (!path) return null;
  return (
    <svg
      data-template-icon={id}
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, color: 'var(--mf-subtext)' }}
    >
      {path}
    </svg>
  );
}

const TEMPLATE_ICON_PATHS: Record<string, JSX.Element> = {
  // 전구 — 떠오르는 생각
  brainstorm: (
    <>
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .9 1.6h5.2c.1-.6.4-1.2.9-1.6A6 6 0 0 0 12 3z" />
      <path d="M10 19h4" />
      <path d="M10.7 21.5h2.6" />
    </>
  ),
  // 줄이 있는 문서 — 받아 적는 기록
  meeting: (
    <>
      <path d="M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h3.5" />
    </>
  ),
  // 달력 — 한 주
  weekly: (
    <>
      <path d="M5 5.5h14a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z" />
      <path d="M4 10h16" />
      <path d="M8.5 3v4" />
      <path d="M15.5 3v4" />
    </>
  ),
  // 로켓 — 시작하는 일
  project: (
    <>
      <path d="M12 2.5c2.9 2.4 4.3 5.8 4.3 9.2L12 16.2 7.7 11.7c0-3.4 1.4-6.8 4.3-9.2z" />
      <circle cx="12" cy="9.4" r="1.7" />
      <path d="M9.2 14.4 6.4 18.6l3.2-1" />
      <path d="M14.8 14.4l2.8 4.2-3.2-1" />
    </>
  ),
  // 저울 — 견주어 고르기
  decision: (
    <>
      <path d="M12 4v15" />
      <path d="M8 19.5h8" />
      <path d="M5 7.5h14" />
      <path d="M5 7.5 2.5 13h5L5 7.5z" />
      <path d="M19 7.5 16.5 13h5L19 7.5z" />
    </>
  ),
  // 순환 화살표 — 돌아보고 다음으로
  'board-retro': (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <polyline points="20 3 20 7.5 15.5 7.5" />
      <path d="M9.5 12.2 11.6 14.4 15 10.6" />
    </>
  ),
  // 세 열 — 할 일/진행 중/완료
  'board-kanban': (
    <>
      <rect x="2.5" y="4" width="5.5" height="16" rx="1.4" />
      <rect x="9.25" y="4" width="5.5" height="16" rx="1.4" />
      <rect x="16" y="4" width="5.5" height="16" rx="1.4" />
      <path d="M4 8h2.5" />
      <path d="M10.75 8h2.5" />
      <path d="M17.5 8h2.5" />
    </>
  ),
  // 2×2 사분면 — 임팩트·노력으로 나눈 네 칸
  'board-priority': (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M12 3.5v17" />
      <path d="M3.5 12h17" />
    </>
  ),
  // 스티커 두 장 — 붙였다 옮겼다
  'board-ideas': (
    <>
      <rect x="3.5" y="6" width="10" height="10" rx="1.6" />
      <path d="M10.5 10.5h10v7.5l-3.5 3.5h-6.5z" />
    </>
  ),
  // 펼친 책 — 배운 것
  study: (
    <>
      <path d="M12 6.6C10.6 5.3 8.6 4.7 6.2 4.7H4v13h2.2c2.4 0 4.4.6 5.8 1.9 1.4-1.3 3.4-1.9 5.8-1.9H20v-13h-2.2c-2.4 0-4.4.6-5.8 1.9z" />
      <path d="M12 6.6v13" />
    </>
  ),
};

/** 템플릿의 직렬화 본문 — 내용이 고정이라 한 번만 만들면 된다(캐시 키이기도 하다). */
const rawCache = new Map<string, string>();
function templateRaw(id: string): string {
  const hit = rawCache.get(id);
  if (hit !== undefined) return hit;
  const raw = JSON.stringify(buildTemplateDoc(id));
  rawCache.set(id, raw);
  return raw;
}

/**
 * 템플릿 갤러리 — "새로 만들기"가 여는 화면.
 *
 * 썸네일은 홈 카드·버전 기록이 쓰는 `realPreview` **그대로**다. 템플릿이 완성된
 * 문서라서 가능한 일이고, 덕분에 갤러리에서 본 모양과 실제로 열리는 맵이 어긋날
 * 수가 없다(따로 그린 삽화라면 내용이 바뀔 때마다 두 곳을 맞춰야 한다).
 *
 * 첫 칸은 **빈 맵**이다 — 갤러리를 거치게 만든 이상 예전의 "바로 빈 맵"이 사라지면
 * 안 되고, 첫 칸에 두면 습관적으로 누르는 사람의 손이 크게 달라지지 않는다.
 */
export function TemplateGallery({ state, controller }: Props) {
  const open = state.templateOpen;
  // 썸네일 hue는 지금 홈 테마의 강조색 — 카드 그리드와 같은 톤으로 보이게.
  const hue = HOME_THEMES[state.theme].accent;

  const cards = useMemo(() => MAP_TEMPLATES.map((t) => ({ tpl: t, raw: templateRaw(t.id) })), []);
  // 보드 템플릿도 완성된 `Doc`이라 썸네일은 같은 `realPreview`다(메모 배치가 그대로 보인다).
  const boardCards = useMemo(() => BOARD_TEMPLATES.map((t) => ({ tpl: t, raw: templateRaw(t.id) })), []);

  /**
   * 미리보기 캐시를 **한가할 때 미리 데운다**.
   *
   * 실측: 처음 열 때는 클릭에서 화면이 그려지기까지 78ms(롱태스크 55·60ms)가
   * 걸리고 두 번째부터는 12ms다 — 차이는 전부 `realPreview`가 6개 문서를
   * 레이아웃·측정하는 비용이고, 그 결과는 모듈 캐시에 남는다. 즉 느린 것은
   * 갤러리가 아니라 **첫 한 번**이고, 그 한 번을 클릭 순간이 아니라 아무 일도
   * 없는 때로 옮기면 사라진다(눌렀을 때 한 프레임 멎는 것이 깜빡임으로 보였다).
   *
   * hue가 캐시 키의 일부라 테마를 바꾸면 다시 데운다.
   */
  useEffect(() => {
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      for (const t of MAP_TEMPLATES) realPreview(templateRaw(t.id), hue);
      for (const t of BOARD_TEMPLATES) realPreview(templateRaw(t.id), hue);
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') controller.closeTemplates();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, controller]);

  if (!open) return null;

  return (
    <div
      onClick={controller.closeTemplates}
      // dim도 **함께 페이드**한다 — 애니메이션이 없으면 어두운 막이 한 프레임에
      // 툭 깔린 뒤 내용만 0.2초에 걸쳐 떠서, 둘이 어긋나는 것이 깜빡임으로 보였다.
      // `mf-fade`가 아니라 `mf-dim-in`인 이유는 #331과 같다(제자리 페이드가 아니면
      // fixed inset:0 레이어가 통째로 슬라이드해 상단에 dim 안 된 띠가 보인다).
      style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 140, padding: 16, animation: 'mf-dim-in .18s ease-out' }}
    >
      <div
        role="dialog"
        aria-label="새로 만들기"
        onClick={(e) => e.stopPropagation()}
        style={{
          // 마인드맵·화이트보드 두 구획으로 나뉘면서 폭을 키웠다 — 좁으면 구획
          // 제목만 늘고 카드는 한 줄에 두 장씩이라 "나눈 이유"가 잘 안 보인다.
          width: 860,
          maxWidth: '100%',
          // 화면 높이를 넘기지 않고 본문만 스크롤한다 — 폰·가로 모드에서도 헤더와
          // 닫기 버튼이 늘 보인다.
          maxHeight: 'calc(100dvh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--mf-panel)',
          borderRadius: 18,
          boxShadow: '0 24px 60px rgba(0,0,0,.28)',
          overflow: 'hidden',
          animation: 'mf-fade .2s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 20px', borderBottom: '1px solid var(--mf-hairline)', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>새로 만들기</div>
            <div style={{ fontSize: 12.5, color: 'var(--mf-muted)', marginTop: 3 }}>생각을 가지로 뻗는 마인드맵, 자유롭게 붙이는 화이트보드 중에서 골라 보세요.</div>
          </div>
          <button
            className="btn"
            aria-label="닫기"
            onClick={controller.closeTemplates}
            style={{ marginLeft: 'auto', width: 32, height: 32, border: 'none', borderRadius: 9, background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 두 문서 종류가 한 그리드에 섞여 있어 구별이 어려웠다(제보) — 구획으로
            나눈다. 마인드맵이 먼저인 이유는 칸 수가 많고(빈 맵 + 템플릿 6) 이
            제품의 기본 문서이기 때문. */}
        <div style={{ padding: 20, overflowY: 'auto' }}>
          <SectionHead title="마인드맵" desc="중심 주제에서 가지를 뻗어 정리해요" />
          <div style={GRID_STYLE}>
            {/* 빈 맵 — 갤러리를 거치게 됐어도 "그냥 시작"이 첫 칸에 남는다. */}
            <button
              className="btn"
              data-template="blank"
              onClick={() => controller.createFromTemplate()}
              style={{ ...CARD_STYLE, cursor: 'pointer' }}
            >
              <div style={{ ...THUMB_STYLE, color: 'var(--mf-faint)' }}>
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </div>
              <div style={CARD_NAME_STYLE}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>빈 맵</span>
              </div>
              <div style={CARD_DESC_STYLE}>중심 주제 하나로 시작</div>
            </button>

            {cards.map(({ tpl, raw }) => (
              <button
                key={tpl.id}
                className="btn"
                data-template={tpl.id}
                onClick={() => controller.createFromTemplate(tpl.id)}
                style={{ ...CARD_STYLE, cursor: 'pointer' }}
              >
                <div style={THUMB_STYLE}>{realPreview(raw, hue)}</div>
                <div style={CARD_NAME_STYLE}>
                  <TemplateIcon id={tpl.id} />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tpl.name}</span>
                </div>
                <div style={CARD_DESC_STYLE}>{tpl.desc}</div>
              </button>
            ))}
          </div>

          <div style={{ height: 1, background: 'var(--mf-hairline)', margin: '22px 0 18px' }} />

          <SectionHead title="화이트보드" desc="트리 없이 메모와 이미지를 자유롭게 붙여요" />
          <div style={GRID_STYLE}>
            {/* 화이트보드 — 내용이 비어 있어 realPreview 대신 삽화. */}
            <button className="btn" data-template="board" onClick={() => controller.createFromTemplate('board')} style={{ ...CARD_STYLE, cursor: 'pointer' }}>
              <div style={{ ...THUMB_STYLE, color: 'var(--mf-faint)' }}>
                <svg width="52" height="40" viewBox="0 0 52 40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="5" width="19" height="15" rx="2.5" />
                  <line x1="8.5" y1="10.5" x2="18.5" y2="10.5" />
                  <line x1="8.5" y1="14.5" x2="15.5" y2="14.5" />
                  <rect x="29" y="12" width="19" height="15" rx="2.5" />
                  <circle cx="34" cy="17" r="1.6" />
                  <path d="m29.5 24.5 5-5 4 4 3.5-3.5 5.5 5.5" />
                  <line x1="12" y1="27" x2="24" y2="33" strokeDasharray="0.1 3.6" />
                </svg>
              </div>
              <div style={CARD_NAME_STYLE}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>빈 화이트보드</span>
              </div>
              <div style={CARD_DESC_STYLE}>메모 하나로 시작 · 펜으로 그리기</div>
            </button>

            {boardCards.map(({ tpl, raw }) => (
              <button key={tpl.id} className="btn" data-template={tpl.id} onClick={() => controller.createFromTemplate(tpl.id)} style={{ ...CARD_STYLE, cursor: 'pointer' }}>
                <div style={THUMB_STYLE}>{realPreview(raw, hue)}</div>
                <div style={CARD_NAME_STYLE}>
                  <TemplateIcon id={tpl.id} />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tpl.name}</span>
                </div>
                <div style={CARD_DESC_STYLE}>{tpl.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 구획 머리 — 제목 + 한 줄 설명(무엇이 다른 문서인지). */
function SectionHead({ title, desc }: { title: string; desc: string }) {
  return (
    <div data-gallery-section={title} style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--mf-text)' }}>{title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--mf-muted)', marginTop: 2 }}>{desc}</div>
    </div>
  );
}

// auto-fill이라 폭에 따라 열 수가 알아서 4 → 3 → 2 → 1로 준다. 모바일 분기를
// 따로 두지 않는 이유다.
// 최소 폭이 180인 이유: 860px 모달에서 네 열이 되어 마인드맵 칸 7개가 두 줄에
// 들어간다(200이면 세 열 = 세 줄이라 화이트보드 구획이 접힌 화면 밖으로 밀린다).
const GRID_STYLE = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 } as const;

const CARD_STYLE = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: 10,
  border: '1px solid var(--mf-border)',
  borderRadius: 14,
  background: 'var(--mf-panel)',
  color: 'var(--mf-text)',
  fontFamily: 'inherit',
} as const;

// 미리보기 SVG는 컨테이너의 88%를 차지하며 자기 비율을 지킨다(`realPreview`) —
// 홈 카드와 똑같이 가운데 정렬 flex 박스 안에 놓아야 제자리에 그려진다.
const THUMB_STYLE = {
  height: 108,
  borderRadius: 10,
  background: 'var(--mf-sunken)',
  overflow: 'hidden',
  marginBottom: 9,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
} as const;

const CARD_NAME_STYLE = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden' } as const;
const CARD_DESC_STYLE = { fontSize: 11.5, color: 'var(--mf-muted)', marginTop: 3, lineHeight: 1.45 } as const;
