import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import './tools.css';
import { TOOL_DEFS, type ToolKey } from './toolDefs';
import { TOOL_LABEL_MAX } from './toolPrefs';

/** 도구 아이콘 — 브랜드 색의 둥근 네모에 머리글자 하나(도구 스펙 §2). */
export function ToolIcon({ tool, size, radius, font }: { tool: ToolKey; size: number; radius: number; font: number }) {
  const i = TOOL_DEFS[tool].icon;
  return (
    <span
      aria-hidden="true"
      data-tool-icon={tool}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: i.bg,
        color: i.fg,
        border: i.border ? `1px solid ${i.border}` : undefined,
        boxSizing: 'border-box',
        fontSize: font,
        fontWeight: 800,
        lineHeight: 1,
      }}
    >
      {i.text}
    </span>
  );
}

/**
 * 연결 해제 — **두 번 눌러야** 실행된다(도구 스펙 §4.3). 첫 클릭은 `정말 해제`로 바뀌고,
 * 바깥을 누르면 1단계로 돌아온다.
 */
export function DisconnectButton({ onConfirm, height, pad, font, weight }: { onConfirm: () => void; height: number; pad: number; font: number; weight: number }) {
  const [armed, setArmed] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!armed) return;
    const off = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setArmed(false);
    };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  }, [armed]);
  return (
    <button
      ref={ref}
      type="button"
      className="btn"
      data-tool-disconnect={armed ? 'armed' : ''}
      onClick={(e) => {
        e.stopPropagation();
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
      onBlur={() => setArmed(false)}
      style={{
        flexShrink: 0,
        height,
        padding: `0 ${pad}px`,
        borderRadius: 999,
        border: `1px solid ${armed ? '#E8C9B4' : 'var(--mf-border)'}`,
        background: armed ? '#FBEDE6' : 'var(--mf-card)',
        color: armed ? '#C0563A' : 'var(--mf-subtext)',
        fontFamily: 'inherit',
        fontSize: font,
        fontWeight: weight,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {armed ? '정말 해제' : '연결 해제'}
    </button>
  );
}

/** 연결 버튼 — 어두운 알약, hover는 강조색(§4.3). 연결 중이면 스피너. */
export function ConnectButton({ busy, onClick, height, pad, font, attrs }: { busy: boolean; onClick: () => void; height: number; pad: number; font: number; attrs?: Record<string, string> }) {
  return (
    <button
      type="button"
      className="btn mf-tool-connect"
      disabled={busy}
      aria-busy={busy || undefined}
      {...attrs}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ flexShrink: 0, height, minWidth: height + 16, padding: `0 ${pad}px`, borderRadius: 999, border: 0, fontFamily: 'inherit', fontSize: font, fontWeight: 800, cursor: busy ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {busy ? <span className="mf-tool-spin" aria-label="연결 중" /> : '연결'}
    </button>
  );
}

/**
 * `왼쪽 목록 이름 **{label}** ✎` — 누르면 그 자리에서 입력이 된다(§4.3).
 * Enter·blur 저장 / Esc 취소 / 빈 값은 기본 이름.
 */
export function LabelEditor({ label, onSave, font, inputStyle, extra }: { label: string; onSave: (v: string) => void; font: number; inputStyle: CSSProperties; extra?: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const done = useRef(false);
  if (editing) {
    const commit = () => {
      if (done.current) return;
      done.current = true;
      setEditing(false);
      onSave(draft);
    };
    const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done.current = true;
        setEditing(false);
      }
    };
    return (
      <input
        autoFocus
        data-tool-label-input
        aria-label="왼쪽 목록 이름"
        value={draft}
        maxLength={TOOL_LABEL_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={onKey}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        style={{ boxSizing: 'border-box', border: '1px solid #E8A25F', borderRadius: 7, background: 'var(--mf-card)', color: 'var(--mf-text)', fontFamily: 'inherit', fontWeight: 700, outline: 'none', ...inputStyle }}
      />
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0, fontSize: font, color: 'var(--mf-muted)' }}>
      <button
        type="button"
        className="btn mf-tool-label"
        data-tool-label
        onClick={(e) => {
          e.stopPropagation();
          done.current = false;
          setDraft(label);
          setEditing(true);
        }}
        title="왼쪽 목록 이름 바꾸기"
        style={{ border: 0, background: 'transparent', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}
      >
        왼쪽 목록 이름 <b style={{ fontWeight: 800 }}>{label}</b> ✎
      </button>
      {extra}
    </span>
  );
}

// ── 토스트(§11 — 바닥 가운데 알약, 2.2초) ─────────────────────────────

let toastMsg = '';
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const toastListeners = new Set<() => void>();

export function toolToast(msg: string): void {
  toastMsg = msg;
  toastListeners.forEach((l) => l());
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMsg = '';
    toastListeners.forEach((l) => l());
  }, 2200);
}

export function ToolToastHost() {
  const msg = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toastMsg,
    () => '',
  );
  if (!msg) return null;
  return (
    <div
      role="status"
      data-tool-toast
      style={{ position: 'fixed', left: '50%', bottom: 26, transform: 'translateX(-50%)', zIndex: 120, background: '#3A352F', color: '#FFFFFF', fontSize: 13, fontWeight: 700, borderRadius: 999, padding: '10px 16px', maxWidth: 'calc(100vw - 32px)', boxShadow: '0 12px 28px -12px rgba(46,42,38,.55)', animation: 'mf-fade .16s ease', pointerEvents: 'none' }}
    >
      {msg}
    </div>
  );
}
