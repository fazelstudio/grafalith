/** Recently-used command ids for palette ranking (MRU, capped). */
const MRU_KEY = 'grafalith:palette-mru';
const MRU_LIMIT = 12;

function readStored(): string[] {
  try {
    const raw = window.localStorage.getItem(MRU_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

/** Ids in recency order, most recent first. */
export function paletteMru(): string[] {
  if (typeof window === 'undefined') return [];
  return readStored();
}

/** Record one execution for MRU ranking. Never throws on storage failure. */
export function recordPaletteUse(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const next = [id, ...readStored().filter((entry) => entry !== id)].slice(0, MRU_LIMIT);
    window.localStorage.setItem(MRU_KEY, JSON.stringify(next));
  } catch {
    // Ranking is best-effort; the palette works without it.
  }
}
