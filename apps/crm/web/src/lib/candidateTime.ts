const LOCATION_TIME_ZONE_RULES: Array<[RegExp, string]> = [
  [/\b(hawaii|honolulu|hi)\b/i, 'Pacific/Honolulu'],
  [/\b(alaska|anchorage|ak)\b/i, 'America/Anchorage'],
  [/\b(arizona|phoenix|tucson|az)\b/i, 'America/Phoenix'],
  [/\b(washington,?\s*d\.?c\.?|district of columbia)\b/i, 'America/New_York'],
  [
    /\b(california|los angeles|san francisco|san diego|sacramento|san jose|ca)\b/i,
    'America/Los_Angeles',
  ],
  [
    /\b(washington state|seattle|oregon|portland|nevada|las vegas|wa|or|nv)\b/i,
    'America/Los_Angeles',
  ],
  [
    /\b(colorado|denver|utah|salt lake city|montana|wyoming|new mexico|idaho|co|ut|mt|wy|nm|id)\b/i,
    'America/Denver',
  ],
  [
    /\b(texas|dallas|houston|austin|chicago|illinois|minnesota|wisconsin|iowa|missouri|alabama|arkansas|louisiana|mississippi|oklahoma|kansas|nebraska|north dakota|south dakota|tennessee|tx|il|mn|wi|ia|mo|al|ar|la|ms|ok|ks|ne|nd|sd|tn)\b/i,
    'America/Chicago',
  ],
  [
    /\b(new york|boston|massachusetts|new jersey|pennsylvania|philadelphia|virginia|maryland|connecticut|delaware|florida|georgia|indiana|maine|michigan|new hampshire|north carolina|ohio|rhode island|south carolina|vermont|west virginia|ny|ma|nj|pa|va|md|ct|de|fl|ga|me|mi|nh|nc|oh|ri|sc|vt|wv)\b/i,
    'America/New_York',
  ],
  [/\b(toronto|ontario|montreal|quebec)\b/i, 'America/Toronto'],
  [/\b(vancouver|british columbia)\b/i, 'America/Vancouver'],
  [/\b(calgary|edmonton|alberta)\b/i, 'America/Edmonton'],
  [/\b(bangladesh|dhaka)\b/i, 'Asia/Dhaka'],
  [/\b(india|bengaluru|bangalore|mumbai|delhi|hyderabad|kolkata|chennai)\b/i, 'Asia/Kolkata'],
  [/\b(pakistan|karachi|lahore|islamabad)\b/i, 'Asia/Karachi'],
  [/\b(united kingdom|london|england|scotland|wales)\b/i, 'Europe/London'],
  [/\b(germany|berlin|france|paris|netherlands|amsterdam|belgium|brussels)\b/i, 'Europe/Berlin'],
  [/\b(australia|sydney|melbourne)\b/i, 'Australia/Sydney'],
];

export function inferCandidateTimeZone(location: string | null | undefined): string | null {
  const normalized = location?.trim();
  if (!normalized) return null;
  return LOCATION_TIME_ZONE_RULES.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

export interface CandidateCreatedTime {
  date: string;
  time: string;
  timeZone: string;
  inferredFromCandidate: boolean;
}

export function formatCandidateCreatedTime(
  createdAt: string,
  location: string | null | undefined
): CandidateCreatedTime {
  const candidateTimeZone = inferCandidateTimeZone(location);
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  const timeZone = candidateTimeZone ?? browserTimeZone;
  const value = new Date(createdAt);

  return {
    date: new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
    }).format(value),
    time: new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(value),
    timeZone,
    inferredFromCandidate: Boolean(candidateTimeZone),
  };
}
