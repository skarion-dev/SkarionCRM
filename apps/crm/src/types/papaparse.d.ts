// papaparse ships no types and this repo has no @types/papaparse dependency
// (adding one would mean fabricating pnpm-lock.yaml resolution metadata by
// hand) — this covers just the surface both importNormalizer.ts and
// backfillOutreachFromLinkedInExport.ts actually use.
declare module 'papaparse' {
  interface ParseConfig {
    header?: boolean;
    delimiter?: string;
    skipEmptyLines?: boolean | 'greedy';
  }

  interface ParseResult<T> {
    data: T[];
    errors: unknown[];
    meta: unknown;
  }

  interface PapaStatic {
    parse<T = unknown>(input: string, config?: ParseConfig): ParseResult<T>;
  }

  const Papa: PapaStatic;
  export default Papa;
}
