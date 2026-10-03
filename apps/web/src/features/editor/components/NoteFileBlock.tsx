// 본문의 **첨부 파일 블록** — 파일 하나를 한 줄 카드로(아이콘 · 이름 · 크기 · 받기).
//
// 실물은 R2에 있고(0049) 블록에는 `fileId`·이름·크기·형식만 든다. 받을 때마다 서버에서 몇 분짜리
// 주소를 새로 받는다 — 공유를 끊으면 그 뒤로는 받을 수 없게(주소를 문서에 적어 두면 영원히 열린다).
//
// 상태는 넷이다: 올리는 중(진행 막대) · 실패(까닭 + 다시 시도) · 끝나지 않음(다른 기기에서 올리다
// 멈춘 블록 — `fileId`가 없다) · 준비됨(누르면 열기, ↓는 받기).
//
// 글이 없는 **위젯 블록**이다(구분선·그림·동영상과 같은 갈래) — 카드를 누르면 골라지고, 지우기·
// 옮기기는 다른 위젯 블록과 같다.

import { useState } from 'react';
import type { NoteBlock } from '@mindflow/mindmap-core';
import { useFileStore } from '../../../adapters/BackendContext';
import type { FileUploadError } from '../../../adapters/ports';
import { fileKindOf, formatBytes, fileUploadMessage, isPreviewable } from '../noteFiles';
import type { EditorController } from '../useEditorState';

const DOWN = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
  </svg>
);

export function NoteFileBlock({
  controller,
  block,
  flow,
  picked,
  pickObject,
}: {
  controller: EditorController;
  block: NoteBlock;
  flow: React.CSSProperties;
  picked: boolean;
  pickObject: (id: string, add: boolean) => void;
}) {
  const th = controller.uiTheme;
  const store = useFileStore();
  const upload = controller.noteUploads[block.id] ?? null;
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const name = block.fileName || '파일';
  const kind = fileKindOf(name, block.fileMime);
  const ready = !!block.fileId && !upload;

  const open = async (inline: boolean): Promise<void> => {
    if (!block.fileId || busy) return;
    setBusy(true);
    // 창은 **누른 순간에** 연다 — 주소를 받은 뒤에 열면 팝업 차단기가 막는다(사용자 동작에서 멀어져서).
    const win = inline ? window.open('', '_blank') : null;
    try {
      const url = await store.downloadUrl(block.fileId, inline);
      if (!url) {
        win?.close();
        setGone(true);
        return;
      }
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else {
        // 받기는 지금 창에서 — 서버가 `attachment`로 내려주므로 화면은 그대로 있고 내려받기만 시작된다.
        const a = document.createElement('a');
        a.href = url;
        a.rel = 'noopener';
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * **빈 자리**(이름도 id도 없다) — 블록 넣기의 `/파일`에서 고르개를 고르지 않고 닫았을 때 남는 자리다
   * (`placeNoteUpload`). 눌러서 다시 열거나, 여기에 끌어 놓아도 된다(본문의 끌어 놓기가 빈 자리를 바꾼다).
   */
  if (!upload && !block.fileId && !block.fileName) {
    return (
      <div data-note-block={block.id} data-note-kind="file" style={flow}>
        <button
          type="button"
          data-file-pick
          data-upload-pick
          disabled={controller.readOnly}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => controller.promptNoteFiles({ replace: block.id })}
          className="btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            height: 64,
            borderRadius: 12,
            border: `1.5px dashed ${picked ? 'var(--mf-accent-mute)' : 'var(--mf-border)'}`,
            background: 'transparent',
            color: 'var(--mf-muted)',
            fontFamily: 'inherit',
            fontSize: 12.5,
            cursor: controller.readOnly ? 'default' : 'pointer',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.5 11.5 12.4 19.6a5 5 0 0 1-7.1-7.1l8.3-8.3a3.3 3.3 0 0 1 4.7 4.7l-8.3 8.3a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6" />
          </svg>
          파일 고르기 · 또는 여기로 끌어 놓기
        </button>
      </div>
    );
  }

  const sub = upload
    ? upload.error
      ? fileUploadMessage(upload.error as FileUploadError)
      : `올리는 중 · ${Math.round(upload.progress * 100)}%`
    : !block.fileId
      ? '올리기가 끝나지 않았어요 — 지우고 다시 넣어 주세요'
      : gone
        ? '파일을 찾을 수 없어요 — 지워졌거나 열 권한이 없어요'
        : [formatBytes(block.fileSize ?? 0), kind.label].filter(Boolean).join(' · ');
  const failed = !!upload?.error || (!upload && !block.fileId) || gone;

  return (
    <div data-note-block={block.id} data-note-kind="file" style={flow}>
      <div
        data-file-block={block.id}
        data-file-state={upload ? (upload.error ? 'error' : 'uploading') : block.fileId ? 'ready' : 'unfinished'}
        contentEditable={false}
        onPointerDown={(e) => {
          e.stopPropagation();
          pickObject(block.id, e.shiftKey);
        }}
        onDoubleClick={() => void open(isPreviewable(kind.key))}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 12px',
          border: `1px solid ${picked ? 'var(--mf-accent-mute)' : 'var(--mf-border-soft)'}`,
          boxShadow: picked ? '0 0 0 3px var(--mf-accent-mute)' : 'none',
          borderRadius: 12,
          background: 'var(--mf-card)',
          overflow: 'hidden',
          userSelect: 'none',
          cursor: ready ? 'pointer' : 'default',
        }}
      >
        <span
          aria-hidden
          style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 9, background: kind.tint, color: kind.ink, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.2 }}
        >
          {kind.badge}
        </span>
        <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            data-file-name
            onClick={(e) => {
              if (!ready) return;
              e.stopPropagation();
              void open(isPreviewable(kind.key));
            }}
            title={name}
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, fontWeight: 700, color: th.text }}
          >
            {name}
          </span>
          <span data-file-sub style={{ fontSize: 12, color: failed ? '#c4614c' : th.subtext }}>
            {sub}
          </span>
        </span>
        {upload?.error && upload.error.reason !== 'too-large' && upload.error.reason !== 'quota' && upload.error.reason !== 'not-configured' && !controller.readOnly && (
          <button
            type="button"
            data-file-retry
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => controller.retryNoteFile(block.id)}
            style={{ flex: '0 0 auto', border: 0, borderRadius: 8, padding: '6px 10px', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', background: 'var(--mf-accent-mute)', color: th.text }}
          >
            다시 시도
          </button>
        )}
        {ready && !gone && (
          <button
            type="button"
            data-file-download
            aria-label={`${name} 받기`}
            title="받기"
            disabled={busy}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void open(false);
            }}
            style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, border: 0, borderRadius: 8, cursor: busy ? 'progress' : 'pointer', background: 'transparent', color: th.subtext }}
          >
            {DOWN}
          </button>
        )}
        {upload && !upload.error && (
          <span aria-hidden style={{ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${Math.max(2, Math.round(upload.progress * 100))}%`, background: 'var(--mf-accent, #e85e33)', transition: 'width .2s ease' }} />
        )}
      </div>
    </div>
  );
}
