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
          if (key === '变更') cur.变更 = val;
          else if (key === '实际日期') cur.实际日期 = val;
          else if (key === '确认人') cur.确认人 = val;
          else if (key === '结论') cur.结论 = val;
          else if (key === '依据') cur.依据 = val;
        }
      }
    }
    flush();
  }
  return { stateChanges: records, latest: records.length ? records[records.length - 1] : undefined };
}
