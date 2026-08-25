export function parseAssigneeTable(description: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = description.split('\n');
  let inTable = false;
  for (const line of lines) {
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (line.includes('交付协同')) { inTable = true; continue; }
    if (inTable) {
      if (cells.length === 0) continue;
      if (cells[0]?.startsWith('---')) continue;
      if (cells[0] === '角色') continue;
      if (cells.length >= 2 && cells[0] && /^@\w+/.test(cells[1] ?? '')) map.set(cells[0], cells[1]!);
      if (!line.startsWith('|')) break;
    }
  }
  return map;
}
