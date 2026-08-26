import type { IssueNote } from './types.js';

function timestamp(note: IssueNote): number | undefined {
  if (!note.created_at) return undefined;
  const value = Date.parse(note.created_at);
  return Number.isNaN(value) ? undefined : value;
}

function numericId(note: IssueNote): number | undefined {
  if (typeof note.id === 'number' && Number.isFinite(note.id)) return note.id;
  if (typeof note.id === 'string' && /^\d+$/.test(note.id)) return Number(note.id);
  return undefined;
}

/**
 * Produces chronological Issue-note order without mutating GitLab readback.
 *
 * The GitLab notes endpoint commonly returns newest-first.  Historical CLI
 * fixtures only carry a body and are already supplied in chronological order,
 * so retain their order unless every note carries a valid API timestamp.
 */
export function chronologicalNotes(notes: IssueNote[] = []): IssueNote[] {
  const decorated = notes.map((note, index) => ({ note, index, timestamp: timestamp(note), id: numericId(note) }));
  if (!decorated.length || decorated.some((item) => item.timestamp === undefined)) return notes;
  return decorated
    .sort((a, b) => a.timestamp! - b.timestamp! || (a.id ?? 0) - (b.id ?? 0) || a.index - b.index)
    .map((item) => item.note);
}
