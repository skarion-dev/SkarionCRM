import { describe, expect, it } from 'vitest';
import { shouldAutoGenerateLinkedinConnectionNote } from './leadAutomation.js';

describe('LinkedIn connection note automation', () => {
  it('runs automatically only for new LinkedIn leads', () => {
    expect(shouldAutoGenerateLinkedinConnectionNote({ source: 'linkedin', status: 'new' })).toBe(
      true
    );
    expect(
      shouldAutoGenerateLinkedinConnectionNote({ source: 'linkedin', status: 'contacted' })
    ).toBe(false);
    expect(shouldAutoGenerateLinkedinConnectionNote({ source: 'website', status: 'new' })).toBe(
      false
    );
    expect(shouldAutoGenerateLinkedinConnectionNote({ source: 'pdf_upload', status: 'new' })).toBe(
      false
    );
  });

  it('does not spend AI tokens on holding-stage leads', () => {
    expect(
      shouldAutoGenerateLinkedinConnectionNote({
        source: 'linkedin',
        status: 'new',
        journeyStage: 'future',
        tags: ['Future'],
      })
    ).toBe(false);
    expect(
      shouldAutoGenerateLinkedinConnectionNote({
        source: 'linkedin',
        status: 'new',
        journeyStage: 'foreign_national',
        tags: ['Foreign National'],
      })
    ).toBe(false);
    expect(
      shouldAutoGenerateLinkedinConnectionNote({
        source: 'linkedin',
        status: 'new',
        journeyStage: 'stem',
        tags: ['STEM'],
      })
    ).toBe(false);
  });
});
