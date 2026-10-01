// 공책 기록을 **쓰는** 쪽 — 저장이 성공할 때마다 페이지별로 항목을 남긴다(스펙 §2·§6.3).
//
// - 기준(`base`): 페이지마다 마지막으로 기록한 판. 문서를 처음 받았을 때·서버 판을 채택했을 때
//   다시 맞춘다(`seed`) — 그러지 않으면 **남이 저장한 변화**가 다음 내 저장에 내 이름으로 실린다.
// - 묶음(`run`): 같은 사람이 같은 블록을 2분 안에 이어 고치면 새 항목 대신 **열린 항목을 고친다**
//   (요약·diff는 묶음이 시작되기 전 판 → 지금 판).
// - 되돌리기: `expectRestore`로 다음 기록을 `restore` 항목으로 못박는다(묶이지 않는다).
// - 저장소 오류는 삼킨다 — 기록은 부가 기능이고, 본문 저장을 막으면 안 된다.

import type { Doc, NotePage } from '@mindflow/mindmap-core';
import type { NoteHistoryActor, NoteHistoryEntry, NoteHistoryKind, NoteHistoryStore } from '../../adapters/ports';
import { canMerge, describePageChange, type PageChange } from './noteHistory';

interface Run {
  entryId: Promise<string | null>;
  actorId: string;
  lastAt: number;
  anchor: string | null;
  kind: NoteHistoryKind;
  /** 묶음이 시작되기 **전**의 판 — 합친 요약은 이것에서 지금 판까지다. */
  base: NotePage | null;
}

type Listener = (entry: NoteHistoryEntry) => void;

const clone = (p: NotePage): NotePage => JSON.parse(JSON.stringify(p)) as NotePage;

export class NoteHistoryRecorder {
  private base = new Map<string, NotePage>();
  private seeded = false;
  private runs = new Map<string, Run>();
  private restores = new Map<string, string>();
  private listeners = new Set<Listener>();

  constructor(
    private readonly store: NoteHistoryStore,
    private readonly docId: string,
    private readonly actor: () => NoteHistoryActor | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 지금 문서를 기준으로 삼는다 — 처음 받았을 때·서버 판을 채택했을 때. 열린 묶음은 닫는다. */
  seed(doc: Doc): void {
    this.base.clear();
    for (const p of doc.pages ?? []) this.base.set(p.id, clone(p));
    this.runs.clear();
    this.seeded = true;
  }

  /** 다음 기록을 되돌리기 항목으로 — `9월 15일 16:20 시점으로 되돌림`. */
  expectRestore(pageId: string, summary: string): void {
    this.restores.set(pageId, summary);
  }

  /** 새로 쓰거나 고친 항목을 듣는다(열려 있는 기록 패널이 맨 위에 넣는다). */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 저장이 성공한 문서 — 바뀐 페이지마다 항목을 남긴다. 끝날 때까지 기다릴 수 있다(테스트). */
  async record(doc: Doc): Promise<void> {
    const actor = this.actor();
    if (!actor) return;
    // 기준이 없으면(첫 저장이 seed보다 먼저) 지금 판을 기준으로 삼고 끝낸다 — 무엇이 바뀌었는지 모른다.
    if (!this.seeded) {
      this.seed(doc);
      return;
    }
    const jobs: Promise<void>[] = [];
    for (const page of doc.pages ?? []) {
      const prev = this.base.get(page.id) ?? null;
      const restore = this.restores.get(page.id);
      let delta = describePageChange(prev, page);
      if (restore) {
        this.restores.delete(page.id);
        delta = { kind: 'restore', summary: restore, diff: null, anchor: null, touched: delta?.touched ?? [] };
      }
      if (!delta) continue;
      this.base.set(page.id, clone(page));
      jobs.push(this.write(page, prev, delta, actor));
    }
    await Promise.all(jobs);
  }

  private async write(page: NotePage, prev: NotePage | null, delta: PageChange, actor: NoteHistoryActor): Promise<void> {
    const at = this.now();
    const run = this.runs.get(page.id) ?? null;
    if (canMerge(run, actor.id, at, delta) && run) {
      // 열린 항목을 고친다 — 요약은 묶음이 시작되기 전 판에서 지금 판까지.
      const merged = describePageChange(run.base, page) ?? delta;
      run.lastAt = at;
      const id = await run.entryId;
      if (!id) return;
      const patch = { at, kind: merged.kind, summary: merged.summary, diff: merged.diff, anchor: merged.anchor ?? run.anchor, snapshot: clone(page) };
      try {
        await this.store.update(id, patch);
        this.emit({ id, docId: this.docId, pageId: page.id, actor, ...patch });
      } catch {
        /* 기록은 부가 기능 — 저장 흐름을 막지 않는다 */
      }
      return;
    }
    const entryId = (async (): Promise<string | null> => {
      try {
        const saved = await this.store.append({
          docId: this.docId,
          pageId: page.id,
          at,
          actor,
          kind: delta.kind,
          summary: delta.summary,
          diff: delta.diff,
          anchor: delta.anchor,
          snapshot: clone(page),
        });
        this.emit(saved);
        return saved.id;
      } catch {
        return null;
      }
    })();
    this.runs.set(page.id, { entryId, actorId: actor.id, lastAt: at, anchor: delta.anchor, kind: delta.kind, base: prev ? clone(prev) : null });
    await entryId;
  }

  private emit(entry: NoteHistoryEntry): void {
    for (const fn of this.listeners) {
      try {
        fn(entry);
      } catch {
        /* 듣는 쪽의 오류가 기록을 멈추지 않게 */
      }
    }
  }
}
