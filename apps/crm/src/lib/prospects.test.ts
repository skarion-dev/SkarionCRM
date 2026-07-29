import { describe, expect, it } from 'vitest';
import {
  calculateLeadCompleteness,
  deriveProspectName,
  dispositionTag,
  normalizeProspectCsvRecord,
} from './prospects.js';

describe('prospect ingestion', () => {
  it('accepts flexible URL and name headers', () => {
    const result = normalizeProspectCsvRecord(
      {
        'Full Name': 'Ada Lovelace',
        'Fixed URL': 'https://www.linkedin.com/in/ada-lovelace/?trk=test',
        Company: 'Analytical Engines',
      },
      2
    );
    expect(result.error).toBeUndefined();
    expect(result.row).toMatchObject({
      sourceRow: 2,
      firstName: 'Ada',
      lastName: 'Lovelace',
      linkedinProfileKey: 'ada-lovelace',
      companyName: 'Analytical Engines',
    });
  });

  it('derives a usable name from a public profile slug without fetching it', () => {
    expect(deriveProspectName('', 'https://www.linkedin.com/in/grace-hopper-123').firstName).toBe(
      'Grace'
    );
  });

  it('preserves rich captured profile fields for cleanup', () => {
    const result = normalizeProspectCsvRecord(
      {
        Name: 'Grace Hopper',
        LinkedIn: 'https://www.linkedin.com/in/grace-hopper',
        Summary: 'Computer scientist and naval officer.',
        Education: 'Yale University — PhD Mathematics',
        Experience: 'Rear Admiral — U.S. Navy',
        Skills: 'Compilers, COBOL',
      },
      4
    );
    expect(result.row).toMatchObject({
      about: 'Computer scientist and naval officer.',
      education: 'Yale University — PhD Mathematics',
      experience: 'Rear Admiral — U.S. Navy',
      skills: 'Compilers, COBOL',
    });
  });

  it('rejects non-LinkedIn URLs', () => {
    expect(normalizeProspectCsvRecord({ url: 'https://example.com/person' }, 3).error).toContain(
      'LinkedIn'
    );
  });

  it('maps dispositions to stable reporting labels', () => {
    expect(dispositionTag('excellent_fit')).toBe('Excellent Fit');
    expect(dispositionTag('disqualified')).toBe('Disqualified');
  });

  it('scores data completeness deterministically', () => {
    expect(
      calculateLeadCompleteness({
        firstName: 'Ada',
        lastName: 'Lovelace',
        linkedinUrl: 'https://www.linkedin.com/in/ada',
      })
    ).toBe(40);
  });
});
