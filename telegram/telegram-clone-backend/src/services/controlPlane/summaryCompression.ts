const DEFAULT_MAX_LINES = 14;
const DEFAULT_MAX_CHARS = 900;
const DEFAULT_MAX_LINE_CHARS = 140;

export type SummaryCompressionBudget = {
  maxLines?: number;
  maxChars?: number;
  maxLineChars?: number;
};

function truncateLine(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  if (maxChars <= 1) return '…';
  return `${line.slice(0, maxChars - 1).trimEnd()}…`;
}

function normalizeLine(line: string, maxLineChars: number): string {
  return truncateLine(line.trim().replace(/\s+/g, ' '), maxLineChars);
}

function joinedLength(lines: string[]): number {
  if (!lines.length) return 0;
  return lines.join('\n').length;
}

export function compressSummary(summary: string, budget: SummaryCompressionBudget = {}): string {
  const maxLines = budget.maxLines ?? DEFAULT_MAX_LINES;
  const maxChars = budget.maxChars ?? DEFAULT_MAX_CHARS;
  const maxLineChars = budget.maxLineChars ?? DEFAULT_MAX_LINE_CHARS;

  const seen = new Set<string>();
  const normalized = summary
    .split('\n')
    .map((line) => normalizeLine(line, maxLineChars))
    .filter(Boolean)
    .filter((line) => {
      const dedupeKey = line.toLowerCase();
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    });

  const selected: string[] = [];
  for (const line of normalized) {
    const next = [...selected, line];
    if (next.length > maxLines) break;
    if (joinedLength(next) > maxChars) break;
    selected.push(line);
  }

  if (selected.length < normalized.length) {
    const omitted = normalized.length - selected.length;
    const notice = truncateLine(`- … ${omitted} additional line(s) omitted.`, maxLineChars);
    if (selected.length < maxLines && joinedLength([...selected, notice]) <= maxChars) {
      selected.push(notice);
    }
  }

  return selected.join('\n');
}
