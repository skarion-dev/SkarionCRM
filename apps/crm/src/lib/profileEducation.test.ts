import { describe, expect, it } from 'vitest';
import { graduationYear, mostRecentEducation } from './profileEducation.js';

describe('latest profile education', () => {
  it('selects the newest stated graduation rather than trusting input order', () => {
    expect(
      mostRecentEducation([
        {
          institution: 'Older University',
          degree: 'BS',
          fieldOfStudy: 'Engineering',
          startDate: '2016',
          endDate: '2020',
          description: null,
        },
        {
          institution: 'Recent University',
          degree: 'MS',
          fieldOfStudy: 'Data Science',
          startDate: '2023',
          endDate: 'May 2025',
          description: null,
        },
      ])?.institution
    ).toBe('Recent University');
  });

  it('treats an expected or ongoing program as the most recent education', () => {
    expect(
      mostRecentEducation([
        {
          institution: 'Completed University',
          degree: 'BS',
          fieldOfStudy: null,
          startDate: '2018',
          endDate: '2022',
          description: null,
        },
        {
          institution: 'Current University',
          degree: 'MS',
          fieldOfStudy: null,
          startDate: '2025',
          endDate: 'Expected 2027',
          description: null,
        },
      ])?.institution
    ).toBe('Current University');
    expect(graduationYear('Expected May 2027')).toBe(2027);
  });
});
