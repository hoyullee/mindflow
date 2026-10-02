import { describe, expect, it } from 'vitest';
import { parseVideoUrl } from './noteVideo';

describe('parseVideoUrl — 붙여넣은 주소를 동영상으로 읽는다', () => {
  it('YouTube — watch · youtu.be · shorts · embed, 시작 시각까지', () => {
    const w = parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s');
    expect(w).toMatchObject({ provider: 'youtube', thumb: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', label: 'YouTube' });
    expect(w?.embed).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&start=90');
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=42')?.embed).toContain('/embed/dQw4w9WgXcQ?autoplay=1&rel=0&start=42');
    expect(parseVideoUrl('https://youtube.com/shorts/dQw4w9WgXcQ')?.provider).toBe('youtube');
    expect(parseVideoUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')?.provider).toBe('youtube');
    expect(parseVideoUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')?.provider).toBe('youtube');
    // 원문은 그대로 — 「원본 열기」가 사람이 붙인 그 주소를 연다.
    expect(parseVideoUrl('  https://youtu.be/dQw4w9WgXcQ  ')?.url).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('Vimeo · Loom', () => {
    expect(parseVideoUrl('https://vimeo.com/76979871')?.embed).toBe('https://player.vimeo.com/video/76979871?autoplay=1');
    expect(parseVideoUrl('https://vimeo.com/76979871/8272103f6e')?.embed).toBe('https://player.vimeo.com/video/76979871?autoplay=1&h=8272103f6e');
    expect(parseVideoUrl('https://player.vimeo.com/video/76979871')?.provider).toBe('vimeo');
    expect(parseVideoUrl('https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184')?.embed).toBe('https://www.loom.com/embed/0281766fa2d04bb788eaf19e65135184?autoplay=1');
  });

  it('파일 주소는 <video>로 — 확장자로 안다', () => {
    expect(parseVideoUrl('https://cdn.example.com/a/demo.mp4')).toMatchObject({ provider: 'file', embed: 'https://cdn.example.com/a/demo.mp4', label: 'demo.mp4' });
    expect(parseVideoUrl('https://cdn.example.com/clip.webm?sig=1')?.provider).toBe('file');
  });

  it('동영상이 아니면 null — 문장·다른 사이트·채널·이상한 id', () => {
    expect(parseVideoUrl('회의 영상 https://youtu.be/dQw4w9WgXcQ')).toBeNull();
    expect(parseVideoUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseVideoUrl('https://www.youtube.com/@channel')).toBeNull();
    expect(parseVideoUrl('https://youtu.be/short')).toBeNull();
    expect(parseVideoUrl('https://vimeo.com/about')).toBeNull();
    expect(parseVideoUrl('javascript:alert(1)')).toBeNull();
    expect(parseVideoUrl('')).toBeNull();
  });
});
