import { describe, expect, it } from 'vitest';
import { FileUploadError } from '../../adapters/ports';
import { extOf, fileKindOf, fileUploadMessage, formatBytes, isPreviewable } from './noteFiles';

describe('첨부 파일 — 순수 규칙', () => {
  it('갈래는 확장자 먼저, 모르면 MIME', () => {
    expect(fileKindOf('보고서.PDF').key).toBe('pdf');
    expect(fileKindOf('계획.hwp')).toMatchObject({ key: 'doc', badge: 'HWP' });
    expect(fileKindOf('매출.xlsx').key).toBe('sheet');
    expect(fileKindOf('발표.pptx').key).toBe('slide');
    expect(fileKindOf('묶음.zip').key).toBe('zip');
    expect(fileKindOf('noext', 'image/png').key).toBe('image');
    expect(fileKindOf('noext')).toMatchObject({ key: 'other', badge: 'FILE' });
    expect(extOf('.bashrc')).toBe('');
    expect(isPreviewable('pdf')).toBe(true);
    expect(isPreviewable('zip')).toBe(false);
  });

  it('크기 — 1024로 잰다', () => {
    expect(formatBytes(0)).toBe('0B');
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(1536)).toBe('1.5KB');
    expect(formatBytes(2.4 * 1024 * 1024)).toBe('2.4MB');
    expect(formatBytes(200 * 1024 * 1024)).toBe('200MB');
  });

  it('막힌 까닭 → 문구(서버가 준 숫자 그대로)', () => {
    expect(fileUploadMessage(new FileUploadError('too-large', { fileLimit: 20 * 1024 * 1024 }))).toBe('파일 하나는 20MB까지 올릴 수 있어요');
    expect(fileUploadMessage(new FileUploadError('quota', { used: 199 * 1024 * 1024, limit: 200 * 1024 * 1024 }))).toBe('저장 공간이 부족해요 — 199MB / 200MB 사용 중');
    expect(fileUploadMessage(new FileUploadError('not-configured'))).toBe('파일 첨부는 아직 준비 중이에요');
  });
});
