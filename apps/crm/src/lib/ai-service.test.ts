import { describe, expect, it } from 'vitest';
import { cosineSimilarity, normalizeLinkedinConnectionNote } from './ai-service.js';

describe('LinkedIn connection note normalization', () => {
  it('removes formatting and makes the note one paste-ready paragraph', () => {
    expect(
      normalizeLinkedinConnectionNote(
        '```text\n"Hi Sam, your Civil 3D work stood out. Open to connecting?"\n```'
      )
    ).toBe('Hi Sam, your Civil 3D work stood out. Open to connecting?');
  });

  it('never returns more than 300 Unicode characters', () => {
    const note = normalizeLinkedinConnectionNote(`Hi Sam, ${'fiber design '.repeat(40)}🚀`);
    expect([...note].length).toBeLessThanOrEqual(300);
    expect(note.endsWith('...')).toBe(true);
  });
});

describe('cosine similarity', () => {
  it('returns a stable score for valid vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('does not return NaN for empty, zero, mismatched, or invalid vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(1);
    expect(cosineSimilarity([Number.NaN], [1])).toBe(0);
  });
});
