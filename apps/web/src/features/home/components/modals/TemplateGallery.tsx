import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { HomeState } from '../../types';
import type { HomeController } from '../../useHomeController';
import { BOARD_TEMPLATES, KANBAN_TEMPLATES, MAP_TEMPLATES, NOTE_TEMPLATES, buildTemplateDoc } from '../../../../templates/mapTemplates';
import type { NoteTemplate } from '../../../../templates/mapTemplates';
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

type TabName = '마인드맵' | '화이트보드' | '공책' | '칸반 보드';

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
  maxHeight: 'calc(var(--mf-app-h) - 32px)',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--mf-card)',
  border: '1px solid var(--mf-border)',
  borderRadius: 24,
  boxShadow: '0 44px 90px -40px rgba(46,42,38,.6)',
  overflow: 'hidden',
};

/** 레일의 종류 아이콘(디자인 원본의 `ICON`) — 선 아이콘 한 벌. */
const KIND_ICONS = {
  map: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 9.4V5M12 14.6V19M9.6 12H5M14.4 12H19" />
      <circle cx="12" cy="4" r="1.4" />
      <circle cx="12" cy="20" r="1.4" />
      <circle cx="4" cy="12" r="1.4" />
      <circle cx="20" cy="12" r="1.4" />
    </svg>
  ),
  board: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="12" rx="2.2" />
      <path d="M8 20h8M12 16.5V20" />
      <path d="m7.5 12 3-3 2.5 2.5 3.5-3.5" />
    </svg>
  ),
  note: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5h9l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M15 3.5v4h4M8.5 12h7M8.5 16h5" />
    </svg>
  ),
  kanban: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="4" width="4.6" height="16" rx="1.3" />
      <rect x="9.7" y="4" width="4.6" height="10" rx="1.3" />
      <rect x="15.9" y="4" width="4.6" height="13" rx="1.3" />
    </svg>
  ),
} as const;

export function TemplateGallery({ state, controller }: Props) {
  const open = state.templateOpen;
  const [tab, setTab] = useState<TabName>('마인드맵');
  // 썸네일 hue는 지금 홈 테마의 강조색 — 카드 그리드와 같은 톤으로 보이게.
  const hue = HOME_THEMES[state.theme].accent;

  const cards = useMemo(() => MAP_TEMPLATES.filter((t) => GALLERY_MAP_IDS.includes(t.id)).map((t) => ({ tpl: t, raw: templateRaw(t.id) })), []);
  // 보드 템플릿도 완성된 `Doc`이라 썸네일은 같은 `realPreview`다(메모 배치가 그대로 보인다).
  const boardCards = useMemo(() => BOARD_TEMPLATES.map((t) => ({ tpl: t, raw: templateRaw(t.id) })), []);
  const kanbanCards = useMemo(() => KANBAN_TEMPLATES.map((t) => ({ tpl: t, raw: templateRaw(t.id) })), []);

  // 열 때마다 **첫 종류**에서 시작한다 — 지난번에 남겨 둔 탭이 "템플릿이 사라졌다"로
  // 보인다. 다만 **종류가 정해진 문**으로 들어왔으면 그 탭으로 연다(스페이스의
  // `공책 만들기` 타일이 그 길이다).
  useEffect(() => {
    if (!open) return;
    const want = state.templateTab;
    setTab(want === '마인드맵' || want === '화이트보드' || want === '칸반 보드' || want === '공책' ? want : '마인드맵');
  }, [open, state.templateTab]);

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
  // 왼쪽 레일의 종류 넷(디자인 원본의 순서). 개수는 **템플릿 수**다 — 빈 문서 칸은
  // 템플릿이 아니라 "바로 시작"이므로 세지 않는다.
  const tabs: { name: TabName; dot: string; count: number; icon: JSX.Element }[] = [
    { name: '마인드맵', dot: 'var(--mf-doc-map)', count: cards.length, icon: KIND_ICONS.map },
    { name: '화이트보드', dot: 'var(--mf-doc-board)', count: boardCards.length, icon: KIND_ICONS.board },
    { name: '공책', dot: 'var(--mf-doc-note)', count: NOTE_TEMPLATES.length, icon: KIND_ICONS.note },
    { name: '칸반 보드', dot: 'var(--mf-doc-kanban)', count: kanbanCards.length, icon: KIND_ICONS.kanban },
  ];

  // 한 번에 **한 종류**만 보여 준다(디자인) — 넷을 한 화면에 쌓으면 스크롤이 길고
  // 무엇을 만들지 이미 정한 사람에게 나머지 셋은 지나가는 길이다.
  const showMap = tab === '마인드맵';
  const showBoard = tab === '화이트보드';
  const showKanban = tab === '칸반 보드';
  const showNote = tab === '공책';

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
            <div style={{ fontSize: 12.5, color: 'var(--mf-subtext)' }}>만들 것을 왼쪽에서 고르고, 빈 문서로 바로 시작하거나 템플릿을 골라요.</div>
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

        {/* 아래는 두 칸이다 — **왼쪽 레일**(종류)과 본문(빈 문서 + 템플릿).
            가로 탭 줄이던 것을 세로 레일로 바꿨다(요청·디자인): 종류가 넷이 되면서
            가로 줄은 좁은 화면에서 두 줄로 접히고, 각 종류가 무엇인지 아이콘으로
            말할 자리도 없었다. 레일은 넷이 늘어도 같은 모양으로 자란다. */}
        <div className="mf-gallery-body" style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          <div
            className="mf-gallery-rail lnb-scroll"
            style={{ width: 190, flex: '0 0 auto', borderRight: '1px solid var(--mf-hairline)', padding: '14px 12px 18px', display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto' }}
          >
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
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    height: 46,
                    padding: '0 10px',
                    borderRadius: 12,
                    border: `1px solid ${on ? 'var(--mf-border-soft)' : 'transparent'}`,
                    background: on ? 'var(--mf-card)' : 'transparent',
                    color: on ? 'var(--mf-text)' : 'var(--mf-subtext)',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    fontWeight: on ? 800 : 600,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background .14s ease, color .14s ease, border-color .14s ease',
                    boxShadow: on ? '0 6px 16px -12px rgba(46,42,38,.5)' : 'none',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 28,
                      height: 28,
                      flex: '0 0 auto',
                      borderRadius: 9,
                      background: on ? 'var(--mf-panel2)' : 'var(--mf-wash)',
                      color: t.dot,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {t.icon}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    <span style={{ fontFamily: MONO_FONT, fontSize: 10, fontWeight: 500, color: 'var(--mf-faint)' }}>템플릿 {t.count}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="lnb-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 26 }}>
          {showMap && (
            <section style={SECTION_STYLE}>
              <SectionHead title="마인드맵" desc="중심 주제에서 가지를 뻗어 정리해요" />
              <BlankRow id="blank" dot="var(--mf-doc-map)" icon={KIND_ICONS.map} title="빈 맵" desc="중심 주제 하나로 시작" onPick={() => controller.createFromTemplate()} />
              <TemplateHead hint="자주 쓰는 틀에서 시작하면 첫 칸을 채우기 쉬워요" />
              <div style={GRID_STYLE}>
                {cards.map(({ tpl, raw }) => (
                  <TemplateCard key={tpl.id} id={tpl.id} dot="var(--mf-doc-map)" title={tpl.name} desc={tpl.desc} preview={realPreview(raw, hue)} onPick={() => controller.createFromTemplate(tpl.id)} />
                ))}
              </div>
            </section>
          )}

          {showBoard && (
            <section style={SECTION_STYLE}>
              <SectionHead title="화이트보드" desc="트리 없이 메모와 이미지를 자유롭게 붙여요" />
              <BlankRow id="board" dot="var(--mf-doc-board)" icon={KIND_ICONS.board} title="빈 화이트보드" desc="메모 하나로 시작 · 펜으로 그리기" onPick={() => controller.createFromTemplate('board')} />
              <TemplateHead hint="회고·우선순위처럼 자리가 정해진 판에서 시작해요" />
              <div style={GRID_STYLE}>
                {boardCards.map(({ tpl, raw }) => (
                  <TemplateCard key={tpl.id} id={tpl.id} dot="var(--mf-doc-board)" title={tpl.name} desc={tpl.desc} preview={realPreview(raw, hue)} onPick={() => controller.createFromTemplate(tpl.id)} />
                ))}
              </div>
            </section>
          )}

          {showKanban && (
            <section style={SECTION_STYLE}>
              <SectionHead title="칸반 보드" desc="할 일을 열로 나눠 옮기며 관리해요" />
              <BlankRow id="kanban" dot="var(--mf-doc-kanban)" icon={KIND_ICONS.kanban} title="새 칸반 보드" desc="할 일 · 진행 중 · 완료로 시작" onPick={() => controller.createFromTemplate('kanban')} />
              <TemplateHead hint="열 구성이 이미 잡힌 보드로 시작해요" />
              <div style={GRID_STYLE}>
                {kanbanCards.map(({ tpl, raw }) => (
                  <TemplateCard key={tpl.id} id={tpl.id} dot="var(--mf-doc-kanban)" title={tpl.name} desc={tpl.desc} preview={realPreview(raw, hue)} onPick={() => controller.createFromTemplate(tpl.id)} />
                ))}
              </div>
            </section>
          )}

          {/* 공책 — 네 번째 구획. 썸네일이 다른 셋과 다르다: **축소한 문서가 아니라
              지면 스케치**다(공책은 캔버스가 아니라 글이라 축소할 그림이 없다.
              `NotePreview` 주석 참고). */}
          {showNote && (
            <section style={SECTION_STYLE}>
              <SectionHead title="공책" desc="글로 남기고 검색해서 다시 찾아요" />
              <BlankRow id="note" dot="var(--mf-doc-note)" icon={KIND_ICONS.note} title="빈 공책" desc="제목부터 적고 블록을 쌓아요" onPick={() => controller.createFromTemplate('note')} />
              {/* 공책 템플릿이 만드는 것은 공책 껍데기가 아니라 **첫 페이지의 뼈대**다
                  (`NOTE_TEMPLATES` 주석) — 힌트가 그 사실을 말해 준다. */}
              <TemplateHead hint="첫 페이지에 소제목·체크리스트·표를 미리 깔아 둬요" />
              <div style={GRID_STYLE}>
                {NOTE_TEMPLATES.map((tpl) => (
                  <TemplateCard
                    key={tpl.id}
                    id={tpl.id}
                    dot="var(--mf-doc-note)"
                    title={tpl.name}
                    desc={tpl.desc}
                    preview={<NotePreview tpl={tpl} />}
                    onPick={() => controller.createFromTemplate(tpl.id)}
                  />
                ))}
              </div>
            </section>
          )}
          </div>
        </div>
      </>
    </Modal>
  );
}

/**
 * 공책 템플릿의 썸네일 — **지면 스케치**.
 *
 * 다른 셋은 `realPreview`로 진짜 문서를 축소해 보여 준다("갤러리에서 본 모양과
 * 실제로 열리는 문서가 어긋날 수 없다"는 결정). 공책에는 그 길이 없다: 글을 그 크기로
 * 줄이면 읽을 수 없는 회색 줄이 되고, 그건 문서를 보여 주는 것이 아니라 흉내다.
 *
 * 그래서 **그 템플릿이 실제로 까는 블록을 막대로 그린다** — 회의록에는 표가, 회고에는
 * 목록 두 덩이가 보인다. 넷이 서로 다르게 보이고, 그 차이가 실제 차이와 같다.
 */
function NotePreview({ tpl }: { tpl: NoteTemplate }) {
  const bars: JSX.Element[] = [];
  let y = 0;
  tpl.lines.forEach((line, i) => {
    const [kind] = line;
    if (y > 92) return;
    if (kind === 'h' || kind === 'h3') {
      bars.push(<span key={i} style={{ display: 'block', height: 6, width: '46%', borderRadius: 3, background: 'var(--mf-doc-note)', opacity: 0.55, marginTop: y ? 7 : 0 }} />);
      y += 13;
    } else if (kind === 'ul' || kind === 'ck') {
      (line[1] as string[]).forEach((_, j) => {
        bars.push(
          <span key={`${i}-${j}`} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
            <span style={{ width: 4, height: 4, flex: '0 0 auto', borderRadius: kind === 'ck' ? 1 : 999, background: 'var(--mf-faint2)' }} />
            <span style={{ display: 'block', height: 4, width: `${64 - j * 8}%`, borderRadius: 2, background: 'var(--mf-faint2)' }} />
          </span>,
        );
        y += 9;
      });
    } else if (kind === 'tb') {
      const cols = (line[1] as string[]).length;
      bars.push(
        <span key={i} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 2, marginTop: 7, border: '1px solid var(--mf-border-soft)', borderRadius: 3, padding: 2 }}>
          {Array.from({ length: cols * 3 }, (_, j) => (
            <span key={j} style={{ display: 'block', height: 4, borderRadius: 1, background: j < cols ? 'var(--mf-faint)' : 'var(--mf-faint2)', opacity: j < cols ? 0.7 : 0.5 }} />
          ))}
        </span>,
      );
      y += 26;
    } else if (kind === 'q') {
      bars.push(
        <span key={i} style={{ display: 'flex', gap: 5, marginTop: 7 }}>
          <span style={{ width: 2, flex: '0 0 auto', borderRadius: 1, background: 'var(--mf-doc-note)', opacity: 0.5 }} />
          <span style={{ display: 'block', height: 4, width: '70%', borderRadius: 2, background: 'var(--mf-faint2)' }} />
        </span>,
      );
      y += 12;
    } else {
      bars.push(<span key={i} style={{ display: 'block', height: 4, width: '82%', borderRadius: 2, background: 'var(--mf-faint2)', marginTop: y ? 5 : 0 }} />);
      y += 9;
    }
  });
  return (
    <span aria-hidden="true" style={{ display: 'block', width: '78%', padding: '10px 0 0' }}>
      {/* 제목 줄 — 페이지 제목 자리(굵고 짧다). */}
      <span style={{ display: 'block', height: 7, width: '58%', borderRadius: 3, background: 'var(--mf-doc-note)', opacity: 0.85, marginBottom: 9 }} />
      {bars}
    </span>
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

/**
 * `바로 시작` 줄 — 그 종류의 **빈 문서**(디자인 원본의 blank 행).
 *
 * 예전에는 그리드 첫 칸의 점선 카드였다. 전폭 한 줄로 올린 이유: 템플릿을 고르지
 * 않고 그냥 시작하는 것이 가장 잦은 선택인데, 같은 크기의 카드 여섯 중 하나로 섞여
 * 있으면 눈으로 찾아야 했다. 지금은 구획 맨 위에서 한 번에 읽힌다.
 */
function BlankRow({ id, dot, icon, title, desc, onPick }: { id: string; dot: string; icon: JSX.Element; title: string; desc: string; onPick: () => void }) {
  return (
    <button
      className="btn tpl-card"
      data-template={id}
      onClick={onPick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        width: '100%',
        padding: '13px 15px',
        border: '1px solid var(--mf-border-soft)',
        borderRadius: 14,
        background: 'var(--mf-card)',
        color: 'var(--mf-text)',
        fontFamily: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 36, height: 36, flex: '0 0 auto', borderRadius: 11, background: 'var(--mf-wash)', color: dot, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {icon}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-.02em' }}>{title}</span>
        <span style={{ fontSize: 11.5, color: 'var(--mf-subtext)' }}>{desc}</span>
      </span>
      <span
        style={{
          flex: '0 0 auto',
          height: 28,
          padding: '0 12px',
          borderRadius: 999,
          background: 'var(--mf-accent-soft)',
          color: 'var(--mf-accent-deep)',
          fontSize: 11.5,
          fontWeight: 800,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        바로 시작
      </span>
    </button>
  );
}

/** `템플릿` 머리 — 빈 문서 줄과 카드 그리드 사이를 가른다. */
function TemplateHead({ hint }: { hint: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
      <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.02em', color: 'var(--mf-subtext)' }}>템플릿</span>
      <span style={{ fontSize: 11, color: 'var(--mf-faint)' }}>{hint}</span>
    </div>
  );
}

/** 템플릿 카드 — 미리보기(wash + 도트 격자 + 실렌더) 위, 점 + 이름 + 설명 아래. */
function TemplateCard({ id, dot, title, desc, preview, onPick }: { id: string; dot: string; title: string; desc: string; preview: JSX.Element | null; onPick: () => void }) {
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
