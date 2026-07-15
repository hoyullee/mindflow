import { SPACE_COLORS, type HomeState } from '../../types';
import type { HomeController } from '../../useHomeController';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/** Home.dc.html:393-413 — "새 공간 만들기" modal (name + accent color). */
export function NewSpaceModal({ state, controller }: Props) {
  const canCreate = state.newSpaceName.trim().length > 0;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: state.newSpaceOpen ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 130 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 380, background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.28)', padding: 26, animation: 'mf-fade .2s ease' }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>새 공간 만들기</div>
        <div style={{ fontSize: 13, color: '#9c8b7e', lineHeight: 1.6, marginBottom: 20 }}>주제별로 맵을 정리할 새로운 공간을 만들어요.</div>

        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>공간 이름</div>
        <input
          className="ns-input"
          value={state.newSpaceName}
          onInput={(e) => controller.onNewSpaceName((e.target as HTMLInputElement).value)}
          onKeyDown={controller.onNewSpaceKey}
          onMouseDown={(e) => e.stopPropagation()}
          maxLength={10}
          placeholder="예: 팀 프로젝트 (최대 10자)"
          aria-label="공간 이름"
          style={{ width: '100%', height: 44, border: '1px solid #ecdfd5', borderRadius: 11, background: '#faf3ee', color: '#33281f', fontFamily: 'inherit', fontSize: 14, padding: '0 13px', outline: 'none', boxSizing: 'border-box', marginBottom: 16 }}
        />

        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>색상</div>
        <div style={{ display: 'flex', gap: 9, marginBottom: 24 }}>
          {SPACE_COLORS.map((c) => {
            const sel = state.newSpaceColor === c;
            return (
              <button
                key={c}
                onClick={() => controller.pickSpaceColor(c)}
                aria-label={`색상 ${c}`}
                aria-pressed={sel}
                style={{ width: 30, height: 30, borderRadius: '50%', background: c, border: sel ? '2px solid #33281f' : '2px solid #fff', boxShadow: sel ? `0 0 0 2px ${c}` : '0 0 0 1px #ecdfd5', cursor: 'pointer', padding: 0 }}
              />
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={controller.closeNewSpace} style={{ flex: 1, height: 44, border: '1px solid #ecdfd5', borderRadius: 11, background: '#fff', color: '#33281f', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            취소
          </button>
          <button
            className="btn"
            onClick={controller.createSpace}
            style={{ flex: 1, height: 44, border: 'none', borderRadius: 11, background: canCreate ? '#f0663f' : '#e7d6ca', color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: canCreate ? 'pointer' : 'default' }}
          >
            만들기
          </button>
        </div>
      </div>
    </div>
  );
}
