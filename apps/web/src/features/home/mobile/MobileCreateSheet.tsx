// 「새로 만들기」 시트(모바일 홈 디자인 M6 → M7) — 스페이스 탭의 ＋가 연다.
//
// 데스크톱의 템플릿 갤러리(가로 탭 + 카드 그리드)는 폰 폭에서 카드 한 장이 화면을 다 먹는다.
// 시트는 두 걸음이다: ① 종류(공책·마인드맵·화이트보드·칸반 보드)와 새 폴더·가져오기 →
// ② 그 종류의 「빈 문서로 시작」 + 템플릿 목록. 자주 쓰는 종류가 손 가까운 아래에 선다.
//
// 템플릿은 갤러리와 **같은 목록**이다(`MAP_TEMPLATES`의 갤러리 몫 · 보드 · 칸반 · 공책) —
// 같은 앱에서 화면에 따라 고를 수 있는 템플릿이 달라지면 안 된다. 만드는 길도 같다
// (`createFromTemplate`). 썸네일도 갤러리가 쓰는 `realPreview` 그대로다(공책은 지면 스케치).

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeViewModel, DocKindName } from '../viewModel';
import { BOARD_TEMPLATES, KANBAN_TEMPLATES, MAP_TEMPLATES, NOTE_TEMPLATES } from '../../../templates/mapTemplates';
import { GALLERY_MAP_IDS, templateRaw } from '../components/modals/TemplateGallery';
import { realPreview } from '../mapPreview';
import { HOME_THEMES } from '../theme';
import { MONO_FONT } from '../chrome';
import { BackGlyph, Chevron, Glyph, KIND_META, M_ICON, MobileSheet, SheetClose, kindTile, noteGrid } from './parts';

interface Props {
  open: boolean;
  onClose: () => void;
  view: HomeViewModel;
  controller: HomeController;
}

/** 시트에 서는 순서 — 공책이 맨 위(디자인). */
const KINDS: DocKindName[] = ['note', 'map', 'board', 'kanban'];

/** `createFromTemplate`이 받는 빈 문서 키 — 마인드맵은 인자 없음. */
const BLANK_ID: Record<DocKindName, string | undefined> = { note: 'note', map: undefined, board: 'board', kanban: 'kanban' };
const BLANK_LABEL: Record<DocKindName, string> = { note: '빈 공책으로 시작', map: '빈 마인드맵으로 시작', board: '빈 화이트보드로 시작', kanban: '빈 칸반 보드로 시작' };

interface Tpl {
  id: string;
  name: string;
  desc: string;
}

function templatesOf(kind: DocKindName): Tpl[] {
  if (kind === 'note') return NOTE_TEMPLATES;
  if (kind === 'board') return BOARD_TEMPLATES;
  if (kind === 'kanban') return KANBAN_TEMPLATES;
  return MAP_TEMPLATES.filter((t) => GALLERY_MAP_IDS.includes(t.id));
}

/** 공책 템플릿의 썸네일 — 모눈 종이에 제목 막대 + 줄(디자인). 글을 그 크기로 줄이면 읽을 수 없는
 * 회색 줄이 될 뿐이라, 갤러리처럼 "공책 한 장"이라는 것만 말한다. 줄 길이는 템플릿마다 갈린다. */
function NoteThumb({ seed }: { seed: number }) {
  const w = (base: number, k: number) => `${base + ((seed * 7 + k * 5) % 14)}px`;
  const bar = (top: number, width: string, height: number, bg: string) => <span style={{ position: 'absolute', left: 9, top, width, height, borderRadius: 99, background: bg, display: 'block' }} />;
  const line = 'var(--mf-m-faint2)';
  const pink = `color-mix(in srgb, ${KIND_META.note.color} 40%, var(--mf-m-card))`;
  return (
    <>
      {bar(9, w(32, 1), 5, KIND_META.note.color)}
      {bar(19, '52px', 3, line)}
      {bar(26, w(24, 2), 3, pink)}
      {bar(33, '44px', 3, line)}
      {bar(40, w(28, 3), 3, pink)}
      {bar(47, '56px', 3, line)}
    </>
  );
}

function TemplateRow({ tpl, kind, index, hue, onPick }: { tpl: Tpl; kind: DocKindName; index: number; hue: string; onPick: () => void }) {
  const preview = kind === 'note' ? null : realPreview(templateRaw(tpl.id), hue);
  return (
    <button
      type="button"
      className="btn mf-m-press"
      data-template={tpl.id}
      onClick={onPick}
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 4px', border: 0, borderTop: '1px solid var(--mf-m-line)', background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          width: 78,
          height: 58,
          flex: '0 0 auto',
          boxSizing: 'border-box',
          borderRadius: 8,
          backgroundColor: 'var(--mf-m-card)',
          backgroundImage: kind === 'note' ? noteGrid() : 'none',
          backgroundSize: '8px 8px',
          border: '1px solid var(--mf-m-card-line)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {kind === 'note' ? <NoteThumb seed={index} /> : preview}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-m-ink)' }}>{tpl.name}</span>
        <span style={{ fontSize: 12.5, color: 'var(--mf-m-mut2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tpl.desc}</span>
      </span>
      <Chevron />
    </button>
  );
}

function ExtraButton({ icon, label, onClick, attr }: { icon: ReactNode; label: string; onClick: () => void; attr: string }) {
  return (
    <button
      type="button"
      className="btn mf-m-press"
      {...{ [attr]: '' }}
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, border: '1px solid var(--mf-m-btn-line)', borderRadius: 12, background: 'var(--mf-m-card)', color: 'var(--mf-m-ink2)', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
    >
      <Glyph d={icon} size={17} />
      {label}
    </button>
  );
}

export function MobileCreateSheet({ open, onClose, view, controller }: Props) {
  const [kind, setKind] = useState<DocKindName | null>(null);
  // 열 때마다 첫 걸음에서 — 지난번에 들어가 둔 종류가 남으면 "종류를 고르는 곳"이 사라진 것처럼 보인다.
  useEffect(() => {
    if (open) setKind(null);
  }, [open]);
  const hue = HOME_THEMES[controller.state.theme].accent;
  const templates = useMemo(() => (kind ? templatesOf(kind) : []), [kind]);
  // 만들기는 시트를 닫고 시작한다 — 로더가 시트 위로 덮이면 닫히는 순간 화면이 한 번 튄다.
  const pick = (id: string | undefined) => {
    onClose();
    controller.createFromTemplate(id);
  };
  const extras = view.newFolderVisible || view.importVisible;

  return (
    <MobileSheet open={open} onClose={onClose} label={kind ? `새 ${KIND_META[kind].label}` : '새로 만들기'} attrs={{ 'data-m-create-sheet': kind ?? 'root' }} maxHeight="calc(100% - 96px)">
      {kind === null ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 8px', flex: '0 0 auto' }}>
            <span style={{ flex: 1, fontSize: 20, fontWeight: 800, letterSpacing: '-.03em', color: 'var(--mf-m-ink)' }}>새로 만들기</span>
            <SheetClose onClick={onClose} />
          </div>
          {extras && (
            <div style={{ display: 'grid', gridTemplateColumns: view.newFolderVisible && view.importVisible ? '1fr 1fr' : '1fr', gap: 8, padding: '4px 16px 0', flex: '0 0 auto' }}>
              {view.newFolderVisible && (
                <ExtraButton
                  attr="data-m-create-folder"
                  icon={M_ICON.folderPlus}
                  label="새 폴더"
                  onClick={() => {
                    onClose();
                    controller.openNewFolder();
                  }}
                />
              )}
              {view.importVisible && (
                <ExtraButton
                  attr="data-m-create-import"
                  icon={M_ICON.upload}
                  label="가져오기"
                  onClick={() => {
                    // 파일 고르기 창은 **누른 그 순간**(사용자 동작 안)에 열어야 한다 — 시트를 닫은 뒤
                    // 비동기로 열면 iOS 사파리가 막는다.
                    controller.openImport();
                    onClose();
                  }}
                />
              )}
            </div>
          )}
          <span style={{ display: 'block', padding: '18px 20px 4px', fontSize: 12, fontWeight: 800, color: 'var(--mf-m-faint)', flex: '0 0 auto' }}>새 문서</span>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '0 8px 8px', flex: '0 0 auto' }}>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className="btn mf-m-press"
                data-m-create-kind={k}
                onClick={() => setKind(k)}
                style={{ display: 'flex', alignItems: 'center', gap: 14, height: 58, padding: '0 12px', border: 0, borderRadius: 14, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}
              >
                <span aria-hidden="true" style={{ width: 40, height: 40, flex: '0 0 auto', borderRadius: 12, background: kindTile(k), display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Glyph d={KIND_META[k].icon} size={20} stroke={KIND_META[k].color} />
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-m-ink)' }}>{KIND_META[k].label}</span>
                <Chevron />
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 12px 6px 8px', flex: '0 0 auto' }}>
            <button type="button" className="btn mf-m-press" data-m-create-back aria-label="종류 고르기로 돌아가기" onClick={() => setKind(null)} style={{ width: 40, height: 40, border: 0, borderRadius: 12, background: 'transparent', color: 'var(--mf-m-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}>
              <BackGlyph />
            </button>
            <span style={{ flex: 1, minWidth: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-.03em', color: 'var(--mf-m-ink)' }}>{KIND_META[kind].label}</span>
            <SheetClose onClick={onClose} />
          </div>
          <div className="mf-m-scroll" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '8px 16px 18px' }}>
            <button
              type="button"
              className="btn"
              data-template={BLANK_ID[kind] ?? 'blank'}
              onClick={() => pick(BLANK_ID[kind])}
              style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', boxSizing: 'border-box', padding: '14px 12px 14px 16px', border: 0, borderRadius: 16, background: 'var(--mf-m-ink)', color: 'var(--mf-m-card)', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}
            >
              <Glyph d={KIND_META[kind].icon} size={24} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 800, letterSpacing: '-.015em' }}>{BLANK_LABEL[kind]}</span>
              <Chevron color="var(--mf-m-faint)" size={16} />
            </button>
            {templates.length > 0 && (
              <>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '22px 4px 8px', fontSize: 12, fontWeight: 800, color: 'var(--mf-m-faint)' }}>
                  템플릿 <span style={{ fontFamily: MONO_FONT, fontWeight: 600, color: 'var(--mf-m-faint2)' }}>{templates.length}</span>
                </span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {templates.map((t, i) => (
                    <TemplateRow key={t.id} tpl={t} kind={kind} index={i} hue={hue} onPick={() => pick(t.id)} />
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </MobileSheet>
  );
}
