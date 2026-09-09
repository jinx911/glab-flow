export interface StateChangeRecord {
  变更?: string;
  实际日期?: string;
  确认人?: string;
  结论?: string;
  依据?: string;
}
export interface Evidence {
  stateChanges: StateChangeRecord[];
  latest?: StateChangeRecord;
}

function setStateChangeField(record: StateChangeRecord, key: string, value: string): void {
  if (key === '变更') record.变更 = value;
  else if (key === '实际日期') record.实际日期 = value;
  else if (key === '确认人') record.确认人 = value;
  else if (key === '结论') record.结论 = value;
  else if (key === '依据') record.依据 = value;
}

function unescapeMarkdownTableCell(value: string): string {
  return value.replace(/<br\s*\/?>/gi, '\n').replace(/\\\|/g, '|').trim();
}

export function extractEvidence(comments: { body: string }[]): Evidence {
  const records: StateChangeRecord[] = [];
  for (const c of comments) {
    const lines = c.body.split('\n');
    let cur: StateChangeRecord | null = null;
    const flush = () => { if (cur) { records.push(cur); cur = null; } };
    for (const line of lines) {
      if (/^##\s*状态变更/.test(line)) { flush(); cur = {}; continue; }
      if (/^##\s/.test(line)) { flush(); continue; }   // any other header ends the block
      if (cur && line.startsWith('- ')) {
        const idx = line.indexOf('：');
        if (idx > 2) {
          const key = line.slice(2, idx).trim();
          const val = line.slice(idx + 1).trim();
          setStateChangeField(cur, key, val);
        }
      }
      if (cur && line.startsWith('|')) {
        const m = line.match(/^\|\s*(.+?)\s*\|\s*(.*?)\s*\|\s*$/);
        const key = m?.[1]?.trim();
        const val = m?.[2] ? unescapeMarkdownTableCell(m[2]) : undefined;
        if (!key || key === '项目' || /^-+$/.test(key) || !val || /^-+$/.test(val)) continue;
        setStateChangeField(cur, key, val);
      }
    }
    flush();
  }
  return { stateChanges: records, latest: records.length ? records[records.length - 1] : undefined };
}
