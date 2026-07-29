import type { NormalizedEducationEntry } from './ai-service.js';

function educationRecencyScore(entry: NormalizedEducationEntry): number {
  const endDate = entry.endDate?.trim() ?? '';
  const startDate = entry.startDate?.trim() ?? '';
  if (/\b(present|current|expected|ongoing)\b/i.test(endDate)) return 9_999_999_999;
  const years = `${endDate} ${startDate}`.match(/\b(?:19|20)\d{2}\b/g) ?? [];
  const latestYear = Math.max(0, ...years.map(Number));
  const monthNames = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ];
  const month = monthNames.findIndex((name) => endDate.toLowerCase().includes(name)) + 1;
  return latestYear * 100 + month;
}

export function mostRecentEducation(
  entries: NormalizedEducationEntry[]
): NormalizedEducationEntry | null {
  return (
    entries
      .map((entry, index) => ({ entry, index, score: educationRecencyScore(entry) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.entry ?? null
  );
}

export function graduationYear(value: string | null | undefined): number | null {
  const years = value?.match(/\b(?:19|20)\d{2}\b/g)?.map(Number) ?? [];
  return years.length ? Math.max(...years) : null;
}
