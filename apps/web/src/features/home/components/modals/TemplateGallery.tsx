import { useEffect, useMemo } from 'react';
import type { HomeState } from '../../types';
import type { HomeController } from '../../useHomeController';
import { MAP_TEMPLATES, buildTemplateDoc } from '../../../../templates/mapTemplates';
import { realPreview } from '../../mapPreview';
import { HOME_THEMES } from '../../theme';

interface Props {
  state: HomeState;
  controller: HomeController;
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

  // 문서 조립은 열려 있을 때만. 닫힌 모달이 6개 문서를 만들 이유가 없다
  // (`realPreview`는 자체 캐시가 있어 다시 열 때는 값싸다).
  const cards = useMemo(() => {
    if (!open) return [];
    return MAP_TEMPLATES.map((t) => ({ tpl: t, raw: JSON.stringify(buildTemplateDoc(t.id)) }));
  }, [open]);

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
      style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 140, padding: 16 }}
    >
      <div
        role="dialog"
        aria-label="새 맵 만들기"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 760,
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
            <div style={{ fontSize: 17, fontWeight: 800 }}>새 맵 만들기</div>
            <div style={{ fontSize: 12.5, color: 'var(--mf-muted)', marginTop: 3 }}>빈 맵으로 시작하거나, 템플릿을 골라 보세요.</div>
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

        <div
          style={{
            padding: 20,
            overflowY: 'auto',
            display: 'grid',
            // auto-fill이라 폭에 따라 열 수가 알아서 3 → 2 → 1로 준다. 모바일
            // 분기를 따로 두지 않는 이유다.
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 14,
          }}
        >
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
            <div style={CARD_NAME_STYLE}>빈 맵</div>
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
                <span aria-hidden="true">{tpl.emoji}</span> {tpl.name}
              </div>
              <div style={CARD_DESC_STYLE}>{tpl.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

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

const CARD_NAME_STYLE = { fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;
const CARD_DESC_STYLE = { fontSize: 11.5, color: 'var(--mf-muted)', marginTop: 3, lineHeight: 1.45 } as const;
