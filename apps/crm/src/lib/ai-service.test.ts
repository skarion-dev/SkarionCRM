import { describe, expect, it } from 'vitest';
import { normalizeLinkedinConnectionNote } from './ai-service.js';

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
