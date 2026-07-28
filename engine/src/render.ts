import type { Payload } from './types.js';

export function renderStatusChange(p: Payload): string {
  const f = p.fields;
  const lines = ['## 状态变更', '', `- 变更：\`${p.from}\` → \`${p.to}\``];
  const dateKey = Object.keys(f).find((k) => k.includes('日期')) ?? '';
  if (dateKey) lines.push(`- 实际日期：${f[dateKey]}`);
  const who = f['产品确认人'] ?? f['测试Assignee'] ?? f['研发Assignee'] ?? p.assigneeUser ?? '';
  if (who) lines.push(`- 确认人：${who}`);
  const concl = f['评审结论'] ?? f['测试结论'] ?? f['验收结论'] ?? f['验证结论'];
  if (concl) lines.push(`- 结论：${concl}`);
  const ev = f['需求文档或评审记录'] ?? f['回归范围或证据'] ?? f['验收依据'] ?? f['验证依据'] ?? f['发布记录或回滚信息'];
  if (ev) lines.push(`- 依据：${ev}`);
  if (p.assigneeUser) lines.push(`- 目标节点 Assignee：${p.assigneeUser}`);
  return lines.join('\n');
}

export function renderReturn(target: string, issues: string[], confirmer: string, date: string): string {
  return ['## 状态变更（退回）', '',
    `- 退回：\`${target}\``, `- 实际日期：${date}`, `- 确认人：${confirmer}`,
    '', '### 问题清单（需修订）', ...issues.map((i, n) => `${n + 1}. ${i}`),
    '', '- 下一步：产品修订后重新进入待评审'].join('\n');
}
