// 공책 기록 — **무엇이 바뀌었나를 한 줄로**(기록 패널 스펙 §2·§5.3).
//
// 저장이 성공할 때마다 페이지의 직전 판과 지금 판을 비교해 항목 하나(종류·요약·문구 diff·
// 강조할 블록)를 만든다. 순수 함수만 둔다 — 저장소(`NoteHistoryStore`)와 화면(`NoteHistoryPanel`)은
// 이 결과를 싣고 그릴 뿐이다.
//
// 스펙은 diff를 서버가 계산한다고 적었다. 우리는 서버에 **전·후 글**만 싣고 칠하기(글자 단위
// 비교)는 화면이 한다 — 같은 결과이고 Edge Function을 하나 덜 둔다.

import type { NoteBlock, NotePage } from '@mindflow/mindmap-core';
import { blockText } from '@mindflow/mindmap-core';
import type { NoteHistoryEntry, NoteHistoryKind } from '../../adapters/ports';

export interface PageChange {
  kind: NoteHistoryKind;
  summary: string;
  diff: { before: string; after: string } | null;
  anchor: string | null;
  /** 바뀐 블록들 — 묶음 판정과 미리보기의 테두리가 쓴다. */
  touched: string[];
}

/** 묶음 창 — 같은 사람이 같은 블록을 이 안에 연속으로 고치면 항목 하나다(스펙 §2). */
export const MERGE_WINDOW_MS = 2 * 60_000;

const sig = (b: NoteBlock): string => JSON.stringify(b);

/** 받침이 있으면 `받침`, 없으면 `없음`(ㄹ 받침은 `로` 쪽 — `으로/로`에만 쓴다). */
function particle(word: string, withBatchim: string, without: string, rieulAsNone = false): string {
  // 따옴표·말줄임표는 건너뛰고 마지막 **글자**를 본다(`'결정'` → `정`).
  const ch = word.replace(/[^\p{L}\p{N}]+$/u, '').slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return /[0-9]$/.test(ch) ? (/[013678]$/.test(ch) ? withBatchim : without) : without;
  const jong = code % 28;
  if (!jong) return without;
  if (rieulAsNone && jong === 8) return without;
  return withBatchim;
}
const ro = (w: string): string => `${w}${particle(w, '으로', '로', true)}`;
const gwa = (w: string): string => `${w}${particle(w, '과', '와')}`;

/** 따옴표 안에 넣을 짧은 글 — 18자를 넘으면 자른다. */
function quote(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return `'${t.length > 18 ? `${t.slice(0, 18)}…` : t}'`;
}

const HEADING = new Set(['h1', 'h2', 'h3']);
const LIST = new Set(['ul', 'ol']);

/** 블록 한 덩이를 가리키는 말 — `'결정한 것' 소제목` · `본문 첫 문단` · `체크리스트`… */
function blockRef(block: NoteBlock, page: NotePage): string {
  const text = blockText(block);
  if (HEADING.has(block.kind)) return text.trim() ? `${quote(text)} 소제목` : '소제목';
  switch (block.kind) {
    case 'p': {
      const paras = page.blocks.filter((b) => b.kind === 'p');
      const i = paras.findIndex((b) => b.id === block.id);
      return i <= 0 ? '본문 첫 문단' : `본문 ${i + 1}번째 문단`;
    }
    case 'ul':
    case 'ol':
      return '목록';
    case 'ck':
      return '체크리스트';
    case 'q':
      return '인용';
    case 'code':
      return '코드 블록';
    case 'callout':
      return '콜아웃';
    case 'toggle':
      return text.trim() ? `${quote(text.split('\n')[0] ?? '')} 접기` : '접기';
    case 'table': {
      const first = (block.rows?.[0]?.[0] ?? []).map((r) => r.t).join('').trim();
      return first ? `${quote(first)} 표` : '표';
    }
    case 'img':
      return '그림';
    case 'link':
      return '보드 링크';
    case 'sched':
      return '일정 블록';
    case 'video':
      return '동영상';
    case 'file':
      return block.fileName ? `${quote(block.fileName)} 파일` : '첨부 파일';
    case 'hr':
      return '구분선';
    default:
      return '블록';
  }
}

/** 더하거나 지운 블록들을 한 구절로 — `'결정한 것' 소제목과 체크리스트 3개`. */
function phraseOf(blocks: NoteBlock[]): string {
  const parts: string[] = [];
  const count = new Map<string, number>();
  for (const b of blocks) {
    if (HEADING.has(b.kind)) {
      parts.push(blockRef(b, { id: '', title: '', blocks: [] }));
      continue;
    }
    const name =
      b.kind === 'ck'
        ? '체크리스트'
        : LIST.has(b.kind)
          ? '목록'
          : b.kind === 'p'
            ? '문단'
            : b.kind === 'table'
              ? '표'
              : b.kind === 'img'
                ? '그림'
                : b.kind === 'code'
                  ? '코드 블록'
                  : b.kind === 'q'
                    ? '인용'
                    : b.kind === 'callout'
                      ? '콜아웃'
                      : b.kind === 'toggle'
                        ? '접기'
                        : b.kind === 'hr'
                          ? '구분선'
                          : b.kind === 'link'
                            ? '보드 링크'
                            : b.kind === 'sched'
                              ? '일정 블록'
                              : b.kind === 'video'
                                ? '동영상'
                                : b.kind === 'file'
                                  ? '첨부 파일'
                                  : '블록';
    // 체크리스트는 **항목 수**로 센다 — "체크리스트 3개"는 할 일 셋이다(스펙의 예).
    const n = b.kind === 'ck' ? Math.max(1, b.items?.length ?? 1) : 1;
    count.set(name, (count.get(name) ?? 0) + n);
  }
  for (const [name, n] of count) parts.push(`${name} ${n}개`);
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${gwa(parts[0]!)} ${parts[1]}`;
  return `${parts[0]}, ${parts[1]} 외 ${parts.length - 2}가지`;
}

/** 체크리스트의 완료 표시만 바뀌었나 — 바뀐 수를 센다(`+`면 완료로, `-`면 해제). */
function checkDelta(a: NoteBlock, b: NoteBlock): { done: number; undone: number } | null {
  if (a.kind !== 'ck' || b.kind !== 'ck') return null;
  const ai = a.items ?? [];
  const bi = b.items ?? [];
  if (ai.length !== bi.length) return null;
  let done = 0;
  let undone = 0;
  for (let i = 0; i < ai.length; i += 1) {
    const x = ai[i]!;
    const y = bi[i]!;
    if (x.id !== y.id || JSON.stringify(x.runs) !== JSON.stringify(y.runs) || (x.indent ?? 0) !== (y.indent ?? 0)) return null;
    if (!x.done && y.done) done += 1;
    if (x.done && !y.done) undone += 1;
  }
  return done || undone ? { done, undone } : null;
}

function tableChange(a: NoteBlock, b: NoteBlock, page: NotePage): string {
  const ref = blockRef(b, page);
  const ar = a.rows ?? [];
  const br = b.rows ?? [];
  const ac = ar[0]?.length ?? 0;
  const bc = br[0]?.length ?? 0;
  if (br.length > ar.length) return `${ref}에 행 추가`;
  if (br.length < ar.length) return `${ref}에서 행 지움`;
  if (bc > ac) return `${ref}에 열 추가`;
  if (bc < ac) return `${ref}에서 열 지움`;
  return `${ref} 내용 수정`;
}

/**
 * 직전 판(`prev`) → 지금 판(`next`)의 변화 한 줄. 바뀐 것이 없으면 `null`.
 *
 * 문구 규칙(스펙 §5.3): **동사로 끝내고 대상은 작은따옴표**. 섞인 변화는 가장 큰 것 둘까지
 * ` · `로 잇는다.
 */
export function describePageChange(prev: NotePage | null, next: NotePage): PageChange | null {
  if (!prev) return { kind: 'create', summary: '페이지 만듦', diff: null, anchor: null, touched: [] };
  const before = new Map(prev.blocks.map((b) => [b.id, b]));
  const after = new Map(next.blocks.map((b) => [b.id, b]));
  const added = next.blocks.filter((b) => !before.has(b.id));
  const removed = prev.blocks.filter((b) => !after.has(b.id));
  const changed = next.blocks.filter((b) => before.has(b.id) && sig(before.get(b.id)!) !== sig(b));
  const commonPrev = prev.blocks.filter((b) => after.has(b.id)).map((b) => b.id);
  const commonNext = next.blocks.filter((b) => before.has(b.id)).map((b) => b.id);
  const moved = commonPrev.join(',') !== commonNext.join(',');
  const titled = (prev.title ?? '') !== (next.title ?? '');
  const tagged = (prev.tag ?? null) !== (next.tag ?? null);
  const touched = [...added, ...changed].map((b) => b.id).concat(removed.map((b) => b.id));

  if (!added.length && !removed.length && !changed.length && !moved) {
    if (titled) {
      const t = next.title.trim();
      return { kind: 'rename', summary: t ? `페이지 이름을 ${ro(quote(t))} 바꿈` : '페이지 이름을 지움', diff: { before: prev.title ?? '', after: next.title ?? '' }, anchor: null, touched: [] };
    }
    if (tagged) {
      const t = (next.tag ?? '').trim();
      return { kind: 'tag', summary: t ? `태그를 ${ro(quote(t))} 바꿈` : '태그를 뺌', diff: null, anchor: null, touched: [] };
    }
    return null;
  }

  // 한 블록만 고쳤다 — 가장 흔한 경우. 종류에 맞는 말로 적는다.
  if (!added.length && !removed.length && changed.length === 1 && !moved) {
    const b = changed[0]!;
    const a = before.get(b.id)!;
    const ck = checkDelta(a, b);
    if (ck) {
      const summary = ck.done && !ck.undone ? `체크리스트 ${ck.done}개 완료로 표시` : !ck.done ? `체크리스트 ${ck.undone}개 완료 해제` : `체크리스트 ${ck.done + ck.undone}개 완료 표시 바꿈`;
      return { kind: 'checklist', summary, diff: null, anchor: b.id, touched };
    }
    if (a.kind === 'table' && b.kind === 'table') {
      const ta = blockText(a);
      const tb = blockText(b);
      const shape = (a.rows?.length ?? 0) !== (b.rows?.length ?? 0) || (a.rows?.[0]?.length ?? 0) !== (b.rows?.[0]?.length ?? 0);
      return { kind: 'table', summary: tableChange(a, b, next), diff: !shape && ta !== tb ? { before: ta, after: tb } : null, anchor: b.id, touched };
    }
    const ta = blockText(a);
    const tb = blockText(b);
    if (ta !== tb) return { kind: 'edit', summary: `${blockRef(b, next)} 문구 수정`, diff: { before: ta, after: tb }, anchor: b.id, touched };
    if (a.kind !== b.kind) return { kind: 'edit', summary: `${blockRef(a, prev)}${particle(blockRef(a, prev), '을', '를')} ${blockRef(b, next).replace(/^'[^']*' /, '')}${particle(blockRef(b, next), '으로', '로', true)} 바꿈`, diff: null, anchor: b.id, touched };
    return { kind: 'edit', summary: `${blockRef(b, next)} 모양 바꿈`, diff: null, anchor: b.id, touched };
  }

  const phrases: string[] = [];
  let kind: NoteHistoryKind = 'edit';
  if (added.length) {
    phrases.push(`${phraseOf(added)} 추가`);
    kind = 'insert';
  }
  if (removed.length) {
    phrases.push(`${phraseOf(removed)} 지움`);
    if (!added.length) kind = 'delete';
  }
  if (changed.length) phrases.push(changed.length === 1 ? `${blockRef(changed[0]!, next)} 수정` : `블록 ${changed.length}개 수정`);
  if (moved && !added.length && !removed.length) {
    phrases.push('블록 순서 바꿈');
    if (!changed.length) kind = 'move';
  }
  const anchor = (added[0] ?? changed[0])?.id ?? null;
  // 새로 넣은 한 블록에 글을 쓴 경우 — 「문단 1개 추가」만으로는 무엇을 썼는지 모른다. 글을 diff로 보인다.
  const one = added.length === 1 && !removed.length && !changed.length ? blockText(added[0]!) : '';
  return { kind, summary: phrases.slice(0, 2).join(' · '), diff: one.trim() ? { before: '', after: one } : null, anchor, touched };
}

/**
 * 이번 변화가 **열려 있는 묶음**에 합쳐지나(스펙 §2).
 *
 * 같은 사람 · 창(2분) 안 · 되돌리기가 아님 · 이번에 건드린 블록이 묶음이 가리키는 **그 블록
 * 하나**일 때만. 다른 블록으로 옮겨 가면 새 항목이다.
 */
export function canMerge(run: { actorId: string; lastAt: number; anchor: string | null; kind: NoteHistoryKind } | null, actorId: string, now: number, delta: PageChange): boolean {
  if (!run || run.actorId !== actorId) return false;
  if (now - run.lastAt >= MERGE_WINDOW_MS) return false;
  if (run.kind === 'restore' || run.kind === 'create' || delta.kind === 'restore') return false;
  if (!run.anchor) return false;
  return delta.touched.length === 1 && delta.touched[0] === run.anchor;
}

// ── 글자 단위 비교 — 빨강(지움)/초록(추가) ─────────────────────────────────

export type DiffOp = 'eq' | 'del' | 'ins';
export interface DiffSeg {
  op: DiffOp;
  t: string;
}

/** 공백·개행을 하나로 — 비교와 표시 모두 한 줄의 글로 본다(스펙 §8: 공백·개행 정규화). */
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * 글자 단위 LCS 비교. 앞뒤 같은 부분을 먼저 걷고 남은 가운데만 표로 푼다 — 문단 하나에서
 * 몇 글자 고친 흔한 경우는 표가 아주 작다. 가운데가 너무 크면(긴 글을 통째로 바꿈) 한 덩이로
 * 지움·추가를 보인다.
 */
export function diffChars(beforeRaw: string, afterRaw: string): DiffSeg[] {
  const a = [...norm(beforeRaw)];
  const b = [...norm(afterRaw)];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const out: DiffSeg[] = [];
  const push = (op: DiffOp, t: string): void => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.op === op) last.t += t;
    else out.push({ op, t });
  };
  push('eq', a.slice(0, head).join(''));
  const ma = a.slice(head, a.length - tail);
  const mb = b.slice(head, b.length - tail);
  if (ma.length * mb.length > 160_000) {
    push('del', ma.join(''));
    push('ins', mb.join(''));
  } else {
    const n = ma.length;
    const m = mb.length;
    const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) dp[i]![j] = ma[i] === mb[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && ma[i] === mb[j]) {
        push('eq', ma[i]!);
        i += 1;
        j += 1;
      } else if (i < n && (j >= m || dp[i + 1]![j]! >= dp[i]![j + 1]!)) {
        // 지움을 먼저 — 읽는 순서가 「지운 글 → 넣은 글」이다(스펙 §5.3-3).
        push('del', ma[i]!);
        i += 1;
      } else {
        push('ins', mb[j]!);
        j += 1;
      }
    }
  }
  push('eq', b.slice(b.length - tail).join(''));
  // 지움과 추가가 **번갈아** 잘게 나뉘면 읽기 어렵다 — 한 글자짜리 같은 글로 갈린 지움·추가는
  // 하나로 붙인다(`가→나 다→라` 대신 `가다→나라`). 바뀐 말 단위로 읽힌다.
  for (let k = 1; k < out.length - 1; k += 1) {
    const mid = out[k]!;
    if (mid.op === 'eq' && mid.t.length <= 1 && out[k - 1]!.op !== 'eq' && out[k + 1]!.op !== 'eq') {
      const left = out.slice(0, k);
      const right = out.slice(k + 1);
      const pick = (op: DiffOp, list: DiffSeg[]): string => list.filter((x) => x.op === op).map((x) => x.t).join('');
      let l = left.length;
      while (l > 0 && left[l - 1]!.op !== 'eq') l -= 1;
      let r = 0;
      while (r < right.length && right[r]!.op !== 'eq') r += 1;
      const lchunk = left.slice(l);
      const rchunk = right.slice(0, r);
      const del = pick('del', lchunk) + mid.t + pick('del', rchunk);
      const ins = pick('ins', lchunk) + mid.t + pick('ins', rchunk);
      const merged: DiffSeg[] = [...left.slice(0, l), { op: 'del', t: del }, { op: 'ins', t: ins }, ...right.slice(r)];
      out.splice(0, out.length, ...merged);
      k = Math.max(0, l - 1);
    }
  }
  return out;
}

/**
 * 표시용으로 줄인다 — 바뀐 곳의 **앞뒤 문맥 10자**만 평문으로 붙이고, 바뀐 글이 200자를 넘으면
 * `… 외 N자`로 끊는다(스펙 §5.3-3).
 */
export function clipDiff(segs: DiffSeg[], context = 10, limit = 200): { segs: DiffSeg[]; more: number } {
  const out: DiffSeg[] = [];
  let used = 0;
  let more = 0;
  segs.forEach((s, i) => {
    if (s.op === 'eq') {
      const first = i === 0;
      const last = i === segs.length - 1;
      if (first && last) out.push(s);
      else if (first) out.push({ op: 'eq', t: s.t.length > context ? `…${s.t.slice(-context)}` : s.t });
      else if (last) out.push({ op: 'eq', t: s.t.length > context ? `${s.t.slice(0, context)}…` : s.t });
      else out.push({ op: 'eq', t: s.t.length > context * 2 ? `${s.t.slice(0, context)} … ${s.t.slice(-context)}` : s.t });
      return;
    }
    const room = Math.max(0, limit - used);
    if (s.t.length <= room) {
      out.push(s);
      used += s.t.length;
    } else {
      if (room > 0) out.push({ op: s.op, t: `${s.t.slice(0, room)}…` });
      more += s.t.length - room;
      used = limit;
    }
  });
  return { segs: out, more };
}

// ── 날짜 묶음·시각 ─────────────────────────────────────────────────────────

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** `오늘` · `어제` · `9월 15일 (월)` · 해가 다르면 `2025년 12월 3일 (수)`(스펙 §2). */
export function dayLabel(at: number, now: number): string {
  const d = new Date(at);
  const t = new Date(now);
  if (dayKey(d) === dayKey(t)) return '오늘';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return '어제';
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
  return d.getFullYear() === t.getFullYear() ? md : `${d.getFullYear()}년 ${md}`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `HH:mm` — 오늘 항목 중 1분이 안 됐으면 `방금`(스펙 §5.3-1). */
export function timeLabel(at: number, now: number): string {
  const d = new Date(at);
  if (dayKey(d) === dayKey(new Date(now)) && now - at < 60_000 && now >= at) return '방금';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `9월 15일 16:20` — 미리보기 띠·되돌리기 요약·토스트가 같은 말을 쓴다. */
export function momentLabel(at: number, now: number): string {
  const d = new Date(at);
  const t = new Date(now);
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getFullYear() === t.getFullYear() ? md : `${d.getFullYear()}년 ${md}`;
}

export interface HistoryGroup {
  key: string;
  label: string;
  entries: NoteHistoryEntry[];
}

/** 최신 먼저 들어온 항목을 날짜별로 묶는다(순서 유지). */
export function groupByDay(entries: NoteHistoryEntry[], now: number): HistoryGroup[] {
  const out: HistoryGroup[] = [];
  for (const e of entries) {
    const key = dayKey(new Date(e.at));
    const last = out[out.length - 1];
    if (last && last.key === key) last.entries.push(e);
    else out.push({ key, label: dayLabel(e.at, now), entries: [e] });
  }
  return out;
}

/** 이번 범위에서 편집한 사람 — 최근 순, 한 사람 한 번(스펙 §3.1). */
export function participantsOf(entries: NoteHistoryEntry[]): NoteHistoryEntry['actor'][] {
  const seen = new Set<string>();
  const out: NoteHistoryEntry['actor'][] = [];
  for (const e of entries) {
    const k = e.actor.id || e.actor.name;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e.actor);
  }
  return out;
}

/** 머리글자 — 아바타 원에 넣는다(한글은 첫 글자, 영문은 앞 두 글자 대문자). */
export function initialsOf(name: string): string {
  const t = name.trim().replace(/@.*$/, '');
  if (!t) return '?';
  if (/^[A-Za-z]/.test(t)) return t.slice(0, 2).toUpperCase();
  return t.slice(0, 1);
}

/** 스냅샷을 페이지로 — 저장소에서 온 값은 모양을 확인하고 쓴다. */
export function snapshotPage(snapshot: unknown): NotePage | null {
  const p = snapshot as NotePage | null;
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !Array.isArray(p.blocks)) return null;
  return { ...p, title: typeof p.title === 'string' ? p.title : '' };
}
