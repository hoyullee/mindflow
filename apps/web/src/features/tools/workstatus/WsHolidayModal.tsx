import { useState } from 'react';
import { Modal } from '../../../components/Modal';
import { Switch } from '../../../components/Switch';
import { DateButton } from '../../home/calendar/DatePop';
import { HOLIDAY_COUNTRY_KEYS, HOLIDAY_COUNTRY_LABEL, type CompanyHoliday, type HolidayRepeat, type WorkStatusPrefs } from '../toolPrefs';
import { DOW, dowOf, monthBiz, publicHolidaysFrom, shortDate } from './model';
import { bizBreakdown } from './WsStats';
import { MONO, Seg } from './wsUi';
import { HOLIDAY_YEARS } from './holidays';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { MobileSheet } from '../../home/mobile/parts';

const RPT: Record<HolidayRepeat, string> = { none: '', yearly: '매년', monthly: '매월', weekly: '매주' };

/**
 * 휴일 · 영업일(스펙 §10) — 진행 일수 계산에서 뺄 날을 정한다. **내 설정**이다(개인 단위 —
 * 결정 2026-09-30). 공휴일은 앱이 직접 들고 있는 표에서 온다(구글 연동과 무관).
 */
export function WsHolidayModal({ open, onClose, prefs, onChange, y, m, onToast }: { open: boolean; onClose: () => void; prefs: WorkStatusPrefs; onChange: (fn: (w: WorkStatusPrefs) => WorkStatusPrefs) => void; y: number; m: number; onToast: (msg: string) => void }) {
  const [d, setD] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [repeat, setRepeat] = useState<HolidayRepeat>('none');
  const [addOpen, setAddOpen] = useState(false);
  const mobile = useIsMobile();
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const list = publicHolidaysFrom(monthStart, prefs.country, 8);
  const biz = monthBiz(y, m, prefs);
  const add = () => {
    if (!d || !name.trim()) {
      onToast('날짜와 이름을 채워 주세요');
      return;
    }
    const h: CompanyHoliday = { d, name: name.trim().slice(0, 40), repeat };
    onChange((w) => ({ ...w, company: [...w.company, h] }));
    onToast(repeat === 'none' ? '휴일을 추가했어요' : `휴일을 추가했어요 · ${RPT[repeat]} 반복`);
    setD(null);
    setName('');
    setRepeat('none');
    setAddOpen(false);
  };
  const toggleException = (day: string) => onChange((w) => ({ ...w, exceptions: w.exceptions.includes(day) ? w.exceptions.filter((x) => x !== day) : [...w.exceptions, day] }));
  const removeCompany = (h: CompanyHoliday) => onChange((w) => ({ ...w, company: w.company.filter((x) => x !== h) }));
  const company = [...prefs.company].sort((a, b) => a.d.localeCompare(b.d));

  if (mobile) {
    /**
     * **폰 판**(모바일 디자인 W6) — 가운데 대화상자 대신 **밀어 들어가는 화면**이다. 520px 판을 폰에 띄우면 위아래가
     * 화면에 붙고 공휴일 목록·추가 칸이 한 판 안에서 굴러 어디까지 왔는지 알 수 없었다. 같은 설정을 카드 셋으로 나누고,
     * 휴일 추가(날짜 · 이름 · 반복)는 바닥 시트로 뺐다 — 세 칸이 한 줄에 들어가지 않는다.
     */
    const card = { borderRadius: 16, background: 'var(--mf-ws-card)', border: '1px solid var(--mf-ws-line2)', overflow: 'hidden' } as const;
    const label = { padding: '18px 4px 8px', fontSize: 12.5, fontWeight: 800, color: 'var(--mf-ws-ink)' } as const;
    const mrow = { display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: '0 14px' } as const;
    return (
      <Modal
        open={open}
        onClose={onClose}
        label="휴일 · 영업일"
        dim={{ zIndex: 150, alignItems: 'stretch', background: 'var(--mf-ws-bg)' }}
        card={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--mf-ws-bg)', boxSizing: 'border-box', outline: 'none' }}
        cardClass="mf-m-page"
        cardAttrs={{ 'data-ws-holiday': '', 'data-ws-holiday-mobile': '' }}
      >
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 4, height: 52, padding: '0 8px', paddingTop: 'env(safe-area-inset-top)' }}>
          <button type="button" className="btn" data-ws-holiday-back aria-label="작업 현황으로 돌아가기" onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 40, padding: '0 8px', border: 0, borderRadius: 12, background: 'transparent', color: 'var(--mf-ws-mut)', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
            작업 현황
          </button>
          <span style={{ marginLeft: 8, fontSize: 16, fontWeight: 800, color: 'var(--mf-ws-ink)', whiteSpace: 'nowrap' }}>휴일 · 영업일</span>
        </div>
        <div className="mf-m-scroll" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0 16px max(28px, env(safe-area-inset-bottom))' }}>
          <div style={{ padding: '4px 4px 12px', fontSize: 12, color: 'var(--mf-ws-faint)' }}>진행 일수 계산에서 빼는 날을 정해요 · 내 설정</div>
          <div style={card}>
            <div style={{ padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span>
                <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--mf-ws-ink)' }}>공휴일 국가</span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: 'var(--mf-ws-mut2)' }}>구글 연동과 상관없이 앱이 직접 가져와요</span>
              </span>
              <Seg stretch items={HOLIDAY_COUNTRY_KEYS.map((k) => [k, HOLIDAY_COUNTRY_LABEL[k]] as [typeof k, string])} value={prefs.country} onChange={(c) => onChange((w) => ({ ...w, country: c, exceptions: [] }))} height={34} font={13} pad={10} label="공휴일 국가" />
            </div>
            <div style={{ ...mrow, minHeight: 62, borderTop: '1px solid var(--mf-ws-line)' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--mf-ws-ink)' }}>주말도 영업일로 계산</span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: 'var(--mf-ws-mut2)' }}>교대·주말 근무 팀일 때만</span>
              </span>
              <Switch checked={prefs.weekend} onCheckedChange={() => onChange((w) => ({ ...w, weekend: !w.weekend }))} label="주말도 영업일로 계산" accent="#E85E33" track="#DDD3C8" knob="#FFFFFF" />
            </div>
          </div>

          <div style={label}>
            {m}월 이후 공휴일 <span style={{ fontWeight: 600, color: 'var(--mf-ws-faint)' }}>· {HOLIDAY_COUNTRY_LABEL[prefs.country]}</span>
          </div>
          <div style={card}>
            {list.map((h, i) => {
              const ex = prefs.exceptions.includes(h.d);
              return (
                <div key={h.d} data-ws-public={h.d} style={{ ...mrow, borderTop: i ? '1px solid var(--mf-ws-line)' : 0 }}>
                  <span style={{ width: 52, flexShrink: 0, fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: ex ? 'var(--mf-ws-faint)' : '#C4614C', textDecoration: ex ? 'line-through' : 'none' }}>{shortDate(h.d)}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: ex ? 'var(--mf-ws-faint)' : 'var(--mf-ws-ink)', textDecoration: ex ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
                  <button type="button" className="btn" onClick={() => toggleException(h.d)} style={{ height: 30, padding: '0 11px', flexShrink: 0, borderRadius: 999, border: `1px solid ${ex ? '#E7C7B4' : 'var(--mf-ws-chip-line)'}`, background: ex ? '#FBEDE6' : 'var(--mf-ws-card)', color: ex ? '#C0563A' : 'var(--mf-ws-ink2)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {ex ? '휴일로 되돌리기' : '근무일로 처리'}
                  </button>
                </div>
              );
            })}
            {!list.length && <div style={{ padding: 14, fontSize: 12.5, color: 'var(--mf-ws-faint)' }}>{HOLIDAY_YEARS.to}년까지의 공휴일만 들고 있어요 · 필요하면 아래에 추가 휴일로 적어 주세요</div>}
          </div>

          <div style={label}>추가 휴일 등록</div>
          <div style={card}>
            {company.map((h, i) => (
              <div key={`${h.d}-${h.name}-${i}`} data-ws-company={h.d} style={{ ...mrow, borderBottom: '1px solid var(--mf-ws-line)' }}>
                <span style={{ width: 52, flexShrink: 0, fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: '#C4614C' }}>{shortDate(h.d)}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
                {h.repeat !== 'none' && <span style={{ flexShrink: 0, height: 20, padding: '0 8px', borderRadius: 999, background: 'var(--mf-ws-soft)', color: 'var(--mf-ws-mut)', fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center' }}>{RPT[h.repeat]}</span>}
                <button type="button" className="btn" aria-label={`${h.name} 지우기`} onClick={() => removeCompany(h)} style={{ width: 36, height: 36, flexShrink: 0, border: 0, borderRadius: 10, background: 'transparent', color: 'var(--mf-ws-faint)', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ))}
            <button type="button" className="btn" data-ws-company-open onClick={() => setAddOpen(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', height: 50, border: 0, background: 'transparent', color: 'var(--mf-ws-ink)', fontFamily: 'inherit', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              휴일 추가
            </button>
          </div>

          <div data-ws-holiday-foot style={{ ...card, marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--mf-ws-mut)' }}>{m}월 영업일</span>
              <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: 'var(--mf-ws-faint)' }}>{bizBreakdown(biz)}</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: 28, fontWeight: 700, letterSpacing: '-.04em', color: '#D8794F' }}>
              {biz.biz.length}
              <span style={{ fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--mf-ws-mut)', marginLeft: 3 }}>일</span>
            </span>
          </div>
        </div>

        <MobileSheet open={addOpen} onClose={() => setAddOpen(false)} label="휴일 추가" zIndex={170} attrs={{ 'data-ws-company-sheet': '' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 20px 6px' }}>
            <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--mf-ws-ink)' }}>휴일 추가</span>
            <DateButton label="휴일 날짜" value={d ?? undefined} clearable={false} height={44} attrs={{ 'data-ws-company-date': '' }} onPick={(iso) => setD(iso)} />
            <input
              data-ws-company-name
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="휴일 이름 (예: 창립기념일)"
              aria-label="휴일 이름"
              maxLength={40}
              enterKeyHint="done"
              style={{ height: 44, padding: '0 14px', borderRadius: 12, border: '1px solid var(--mf-ws-line2)', background: 'var(--mf-ws-card)', color: 'var(--mf-ws-ink)', fontFamily: 'inherit', fontSize: 16, outline: 'none', boxSizing: 'border-box' }}
            />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-ws-mut)' }}>반복</span>
              <Seg stretch items={[['none', '반복 없음'], ['yearly', '매년'], ['monthly', '매월'], ['weekly', '매주']]} value={repeat} onChange={setRepeat} height={32} font={12.5} pad={6} label="반복" />
            </span>
            <button type="button" className="btn" data-ws-company-add onClick={add} style={{ height: 48, marginTop: 4, border: 0, borderRadius: 14, background: 'var(--mf-m-ink)', color: 'var(--mf-m-card)', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
              추가
            </button>
          </div>
        </MobileSheet>
      </Modal>
    );
  }

  const row = { display: 'flex', alignItems: 'center', gap: 12, minHeight: 58, borderBottom: '1px solid var(--mf-hairline)' } as const;
  return (
    <Modal
      open={open}
      onClose={onClose}
      label="휴일 · 영업일"
      dim={{ zIndex: 90, background: 'rgba(58,52,46,.32)', backdropFilter: 'blur(5px)', padding: 16 }}
      card={{ width: 520, maxWidth: '100%', maxHeight: 'calc(var(--mf-app-h) - 32px)', overflowY: 'auto', background: 'var(--mf-ws-card)', border: '1px solid var(--mf-border)', borderRadius: 24, boxShadow: '0 44px 90px -40px rgba(46,42,38,.6)', animation: 'mf-fade .2s ease', boxSizing: 'border-box' }}
      cardClass="lnb-scroll"
      cardAttrs={{ 'data-ws-holiday': '' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '18px 22px 8px' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-ws-ink)' }}>휴일 · 영업일</div>
          <div style={{ fontSize: 11.5, color: 'var(--mf-ws-faint)', marginTop: 3 }}>진행 일수 계산에서 빼는 날을 정해요 · 내 설정</div>
        </div>
        <button type="button" className="btn mf-ws-x" aria-label="닫기" onClick={onClose} style={{ marginLeft: 'auto', width: 32, height: 32, flexShrink: 0, border: 0, borderRadius: 11, background: '#FBF3EE', color: 'var(--mf-ws-ink2)', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div style={{ padding: '6px 22px 18px' }}>
        <div style={row}>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--mf-ws-ink)' }}>공휴일 국가</div>
            <div style={{ fontSize: 11.5, color: 'var(--mf-ws-mut2)', marginTop: 2 }}>구글 연동과 상관없이 앱이 직접 가져와요</div>
          </div>
          <Seg items={HOLIDAY_COUNTRY_KEYS.map((k) => [k, HOLIDAY_COUNTRY_LABEL[k]] as [typeof k, string])} value={prefs.country} onChange={(c) => onChange((w) => ({ ...w, country: c, exceptions: [] }))} height={28} font={12} pad={12} label="공휴일 국가" />
        </div>
        <div style={row}>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--mf-ws-ink)' }}>주말도 영업일로 계산</div>
            <div style={{ fontSize: 11.5, color: 'var(--mf-ws-mut2)', marginTop: 2 }}>교대·주말 근무 팀일 때만</div>
          </div>
          <Switch checked={prefs.weekend} onCheckedChange={() => onChange((w) => ({ ...w, weekend: !w.weekend }))} label="주말도 영업일로 계산" accent="#E85E33" track="#DDD3C8" knob="#FFFFFF" />
        </div>

        <div style={{ padding: '14px 0 8px', fontSize: 12.5, fontWeight: 800, color: 'var(--mf-ws-ink)' }}>
          {m}월 이후 공휴일 <span style={{ fontWeight: 600, color: 'var(--mf-ws-faint)' }}>· {HOLIDAY_COUNTRY_LABEL[prefs.country]}</span>
        </div>
        <div style={{ borderRadius: 12, border: '1px solid var(--mf-ws-chip-line)', overflow: 'hidden' }}>
          {list.map((h, i) => {
            const ex = prefs.exceptions.includes(h.d);
            return (
              <div key={h.d} data-ws-public={h.d} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i ? '1px solid var(--mf-hairline)' : 0 }}>
                <span style={{ width: 88, flexShrink: 0, fontFamily: MONO, fontSize: 12, fontWeight: 700, color: ex ? 'var(--mf-ws-faint)' : '#C4614C', textDecoration: ex ? 'line-through' : 'none' }}>
                  {shortDate(h.d)} ({DOW[dowOf(h.d)]})
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: ex ? 'var(--mf-ws-faint)' : 'var(--mf-ws-ink)', textDecoration: ex ? 'line-through' : 'none', minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => onChange((w) => ({ ...w, exceptions: ex ? w.exceptions.filter((x) => x !== h.d) : [...w.exceptions, h.d] }))}
                  style={{ height: 24, padding: '0 9px', flexShrink: 0, borderRadius: 999, border: `1px solid ${ex ? '#E7C7B4' : 'var(--mf-ws-chip-line)'}`, background: ex ? '#FBEDE6' : 'var(--mf-ws-card)', color: ex ? '#C0563A' : 'var(--mf-ws-ink2)', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                >
                  {ex ? '휴일로 되돌리기' : '근무일로 처리'}
                </button>
              </div>
            );
          })}
          {!list.length && <div style={{ padding: 12, fontSize: 12, color: 'var(--mf-ws-faint)' }}>{HOLIDAY_YEARS.to}년까지의 공휴일만 들고 있어요 · 필요하면 아래에 추가 휴일로 적어 주세요</div>}
        </div>

        <div style={{ padding: '16px 0 8px', fontSize: 12.5, fontWeight: 800, color: 'var(--mf-ws-ink)' }}>추가 휴일 등록</div>
        <div style={{ borderRadius: 12, border: '1px solid var(--mf-ws-chip-line)', overflow: 'hidden' }}>
          {[...prefs.company]
            .sort((a, b) => a.d.localeCompare(b.d))
            .map((h, i) => (
              <div key={`${h.d}-${h.name}-${i}`} data-ws-company={h.d} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--mf-hairline)' }}>
                <span style={{ width: 88, flexShrink: 0, fontFamily: MONO, fontSize: 12, fontWeight: 700, color: '#C4614C' }}>
                  {shortDate(h.d)} ({DOW[dowOf(h.d)]})
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mf-ws-ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
                {h.repeat !== 'none' && (
                  <span style={{ height: 17, padding: '0 6px', borderRadius: 999, background: '#F3EEE8', color: '#8A8078', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" />
                    </svg>
                    {RPT[h.repeat]}
                  </span>
                )}
                <button type="button" className="btn mf-ws-trash" aria-label={`${h.name} 지우기`} onClick={() => onChange((w) => ({ ...w, company: w.company.filter((x) => x !== h) }))} style={{ marginLeft: 'auto', width: 28, height: 28, flexShrink: 0, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--mf-ws-faint)', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ))}
          <div style={{ padding: '10px 12px', background: 'var(--mf-ws-sunk)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <DateButton label="휴일 날짜" value={d ?? undefined} clearable={false} height={30} attrs={{ 'data-ws-company-date': '' }} onPick={(iso) => setD(iso)} />
              <input
                data-ws-company-name
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') add();
                }}
                placeholder="휴일 이름"
                aria-label="휴일 이름"
                maxLength={40}
                style={{ flex: '1 1 auto', minWidth: 0, height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--mf-ws-line2)', background: 'var(--mf-ws-card)', color: 'var(--mf-ws-ink)', fontFamily: 'inherit', fontSize: 12.5, outline: 'none', boxSizing: 'border-box' }}
              />
              <button type="button" className="btn" data-ws-company-add onClick={add} style={{ height: 30, padding: '0 14px', flexShrink: 0, border: 0, borderRadius: 999, background: '#3A352F', color: '#FFFDFB', fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                추가
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mf-ws-mut)' }}>반복</span>
              <Seg items={[['none', '반복 없음'], ['yearly', '매년'], ['monthly', '매월'], ['weekly', '매주']]} value={repeat} onChange={setRepeat} height={22} font={11} pad={9} label="반복" />
            </div>
          </div>
        </div>
        <div data-ws-holiday-foot style={{ marginTop: 14, fontSize: 12, color: 'var(--mf-ws-mut)' }}>
          {m}월 영업일: <b style={{ color: 'var(--mf-ws-ink)' }}>{biz.biz.length}일</b> — {bizBreakdown(biz)}
        </div>
      </div>
    </Modal>
  );
}
