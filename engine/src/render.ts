import type { Payload } from './types.js';

export function renderStatusChange(p: Payload): string {
  const f = p.fields;
  const lines = ['## 状态变更', '', `- 变更：\`${p.from}\` → \`${p.to}\``];
  const rendered = new Set<string>();

  const dateKey = Object.keys(f).find((k) => k.includes('日期'));
  if (dateKey) { lines.push(`- 实际日期：${f[dateKey]}`); rendered.add(dateKey); }

  const confirmerKeys = ['产品确认人', '测试Assignee', '研发Assignee', '具体产品验收人', '具体测试验证人', '测试验证人Assignee'];
  const confirmerKey = confirmerKeys.find((k) => f[k]);
  if (confirmerKey) { lines.push(`- 确认人：${f[confirmerKey]}`); rendered.add(confirmerKey); }

  const conclKeys = ['评审结论', '测试结论', '验收结论', '验证结论'];
  const conclKey = conclKeys.find((k) => f[k]);
  if (conclKey) { lines.push(`- 结论：${f[conclKey]}`); rendered.add(conclKey); }

  const evKeys = ['需求文档或评审记录', '回归范围或证据', '验收依据', '验证依据', '发布记录或回滚信息', '技术方案评审通过记录或免评审结论'];
  const evKey = evKeys.find((k) => f[k]);
  if (evKey) { lines.push(`- 依据：${f[evKey]}`); rendered.add(evKey); }

  for (const k of Object.keys(f)) {
    if (!rendered.has(k) && f[k]) lines.push(`- ${k}：${f[k]}`);
  }

  if (p.assigneeUser) lines.push(`- 目标节点 Assignee：${p.assigneeUser}`);
  return lines.join('\n');
}

export function renderReturn(target: string, issues: string[], confirmer: string, date: string): string {
  return ['## 状态变更（退回）', '',
    `- 退回：\`${target}\``, `- 实际日期：${date}`, `- 确认人：${confirmer}`,
    '', '### 问题清单（需修订）', ...issues.map((i, n) => `${n + 1}. ${i}`),
    '', '- 下一步：产品修订后重新进入待评审'].join('\n');
}
