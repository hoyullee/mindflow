import type { CSSProperties, ReactNode } from 'react';
import { listMarkers, type NoteListItem } from '@mindflow/mindmap-core';
import { emojiChar, type AdfNode } from '../../../../../../supabase/functions/_shared/jiraDetail';
import { MONO } from './wsUi';

/**
 * Jira 문서(줄인 ADF — `pruneAdf`)를 **원본 서식 그대로** 그린다 — 티켓 상세의 설명·댓글.
 *
 * 목록 표식은 **공책과 같은 규칙**(`listMarkers` — 글머리 `•`→`◦`→`▪`, 번호 `1.`→`a.`→`i.`를 단계마다).
 * ADF는 중첩 목록이 목록 안의 목록이라 단계(depth)를 내려 보내며 센다. 번호 목록의 `order`(시작 번호)도 지킨다.
 * 링크는 `http(s)`·`mailto`만 단다(그 밖의 주소는 글만). 미디어는 내려받지 않는다(`[첨부]` 표시).
 */

const MARK_STYLE: Record<string, CSSProperties> = {
  strong: { fontWeight: 800 },
  em: { fontStyle: 'italic' },
  underline: { textDecoration: 'underline' },
  strike: { textDecoration: 'line-through' },
  code: { fontFamily: MONO, fontSize: '.92em', padding: '1px 5px', borderRadius: 5, background: 'var(--mf-ws-soft)' },
  subsup: { fontSize: '.8em' },
};

const safeHref = (v: unknown): string | null => (typeof v === 'string' && /^(https?:|mailto:)/i.test(v.trim()) ? v.trim() : null);

/** 같은 단계의 항목 n개 → 표식(공책 규칙). */
function markers(kind: 'ul' | 'ol', n: number, depth: number, start: number): string[] {
  const items: NoteListItem[] = Array.from({ length: n }, (_, i) => ({ id: String(i), runs: [], indent: depth }));
  // `listMarkers`는 0단계만 `start`에서 센다 — 깊은 단계의 시작 번호는 앞에 같은 단계의 빈 칸을 세워 맞춘다.
  if (depth === 0 || start === 1) return listMarkers(kind, items, start);
  const pad: NoteListItem[] = Array.from({ length: start - 1 }, (_, i) => ({ id: `p${i}`, runs: [], indent: depth }));
  return listMarkers(kind, [...pad, ...items], 1).slice(start - 1);
}

function Inline({ n }: { n: AdfNode }): ReactNode {
  const a = n.attrs ?? {};
  switch (n.type) {
    case 'text': {
      let node: ReactNode = n.text ?? '';
      for (const m of n.marks ?? []) {
        if (m.type === 'link') {
          const href = safeHref(m.attrs?.href);
          node = href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#C0563A', textDecoration: 'underline', textUnderlineOffset: 2, overflowWrap: 'anywhere' }}>
              {node}
            </a>
          ) : (
            node
          );
        } else if (m.type === 'textColor' && typeof m.attrs?.color === 'string') node = <span style={{ color: m.attrs.color }}>{node}</span>;
        else if (MARK_STYLE[m.type]) node = <span style={MARK_STYLE[m.type]}>{node}</span>;
      }
      return node;
    }
    case 'hardBreak':
      return <br />;
    case 'mention':
      return <span style={{ padding: '0 4px', borderRadius: 5, background: 'var(--mf-ws-soft)', color: 'var(--mf-ws-ink)', fontWeight: 700 }}>{String(a.text ?? '@')}</span>;
    case 'emoji': {
      // Atlassian 전용 체크·엑스는 Jira와 같은 **둥근 그림**으로(유니코드 ✅·❌는 네모라 다르게 보인다).
      const name = String(a.id ?? '').replace(/^atlassian-/, '') || String(a.shortName ?? '').replace(/^:|:$/g, '');
      const own = String(a.id ?? '').startsWith('atlassian-') || /^:(check_mark|cross_mark):$/.test(String(a.shortName ?? ''));
      if (own && (name === 'check_mark' || name === 'cross_mark')) return <RoundMark ok={name === 'check_mark'} label={String(a.shortName ?? name)} />;
      return <>{emojiChar(a) ?? String(a.shortName ?? '')}</>;
    }
    case 'inlineCard': {
      const href = safeHref(a.url);
      return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#C0563A', textDecoration: 'underline', overflowWrap: 'anywhere' }}>
          {href}
        </a>
      ) : null;
    }
    case 'status':
      return <span style={{ display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 6px', borderRadius: 4, background: 'var(--mf-ws-soft)', fontSize: 10.5, fontWeight: 800, letterSpacing: '.03em', textTransform: 'uppercase', verticalAlign: 'middle' }}>{String(a.text ?? '')}</span>;
    case 'date': {
      const ts = Number(a.timestamp);
      return <span style={{ fontFamily: MONO, fontSize: '.92em' }}>{Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : ''}</span>;
    }
    case 'mediaInline':
      return <Attach />;
    default:
      return <>{(n.content ?? []).map((k, i) => <Inline key={i} n={k} />)}</>;
  }
}

/** Atlassian의 `:check_mark:`·`:cross_mark:` — 초록·빨강 원 안의 흰 표시(글자 크기를 따른다). */
function RoundMark({ ok, label }: { ok: boolean; label: string }) {
  return (
    <svg role="img" aria-label={label} width="1.15em" height="1.15em" viewBox="0 0 24 24" style={{ verticalAlign: '-0.2em', display: 'inline-block' }}>
      <circle cx="12" cy="12" r="11" fill={ok ? '#22A06B' : '#E34935'} />
      <path d={ok ? 'M7 12.5l3.2 3.2L17 9' : 'M8.5 8.5l7 7M15.5 8.5l-7 7'} fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const Attach = () => <span style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 6, border: '1px solid var(--mf-ws-line2)', fontSize: 11.5, fontWeight: 700, color: 'var(--mf-ws-mut)' }}>첨부 파일 · Jira에서 보기</span>;

const inlines = (n: AdfNode) => (n.content ?? []).map((k, i) => <Inline key={i} n={k} />);

const PANEL: Record<string, { bg: string; bd: string }> = {
  info: { bg: '#E9F0FC', bd: '#5B8DEF' },
  note: { bg: '#F1ECFA', bd: '#8B5CF6' },
  success: { bg: '#EBF5EE', bd: '#4E8C67' },
  warning: { bg: '#FBF3E4', bd: '#D8A24F' },
  error: { bg: '#FBEDE6', bd: '#E85E33' },
};

function Block({ n, depth }: { n: AdfNode; depth: number }): ReactNode {
  const a = n.attrs ?? {};
  const kids = n.content ?? [];
  switch (n.type) {
    case 'paragraph':
      return <p style={{ margin: 0, minHeight: '1.7em' }}>{inlines(n)}</p>;
    case 'heading': {
      const lv = Math.max(1, Math.min(6, Number(a.level) || 3));
      const size = [0, 19, 17, 15.5, 14.5, 13.5, 13][lv];
      return <p style={{ margin: '6px 0 0', fontSize: size, fontWeight: 800, lineHeight: 1.4, color: 'var(--mf-ws-ink)' }}>{inlines(n)}</p>;
    }
    case 'bulletList':
    case 'orderedList': {
      const kind = n.type === 'bulletList' ? 'ul' : 'ol';
      const start = Math.max(1, Math.floor(Number(a.order) || 1));
      const marks = markers(kind, kids.length, depth, start);
      return (
        <div data-adf-list={kind} style={{ display: 'flex', flexDirection: 'column' }}>
          {kids.map((li, i) => (
            <ListItem key={i} n={li} depth={depth} marker={marks[i] ?? ''} ordered={kind === 'ol'} />
          ))}
        </div>
      );
    }
    case 'taskList':
      return (
        <div data-adf-list="task" style={{ display: 'flex', flexDirection: 'column' }}>
          {kids.map((t, i) =>
            t.type === 'taskList' ? (
              <div key={i} style={{ paddingLeft: 22 }}>
                <Block n={t} depth={depth + 1} />
              </div>
            ) : (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span aria-hidden="true" style={{ flexShrink: 0, width: 14, height: 14, marginTop: '.32em', borderRadius: 4, border: `1.5px solid ${t.attrs?.state === 'DONE' ? '#4E8C67' : '#C9BEB1'}`, background: t.attrs?.state === 'DONE' ? '#4E8C67' : 'transparent', color: '#fff', fontSize: 10, lineHeight: '11px', textAlign: 'center', boxSizing: 'border-box' }}>{t.attrs?.state === 'DONE' ? '✓' : ''}</span>
                <span style={{ minWidth: 0, flex: 1, textDecoration: t.attrs?.state === 'DONE' ? 'line-through' : 'none', color: t.attrs?.state === 'DONE' ? 'var(--mf-ws-faint)' : undefined }}>{inlines(t)}</span>
              </div>
            ),
          )}
        </div>
      );
    case 'codeBlock':
      return <pre style={{ margin: 0, padding: '10px 12px', borderRadius: 10, background: 'var(--mf-ws-sunk)', fontFamily: MONO, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{kids.map((k) => k.text ?? '').join('')}</pre>;
    case 'blockquote':
      return (
        <div style={{ paddingLeft: 12, borderLeft: '3px solid var(--mf-ws-line2)', color: 'var(--mf-ws-mut)' }}>
          <Blocks list={kids} depth={depth} />
        </div>
      );
    case 'panel': {
      const p = PANEL[String(a.panelType)] ?? PANEL.info!;
      return (
        <div style={{ padding: '8px 12px', borderRadius: 10, background: p.bg, borderLeft: `3px solid ${p.bd}` }}>
          <Blocks list={kids} depth={depth} />
        </div>
      );
    }
    case 'expand':
    case 'nestedExpand':
      return (
        <details style={{ borderRadius: 10, border: '1px solid var(--mf-ws-line)', padding: '6px 10px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{String(a.title ?? '펼치기')}</summary>
          <Blocks list={kids} depth={depth} />
        </details>
      );
    case 'rule':
      return <hr style={{ border: 0, borderTop: '1px solid var(--mf-ws-line)', margin: '6px 0' }} />;
    case 'table':
      return (
        // 표는 넓을 수 있다 — 표 안에서만 가로로 굴리고 본문은 밀지 않는다(제보: 본문이 옆으로 밀렸다).
        <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12.5, lineHeight: 1.55 }}>
            <tbody>
              {kids.map((row, r) => (
                <tr key={r}>
                  {(row.content ?? []).map((cell, c) => {
                    const Tag = cell.type === 'tableHeader' ? 'th' : 'td';
                    return (
                      <Tag key={c} colSpan={Number(cell.attrs?.colspan) || undefined} rowSpan={Number(cell.attrs?.rowspan) || undefined} style={{ border: '1px solid var(--mf-ws-line)', padding: '5px 8px', verticalAlign: 'top', textAlign: 'left', background: cell.type === 'tableHeader' ? 'var(--mf-ws-sunk)' : undefined, fontWeight: cell.type === 'tableHeader' ? 800 : undefined, minWidth: 60 }}>
                        <Blocks list={cell.content ?? []} depth={0} />
                      </Tag>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return (
        <div>
          <Attach />
        </div>
      );
    case 'blockCard':
    case 'embedCard': {
      const href = safeHref(a.url);
      return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#C0563A', textDecoration: 'underline', overflowWrap: 'anywhere' }}>
          {href}
        </a>
      ) : null;
    }
    default:
      // 모르는 블록(확장 등) — 안의 것만.
      return kids.length ? <Blocks list={kids} depth={depth} /> : n.text ? <span>{n.text}</span> : null;
  }
}

function ListItem({ n, depth, marker, ordered }: { n: AdfNode; depth: number; marker: string; ordered: boolean }) {
  const kids = n.content ?? [];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', paddingLeft: depth ? 0 : 2 }}>
      {/* 표식 칸은 공책처럼 고정 폭 — 번호가 두 자리가 돼도 글이 흔들리지 않게. */}
      <span aria-hidden="true" style={{ flexShrink: 0, width: ordered ? 24 : 18, textAlign: ordered ? 'right' : 'center', paddingRight: ordered ? 6 : 4, color: 'var(--mf-ws-mut)', fontVariantNumeric: 'tabular-nums', fontWeight: ordered ? 600 : 400 }}>{marker}</span>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
        {kids.map((k, i) => (k.type === 'bulletList' || k.type === 'orderedList' ? <Block key={i} n={k} depth={depth + 1} /> : <Block key={i} n={k} depth={depth} />))}
      </div>
    </div>
  );
}

function Blocks({ list, depth }: { list: AdfNode[]; depth: number }) {
  return (
    <>
      {list.map((k, i) => (
        <Block key={i} n={k} depth={depth} />
      ))}
    </>
  );
}

/** 문서 하나 — 블록 사이 간격 4px, 줄 높이 1.7, 긴 주소도 칸 안에서 접힌다. */
export function AdfView({ doc, style }: { doc: AdfNode; style?: CSSProperties }) {
  return (
    <div data-adf style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'keep-all', ...style }}>
      <Blocks list={doc.content ?? []} depth={0} />
    </div>
  );
}
