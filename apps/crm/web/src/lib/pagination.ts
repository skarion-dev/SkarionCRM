export function visiblePageNumbers(
  currentPage: number,
  totalPages: number,
  maximumVisible = 10
): number[] {
  if (totalPages <= 0 || maximumVisible <= 0) return [];

  const safeCurrent = Math.min(totalPages, Math.max(1, currentPage));
  const visibleCount = Math.min(totalPages, maximumVisible);
  const pagesBeforeCurrent = Math.floor((visibleCount - 1) / 2);
  let start = Math.max(1, safeCurrent - pagesBeforeCurrent);
  const end = Math.min(totalPages, start + visibleCount - 1);

  start = Math.max(1, end - visibleCount + 1);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
