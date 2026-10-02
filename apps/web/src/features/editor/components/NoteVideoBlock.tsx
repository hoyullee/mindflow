// 본문의 **동영상 블록** — 붙여넣은 주소를 16:9 판으로 미리 본다.
//
// 처음에는 **썸네일 + 재생 단추**만 그린다. 누른 뒤에야 iframe을 붙인다 — 페이지에 동영상이
// 여럿이면 iframe마다 플레이어 스크립트를 수 MB씩 받고, 공책을 열 때마다 그 값을 치르게 된다.
// 파일 주소(`.mp4` 등)는 브라우저의 `<video>`로 바로 튼다(`preload="metadata"` — 첫 장면만).
//
// 글이 없는 **위젯 블록**이라 캐럿이 서지 않는다(구분선·그림·일정 블록과 같은 갈래). 판을
// 누르면 블록이 골라지고, 지우기·옮기기는 다른 위젯 블록과 같다(골라서 Delete · 끌기).
// 재생 중에는 iframe이 누름을 삼키므로 **아래 띠**가 고르는 손잡이가 된다.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { NoteBlock } from '@mindflow/mindmap-core';
import { parseVideoUrl } from '../noteVideo';
import type { EditorController } from '../useEditorState';

/**
 * 막 넣은 빈 동영상 블록 — 처음 그려질 때 주소 칸에 초점을 준다. `autoFocus`로 두지 않는
 * 이유는 **예전에 만들어 둔 빈 블록**이 있는 공책을 열 때마다 초점을 빼앗기 때문이다.
 */
const freshVideo = new Set<string>();
export function focusVideoInputOnMount(id: string): void {
  freshVideo.add(id);
}

const PLAY = (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
    <path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.2-6.4a.8.8 0 0 0 0-1.4L9.2 4.9a.8.8 0 0 0-1.2.7Z" fill="currentColor" />
  </svg>
);

const FILM = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m10 9.2 4.8 2.8-4.8 2.8Z" fill="currentColor" stroke="none" />
  </svg>
);

export function NoteVideoBlock({
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
  const readOnly = controller.readOnly;
  const src = block.src ?? '';
  const video = useMemo(() => (src ? parseVideoUrl(src) : null), [src]);
  const [playing, setPlaying] = useState(false);
  const [thumbOk, setThumbOk] = useState(true);
  // 주소가 바뀌면(되돌리기·다른 사람의 저장) 처음 판으로.
  useEffect(() => {
    setPlaying(false);
    setThumbOk(true);
  }, [src]);

  const pick = (e: React.PointerEvent) => {
    e.stopPropagation();
    pickObject(block.id, e.shiftKey);
  };

  const frame: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    border: `1px solid ${picked ? 'var(--mf-accent-mute)' : 'var(--mf-border-soft)'}`,
    boxShadow: picked ? '0 0 0 3px var(--mf-accent-mute)' : 'none',
    borderRadius: 14,
    background: 'var(--mf-card)',
    overflow: 'hidden',
    userSelect: 'none',
  };

  if (!src || !video) {
    return (
      <div data-note-block={block.id} data-note-kind="video" style={flow}>
        <div data-video-block={block.id} contentEditable={false} onPointerDown={pick} style={{ ...frame, padding: '12px 14px', gap: 6 }}>
          {readOnly ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: th.subtext }}>
              {FILM}
              {src ? <a href={src} target="_blank" rel="noreferrer noopener" style={{ color: 'inherit' }}>{src}</a> : '동영상'}
            </span>
          ) : (
            <VideoUrlInput blockId={block.id} initial={src} onSubmit={(url) => controller.setNoteVideo(block.id, url)} subtext={th.subtext} text={th.text} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-note-block={block.id} data-note-kind="video" style={flow}>
      <div data-video-block={block.id} data-video-provider={video.provider} contentEditable={false} style={frame}>
        <div onPointerDown={playing ? undefined : pick} style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#111' }}>
          {video.provider === 'file' ? (
            // 파일은 브라우저 플레이어를 바로 — 조작 막대가 판 안에 있어 재생 단추를 따로 그리지 않는다.
            <video data-video-player src={video.embed} controls preload="metadata" playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#000' }} />
          ) : playing ? (
            <iframe
              data-video-player
              src={video.embed}
              title={`${video.label} 동영상`}
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write"
              allowFullScreen
              // YouTube는 출처(referrer)가 없으면 재생을 거절한다(오류 153).
              referrerPolicy="strict-origin-when-cross-origin"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
            />
          ) : (
            <button
              type="button"
              data-video-play
              aria-label={`${video.label} 동영상 재생`}
              onClick={(e) => {
                e.stopPropagation();
                setPlaying(true);
              }}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '100%',
                padding: 0,
                border: 0,
                cursor: 'pointer',
                background: video.thumb && thumbOk ? '#111' : 'linear-gradient(135deg, #2b2f3a, #15171c)',
              }}
            >
              {video.thumb && thumbOk && (
                <img
                  src={video.thumb}
                  alt=""
                  draggable={false}
                  loading="lazy"
                  onError={() => setThumbOk(false)}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}
              {!(video.thumb && thumbOk) && (
                <span style={{ position: 'absolute', left: 16, top: 14, fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.75)' }}>{video.label}</span>
              )}
              <span
                aria-hidden
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 64,
                  height: 64,
                  paddingLeft: 3,
                  borderRadius: 999,
                  color: '#fff',
                  background: 'rgba(0,0,0,.62)',
                  boxShadow: '0 4px 18px rgba(0,0,0,.35)',
                }}
              >
                {PLAY}
              </span>
            </button>
          )}
        </div>
        {/* 아래 띠 — 재생 중에도 블록을 고르는 손잡이(iframe은 누름을 삼킨다) + 원본 열기. */}
        <div
          data-video-bar
          onPointerDown={pick}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12.5, color: th.subtext, cursor: 'default' }}
        >
          <span style={{ display: 'flex', flex: '0 0 auto', color: th.text }}>{FILM}</span>
          <span style={{ flex: '0 0 auto', fontWeight: 700, color: th.text }}>{video.label}</span>
          <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{video.url}</span>
          <a
            href={video.url}
            target="_blank"
            rel="noreferrer noopener"
            onPointerDown={(e) => e.stopPropagation()}
            style={{ flex: '0 0 auto', color: th.subtext, fontWeight: 600, textDecoration: 'none' }}
          >
            원본 열기 ↗
          </a>
        </div>
      </div>
    </div>
  );
}

/** 빈 동영상 블록의 주소 칸 — Enter로 넣고, 동영상이 아닌 주소는 그 자리에서 알린다. */
function VideoUrlInput({ blockId, initial, onSubmit, subtext, text }: { blockId: string; initial: string; onSubmit: (url: string) => void; subtext: string; text: string }) {
  const [value, setValue] = useState(initial);
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!freshVideo.delete(blockId)) return;
    ref.current?.focus({ preventScroll: true });
  }, [blockId]);
  const submit = (): void => {
    const url = value.trim();
    if (!url) return;
    if (!parseVideoUrl(url)) {
      setBad(true);
      return;
    }
    onSubmit(url);
  };
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'flex', color: subtext }}>{FILM}</span>
        <input
          ref={ref}
          data-video-input
          value={value}
          placeholder="동영상 주소를 붙여 넣으세요 — YouTube · Vimeo · Loom · mp4"
          onChange={(e) => {
            setValue(e.target.value);
            setBad(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            // 붙여 넣으면 바로 넣는다 — 주소를 붙이고 Enter를 한 번 더 누를 일이 없게.
            const url = e.clipboardData.getData('text/plain').trim();
            if (url && parseVideoUrl(url)) {
              e.preventDefault();
              setValue(url);
              onSubmit(url);
            }
          }}
          style={{ flex: '1 1 auto', minWidth: 0, border: 0, outline: 'none', background: 'transparent', font: 'inherit', fontSize: 14, color: text, padding: '2px 0' }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim()}
          style={{ flex: '0 0 auto', border: 0, borderRadius: 8, padding: '5px 10px', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: value.trim() ? 'pointer' : 'default', background: 'var(--mf-accent-mute)', color: text, opacity: value.trim() ? 1 : 0.5 }}
        >
          넣기
        </button>
      </div>
      {bad && <span style={{ fontSize: 12, color: '#c4614c' }}>이 주소는 동영상으로 열 수 없어요 — YouTube · Vimeo · Loom 주소나 .mp4 같은 파일 주소를 넣어 주세요.</span>}
    </>
  );
}
