import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  normalizeCandidateOutreachDraft,
  normalizeLinkedinConnectionNote,
  normalizeOutreachDraft,
  sanitizeNormalizedLeadProfile,
} from './ai-service.js';

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

describe('candidate outreach draft normalization', () => {
  it('returns an editable copy-ready subject and body for the requested channel', () => {
    expect(
      normalizeCandidateOutreachDraft(
        {
          subject: 'Subject: Your fiber design work',
          body: '```text\nBody: Hi Sam, your OSP design work caught my attention.\n\nHow is your search going?\n```',
        },
        'inmail'
      )
    ).toEqual({
      channel: 'inmail',
      subject: 'Your fiber design work',
      body: 'Hi Sam, your OSP design work caught my attention.\n\nHow is your search going?',
      wordCount: 14,
    });
  });
});

describe('outreach channel limits', () => {
  it('enforces paste-ready limits for LinkedIn and SMS responses', () => {
    const longDraft = `Hi Sam, ${'your fiber design work and GIS experience stood out. '.repeat(20)}`;
    expect([...normalizeOutreachDraft(longDraft, 'linkedin')].length).toBeLessThanOrEqual(300);
    expect([...normalizeOutreachDraft(longDraft, 'sms')].length).toBeLessThanOrEqual(160);
    expect(normalizeOutreachDraft(longDraft, 'linkedin').endsWith('...')).toBe(true);
  });
});

describe('profile normalization sanitization', () => {
  it('keeps factual structured profile data and removes duplicate skills', () => {
    expect(
      sanitizeNormalizedLeadProfile({
        summary: '  Electrical engineer focused on power systems.  ',
        education: [
          {
            institution: 'State University',
            degree: 'BSEE',
            fieldOfStudy: 'Electrical Engineering',
            startDate: '2021',
            endDate: '2025',
          },
        ],
        experience: [
          {
            title: 'Engineering Intern',
            organization: 'Grid Co',
            isCurrent: false,
          },
        ],
        skills: ['AutoCAD', 'autocad', 'Power Systems'],
        confidence: 'high',
        warnings: [],
      })
    ).toMatchObject({
      summary: 'Electrical engineer focused on power systems.',
      skills: ['AutoCAD', 'Power Systems'],
      confidence: 'high',
    });
  });

  it('rejects a response without a usable summary', () => {
    expect(sanitizeNormalizedLeadProfile({ education: [], skills: [] })).toBeNull();
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
