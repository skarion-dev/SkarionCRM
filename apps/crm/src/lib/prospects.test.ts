import { describe, expect, it } from 'vitest';
import {
  calculateLeadCompleteness,
  deriveProspectName,
  dispositionTag,
  findActiveLeadIdentityDuplicate,
  normalizeProspectCsvRecord,
  prospectIdentityNameKey,
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
        'Current Role': 'Researcher',
        'Current Company': 'Navy Lab',
        'Current Dates': '1944 – 1986',
        'Open To Work Filter': 'Yes',
        'Open To Work': '',
        Keywords: 'Bangladesh OR Bengali',
      },
      4
    );
    expect(result.row).toMatchObject({
      about: 'Computer scientist and naval officer.',
      education: 'Yale University — PhD Mathematics',
      experience: 'Researcher at Navy Lab · 1944 – 1986 | Rear Admiral — U.S. Navy',
      skills: 'Compilers, COBOL',
      currentRole: 'Researcher',
      openToWork: null,
      sourceContext: {
        keywords: 'Bangladesh OR Bengali',
        openToWorkFilter: 'Yes',
      },
    });
  });

  it('cleans common Recruiter export column shifts without inventing evidence', () => {
    const result = normalizeProspectCsvRecord(
      {
        'Full Name': 'Suyash Mohta',
        'Profile URL':
          'https://www.linkedin.comhttps://www.linkedin.com/talent/profile/AEMAAExample',
        Location: 'Data Scientist | SQL, Tableau, Statistics',
        'Current Role': 'Enhanced by resume',
        School: 'UC Davis, Master of Science · 2024 – 2025',
        Degree: 'Indiana University, Bachelor of Science · 2016 – 2020',
        'Edu Dates': 'High School · 2001 – 2016',
      },
      5
    );
    expect(result.row).toMatchObject({
      linkedinProfileKey: 'talent:aemaaexample',
      headline: 'Data Scientist | SQL, Tableau, Statistics',
      location: null,
      currentRole: null,
      education:
        'UC Davis, Master of Science · 2024 – 2025 | Indiana University, Bachelor of Science · 2016 – 2020 | High School · 2001 – 2016',
    });
  });

  it('rejects non-LinkedIn URLs', () => {
    expect(normalizeProspectCsvRecord({ url: 'https://example.com/person' }, 3).error).toContain(
      'LinkedIn'
    );
  });

  it('maps dispositions to stable reporting labels', () => {
    expect(dispositionTag('excellent_fit')).toBe('Excellent Fit');
    expect(dispositionTag('foreign_national')).toBe('Foreign National');
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

  it('matches an uploaded prospect to one uniquely active CRM lead by normalized name', () => {
    const duplicate = findActiveLeadIdentityDuplicate(
      {
        firstName: '  Ada ',
        lastName: 'Lovelace',
        companyName: null,
      },
      [
        {
          id: 'lead-1',
          firstName: 'ADA',
          lastName: 'Lovelace',
          companyName: 'Analytical Engines',
        },
      ]
    );
    expect(duplicate).toMatchObject({
      reason: 'unique_name',
      lead: { id: 'lead-1' },
    });
  });

  it('uses company to disambiguate common names and ignores generated placeholders', () => {
    const activeLeads = [
      {
        id: 'lead-1',
        firstName: 'Sam',
        lastName: 'Rahman',
        companyName: 'Alpha',
      },
      {
        id: 'lead-2',
        firstName: 'Sam',
        lastName: 'Rahman',
        companyName: 'Beta',
      },
    ];
    expect(
      findActiveLeadIdentityDuplicate(
        {
          firstName: 'Sam',
          lastName: 'Rahman',
          companyName: 'Beta',
        },
        activeLeads
      )
    ).toMatchObject({ reason: 'name_company', lead: { id: 'lead-2' } });
    expect(
      findActiveLeadIdentityDuplicate(
        {
          firstName: 'Sam',
          lastName: 'Rahman',
          companyName: null,
        },
        activeLeads
      )
    ).toBeNull();
    expect(
      prospectIdentityNameKey({
        firstName: 'LinkedIn',
        lastName: 'Candidate ABC123',
      })
    ).toBeNull();
  });
});
