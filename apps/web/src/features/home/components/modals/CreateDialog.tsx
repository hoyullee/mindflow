import type { ReactNode } from 'react';
import { Modal, MODAL_DIM, modalCard } from '../../../../components/Modal';
import { META_MONO } from '../../chrome';

/**
 * "만들기" 팝업 공용 껍데기 — 새 스페이스·새 대시보드(첨부 디자인)가 같은 꼴이다.
 *
 * 구성: [아이콘 칩][제목/설명] · [라벨 + 글자수] 입력 · 색상 원 6개 · 우측 정렬 푸터.
 * 이름 변경 팝업도 같은 껍데기를 쓴다(제목·버튼 글자만 다르다) — 색을 나중에 고칠
 * 길이 없으면 잘못 고른 색이 영구가 된다(스페이스에서 이미 그렇게 하고 있었다).
 */
interface Props {
  open: boolean;
  onClose: () => void;
  /** 접근 이름 = 보이는 제목. */
  title: string;
  subtitle: string;
  /** 코럴 라운드 사각 칩 안에 그릴 글리프(현재 색 상속 — 흰 선). */
  icon: ReactNode;
  fieldLabel: string;
  value: string;
  onChange: (v: string) => void;
  maxLen: number;
  placeholder: string;
  colors: readonly string[];
  color: string;
  onColor: (c: string) => void;
  submitLabel: string;
  onSubmit: () => void;
  cardAttrs?: Record<string, string>;
}

export function CreateDialog({ open, onClose, title, subtitle, icon, fieldLabel, value, onChange, maxLen, placeholder, colors, color, onColor, submitLabel, onSubmit, cardAttrs }: Props) {
  const canSubmit = value.trim().length > 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      label={title}
      dim={{ ...MODAL_DIM, zIndex: 140 }}
      card={modalCard(452, { borderRadius: 24, padding: '26px 28px 24px', background: 'var(--mf-card)' })}
      cardAttrs={cardAttrs}
      // 이름을 적는 중이라 막 클릭으로 버려지지 않게 — 닫기는 ✕·취소·Escape.
      dismissOnBackdrop={false}
    >
      {/* 머리 — 아이콘 칩 + 제목/설명 + 우측 ✕ */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 22 }}>
        <span
          data-dialog-icon
          aria-hidden="true"
          style={{ flexShrink: 0, width: 54, height: 54, borderRadius: 16, background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))', color: 'var(--mf-accent-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 22px -14px rgba(var(--mf-accent-rgb), .9)' }}
        >
          {icon}
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 4 }}>
          <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.02em' }}>{title}</span>
          <span style={{ fontSize: 13, color: 'var(--mf-muted)', lineHeight: 1.5 }}>{subtitle}</span>
        </span>
        <button
          type="button"
          className="btn"
          onClick={onClose}
          aria-label="닫기"
          title="닫기"
          style={{ flexShrink: 0, width: 30, height: 30, border: 'none', borderRadius: 999, background: 'transparent', color: 'var(--mf-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, marginTop: 2 }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* 이름 — 라벨 오른쪽에 글자수(등폭). 상한을 미리 알려 주면 잘려서 놀라지 않는다. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 9 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{fieldLabel}</span>
        <span data-dialog-count style={{ ...META_MONO, fontSize: 12, color: 'var(--mf-faint2)' }}>
          {value.length}/{maxLen}
        </span>
      </div>
      <input
        className="ns-input"
        value={value}
        autoFocus
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canSubmit) onSubmit();
        }}
        maxLength={maxLen}
        placeholder={placeholder}
        aria-label={fieldLabel}
        style={{ width: '100%', height: 50, border: '1.5px solid var(--mf-accent)', borderRadius: 14, background: 'var(--mf-panel)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 14.5, padding: '0 16px', outline: 'none', boxSizing: 'border-box', marginBottom: 20 }}
      />

      {/* 색상 — 고른 칸에 흰 체크 + 같은 색 링(디자인). 색은 스페이스·대시보드가 같은 여섯. */}
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 11 }}>색상</div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {colors.map((c) => {
          const sel = color === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => onColor(c)}
              aria-label={`색상 ${c}`}
              aria-pressed={sel}
              data-dialog-color={c}
              style={{ width: 38, height: 38, borderRadius: '50%', background: c, border: 'none', boxShadow: sel ? `0 0 0 2.5px var(--mf-card), 0 0 0 4.5px ${c}` : 'none', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, transition: 'box-shadow .12s ease' }}
            >
              {sel && (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 13l4.5 4.5L19 7.5" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {/* 푸터 — 우측 정렬(디자인). 비활성 '만들기'는 강조색 죽인 톤(누를 수 없음). */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
        <button className="btn" onClick={onClose} style={{ height: 46, padding: '0 26px', border: '1px solid var(--mf-border)', borderRadius: 13, background: 'var(--mf-panel)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          취소
        </button>
        <button
          className="btn"
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{ height: 46, padding: '0 32px', border: 'none', borderRadius: 13, background: canSubmit ? 'var(--mf-accent)' : 'var(--mf-accent-mute)', color: canSubmit ? 'var(--mf-accent-ink)' : 'var(--mf-faint)', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'default' }}
        >
          {submitLabel}
        </button>
      </div>
    </Modal>
  );
}

/** 스페이스 = 폴더 글리프(첨부 디자인). */
export function FolderChipIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 7.5a2 2 0 0 1 2-2h3.2l1.8 2h8a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/** 대시보드 = 격자 글리프(LNB 행·홈 카드 배지와 같은 도형). */
export function DashChipIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7.5" height="9.5" rx="1.8" />
      <rect x="13" y="3.5" width="7.5" height="5.5" rx="1.8" />
      <rect x="3.5" y="15" width="7.5" height="5.5" rx="1.8" />
      <rect x="13" y="11" width="7.5" height="9.5" rx="1.8" />
    </svg>
  );
}
