// 모바일 「전체」 탭(모바일 홈 디자인 M5) — 햄버거 서랍의 나머지(모아보기·도구·관리·계정)를 한 화면에.
//
// 서랍(LNB)에 있던 것 가운데 탭 셋(스페이스·일정·알림)이 가져가지 않은 것이 전부 여기로 온다.
// 모아보기 셋은 한 겹 들어간 화면(디자인 F1·F2)으로 편다 — 서랍의 접이식 목록은 폭 248px에
// 맞춘 것이라 폰 한 화면을 다 쓰는 자리에서는 줄이 더 넉넉해야 읽힌다.
//
// 동작은 전부 데스크톱과 **같은 컨트롤러 함수**다(즐겨찾기 해제·공유받은 문서 열기·복원·영구
// 삭제·비우기·설정·피드백·로그아웃) — 화면만 다르고 규칙은 한 벌이다.

import { useMemo, useState, type ReactNode } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import type { HomeViewModel } from '../viewModel';
import { formatLastEdited } from '../timeFormat';
import { MONO_FONT } from '../chrome';
import { UNREAD_BADGE_BG } from '../theme';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { buildLabel } from '../components/modals/VersionSection';
import { useTools } from '../../tools/useTools';
import { Chevron, Glyph, KIND_META, M_ICON, SubPageHeader } from './parts';
import { MobileSpaceSheet } from './MobileSpaceSheet';

interface Props {
  state: HomeState;
  view: HomeViewModel;
  controller: HomeController;
}

type Sub = 'root' | 'fav' | 'shared' | 'trash';

interface Row {
  key: string;
  label: string;
  icon: ReactNode;
  tint: string;
  count?: string;
  badge?: number;
  danger?: boolean;
  onClick: () => void;
}

function Group({ name, rows }: { name: string; rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <>
      {name && <span style={{ padding: '14px 20px 6px', fontSize: 12, fontWeight: 800, color: 'var(--mf-m-faint)' }}>{name}</span>}
      <div data-m-more-group={name || '계정'} style={{ display: 'flex', flexDirection: 'column', margin: name ? '0 16px' : '18px 16px 0', borderRadius: 14, background: 'var(--mf-m-card)', border: '1px solid var(--mf-m-card-line)', overflow: 'hidden', flex: '0 0 auto' }}>
        {rows.map((r, i) => (
          <button
            key={r.key}
            type="button"
            className="btn mf-m-press"
            data-m-more-row={r.key}
            onClick={r.onClick}
            style={{ display: 'flex', alignItems: 'center', gap: 12, height: 52, padding: '0 14px 0 16px', border: 0, borderTop: i ? '1px solid var(--mf-m-line)' : 0, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}
          >
            <Glyph d={r.icon} size={18} stroke={r.tint} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: r.danger ? 'var(--mf-m-danger)' : 'var(--mf-m-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
            {r.badge ? (
              <span aria-label={`새로 공유됨 ${r.badge}개`} style={{ minWidth: 18, padding: '1px 6px', boxSizing: 'border-box', borderRadius: 99, background: UNREAD_BADGE_BG, color: '#fff', fontSize: 10.5, fontWeight: 800, textAlign: 'center' }}>
                {r.badge}
              </span>
            ) : (
              r.count && <span style={{ fontFamily: MONO_FONT, fontSize: 12, color: 'var(--mf-m-faint)' }}>{r.count}</span>
            )}
            {!r.danger && <Chevron size={13} />}
          </button>
        ))}
      </div>
    </>
  );
}

function KindIcon({ kind }: { kind: keyof typeof KIND_META }) {
  return <Glyph d={KIND_META[kind].icon} size={22} stroke={KIND_META[kind].color} />;
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <div data-m-sub-empty style={{ padding: '48px 24px', textAlign: 'center', fontSize: 13.5, lineHeight: 1.65, color: 'var(--mf-m-mut)', wordBreak: 'keep-all' }}>{children}</div>;
}

const ROW_TITLE = { fontSize: 15.5, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-m-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;
const ROW_META = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 12, color: 'var(--mf-m-mut2)', whiteSpace: 'nowrap', overflow: 'hidden' } as const;

/** F1 공유받음 — 누가 준 것인지 대신 **언제 · 권한**(우리 데이터에는 준 사람이 없다). */
function SharedPage({ state, view, controller, onBack }: Props & { onBack: () => void }) {
  const times = useMemo(() => new Map(state.sharedMaps.map((m) => [m.docId, m.updatedAt])), [state.sharedMaps]);
  return (
    <>
      <SubPageHeader back="전체" onBack={onBack} title="공유받음" count={view.sharedItems.length} />
      <div className="mf-m-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '6px 16px 30px' }}>
        {view.sharedItems.map((m) => {
          const readOnly = m.role === 'view';
          const when = formatLastEdited(times.get(m.docId));
          return (
            <button
              key={m.docId}
              type="button"
              className="btn mf-m-press"
              data-m-shared={m.docId}
              onClick={() => controller.openSharedMap(m.href, m.title, m.docId)}
              style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 14, minHeight: 72, padding: '0 4px', border: 0, borderBottom: '1px solid var(--mf-m-line)', background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}
            >
              <KindIcon kind={m.kind} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
                <span style={{ ...ROW_TITLE, fontWeight: m.isNew ? 800 : 700 }}>{m.title}</span>
                <span style={ROW_META}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{[KIND_META[m.kind].label, when].filter(Boolean).join(' · ')}</span>
                  <span style={{ flex: '0 0 auto', height: 18, padding: '0 6px', borderRadius: 99, background: readOnly ? 'var(--mf-m-info)' : 'var(--mf-success-soft)', color: readOnly ? 'var(--mf-m-mut)' : 'var(--mf-success-ink)', fontSize: 10.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center' }}>{readOnly ? '보기만' : '편집 가능'}</span>
                </span>
              </span>
              {m.isNew && <span aria-label="새로 공유됨" style={{ width: 7, height: 7, flex: '0 0 auto', borderRadius: 99, background: UNREAD_BADGE_BG }} />}
              <Chevron />
            </button>
          );
        })}
        {!view.sharedItems.length && <EmptyLine>공유받은 문서가 없어요.<br />누군가 초대하면 여기에 모여요.</EmptyLine>}
      </div>
    </>
  );
}

/** 즐겨찾기 — 공유받음과 같은 틀(디자인). 오른쪽 별은 해제. */
function FavPage({ view, controller, onBack }: Omit<Props, 'state'> & { onBack: () => void }) {
  return (
    <>
      <SubPageHeader back="전체" onBack={onBack} title="즐겨찾기" count={view.favItems.length} />
      <div className="mf-m-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '6px 16px 30px' }}>
        {view.favItems.map((f) => (
          <div key={f.docId || f.title} data-m-fav={f.docId || f.title} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, minHeight: 64, borderBottom: '1px solid var(--mf-m-line)' }}>
            <button type="button" className="btn mf-m-press" onClick={() => controller.openWithLoader(f.href, f.title, f.docId)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 14, alignSelf: 'stretch', padding: '0 4px', border: 0, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
              <KindIcon kind={f.kind} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
                <span style={ROW_TITLE}>{f.title}</span>
                <span style={ROW_META}>{f.isDrive ? 'Google Drive' : KIND_META[f.kind].label}</span>
              </span>
            </button>
            <button
              type="button"
              className="btn mf-m-press"
              aria-label={`'${f.title}' 즐겨찾기 해제`}
              onClick={() => controller.toggleFav(f.title, f.docId)}
              style={{ width: 40, height: 40, flex: '0 0 auto', border: 0, borderRadius: 12, background: 'transparent', color: 'var(--mf-star)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden="true">
                {M_ICON.star}
              </svg>
            </button>
          </div>
        ))}
        {!view.favItems.length && <EmptyLine>즐겨찾기한 문서가 없어요.<br />문서를 길게 눌러 고른 뒤 ⋯에서 즐겨찾기에 넣을 수 있어요.</EmptyLine>}
      </div>
    </>
  );
}

/** F2 휴지통 — 되돌리기는 늘 보인다(디자인). 남은 날짜(D-N)는 쓰지 않는다: 우리 휴지통은 시간이 지나도
 * 저절로 비워지지 않으므로 그 숫자를 적으면 사실이 아니다. 대신 **어디서 지웠는지**를 적는다. */
function TrashPage({ state, view, controller, onBack }: Props & { onBack: () => void }) {
  const spaceName = (id?: string) => state.spaces.find((s) => s.id === id)?.name ?? '';
  return (
    <>
      <SubPageHeader
        back="전체"
        onBack={onBack}
        title="휴지통"
        count={view.trashItems.length}
        action={
          view.trashItems.length > 0 ? (
            <button type="button" className="btn" data-m-trash-empty onClick={controller.askEmptyTrash} style={{ height: 40, padding: '0 12px 0 0', border: 0, background: 'transparent', color: 'var(--mf-m-danger)', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
              비우기
            </button>
          ) : undefined
        }
      />
      <span style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, margin: '0 16px', padding: '10px 14px', borderRadius: 12, background: 'var(--mf-m-info)', fontSize: 12.5, color: 'var(--mf-m-mut)' }}>
        <Glyph d={M_ICON.restore} size={13} width={2.2} />
        되돌리면 지우기 전 자리로 돌아가요
      </span>
      <div className="mf-m-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '8px 16px 30px' }}>
        {view.trashItems.map((t, i) => {
          const from = t.isDrive ? 'Google Drive' : spaceName(state.trash[i]?.spaceId);
          return (
            <div key={t.docId || t.title} data-m-trash={t.docId || t.title} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12, minHeight: 66, padding: '0 4px', borderBottom: '1px solid var(--mf-m-line)' }}>
              <Glyph d={KIND_META[t.kind].icon} size={22} stroke="var(--mf-m-faint)" />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--mf-m-ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
                <span style={{ fontSize: 12, color: 'var(--mf-m-mut2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[KIND_META[t.kind].label, from].filter(Boolean).join(' · ')}</span>
              </span>
              <button
                type="button"
                className="btn mf-m-press"
                aria-label={`'${t.title}' 되돌리기`}
                onClick={() => controller.askRestore(t.title, t.docId)}
                style={{ flex: '0 0 auto', height: 32, padding: '0 11px', border: '1px solid var(--mf-m-btn-line)', borderRadius: 99, background: 'var(--mf-m-card)', color: 'var(--mf-m-ink)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                되돌리기
              </button>
              <button
                type="button"
                className="btn mf-m-press"
                aria-label={`'${t.title}' 완전히 삭제`}
                title="완전히 삭제"
                onClick={() => controller.askPurge(t.title, t.docId)}
                style={{ width: 32, height: 32, flex: '0 0 auto', border: 0, borderRadius: 99, background: 'transparent', color: 'var(--mf-m-faint2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}
              >
                <Glyph d={M_ICON.trash} size={15} width={2.2} />
              </button>
            </div>
          );
        })}
        {!view.trashItems.length && <EmptyLine>휴지통이 비어 있어요.</EmptyLine>}
      </div>
    </>
  );
}

export function MobileMorePage({ state, view, controller }: Props) {
  const [sub, setSub] = useState<Sub>('root');
  const [orderSheet, setOrderSheet] = useState(false);
  const tools = useTools(state, controller);
  const back = () => setSub('root');

  if (sub !== 'root') {
    return (
      <div data-m-more-sub={sub} className="mf-m-page" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--mf-m-bg)' }}>
        {sub === 'shared' && <SharedPage state={state} view={view} controller={controller} onBack={back} />}
        {sub === 'fav' && <FavPage view={view} controller={controller} onBack={back} />}
        {sub === 'trash' && <TrashPage state={state} view={view} controller={controller} onBack={back} />}
      </div>
    );
  }

  const collect: Row[] = [
    { key: 'fav', label: '즐겨찾기', icon: M_ICON.star, tint: 'var(--mf-star)', count: String(view.favItems.length), onClick: () => setSub('fav') },
    { key: 'shared', label: '공유받음', icon: M_ICON.share, tint: 'var(--mf-info)', count: String(view.sharedItems.length), badge: view.sharedUnread, onClick: () => setSub('shared') },
    { key: 'trash', label: '휴지통', icon: M_ICON.trash, tint: 'var(--mf-m-mut)', count: String(view.trashItems.length), onClick: () => setSub('trash') },
  ];
  const toolRows: Row[] = [
    ...tools.screens.map((r) => ({ key: `tool-${r.key}`, label: r.label, icon: M_ICON.jira, tint: '#2684ff', count: r.name, onClick: () => controller.openTool('jira') })),
    { key: 'tools', label: '도구 관리', icon: M_ICON.tools, tint: 'var(--mf-m-mut)', onClick: controller.openToolsSettings },
  ];
  const manage: Row[] = [
    { key: 'space-order', label: '스페이스 순서', icon: M_ICON.list, tint: 'var(--mf-m-mut)', count: String(state.spaces.length), onClick: () => setOrderSheet(true) },
    { key: 'calendars', label: '보여 줄 캘린더', icon: M_ICON.cal, tint: 'var(--mf-m-mut)', onClick: controller.openGoogleCalendarSetup },
  ];
  const account: Row[] = [
    { key: 'settings', label: '설정', icon: M_ICON.gear, tint: 'var(--mf-m-mut)', onClick: controller.openAccountSettings },
    { key: 'feedback', label: '피드백 보내기', icon: M_ICON.chat, tint: 'var(--mf-m-mut)', onClick: controller.openFeedback },
    { key: 'logout', label: '로그아웃', icon: M_ICON.out, tint: 'var(--mf-m-danger)', danger: true, onClick: controller.logout },
  ];
  const build = buildLabel();

  return (
    <div data-m-more className="mf-m-page" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--mf-m-bg)' }}>
      <div className="mf-m-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '14px 0 24px' }}>
        <button
          type="button"
          className="btn mf-m-press"
          data-m-more-profile
          onClick={() => {
            controller.openAccountSettings();
            controller.openProfileDetail();
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 20px 18px', border: 0, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', flex: '0 0 auto' }}
        >
          <ProfileAvatar initial={view.userInitial} avatarUrl={state.userAvatar} size={56} radius={99} fontSize={20} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-m-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</span>
            <span style={{ fontSize: 13, color: 'var(--mf-m-mut2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userEmail || '내 워크스페이스'}</span>
          </span>
          <Chevron />
        </button>
        <Group name="모아보기" rows={collect} />
        <Group name="도구" rows={toolRows} />
        <Group name="관리" rows={manage} />
        <Group name="" rows={account} />
        <span data-m-build style={{ padding: '26px 20px 0', textAlign: 'center', fontSize: 11, color: 'var(--mf-m-faint2)' }}>
          Geurio <span style={{ fontFamily: MONO_FONT }}>{build.label}</span>
        </span>
      </div>
      <MobileSpaceSheet open={orderSheet} onClose={() => setOrderSheet(false)} state={state} controller={controller} startInReorder />
    </div>
  );
}
