export function readOptionalInt(value: unknown): number | undefined {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function readOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function readChatType(value: unknown): 'private' | 'group' | undefined {
  return value === 'private' || value === 'group' ? value : undefined;
}
