import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const TSX = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const CLI = join(REPO_ROOT, 'engine', 'src', 'cli.ts');

/** 跑 cli.ts validate，stdin 喂 JSON，捕获 stdout（直接用 tsx，绕过 pnpm 的 script header 污染）。 */
function cliValidate(stdin: object): { json: unknown; status: number | null; stderr: string } {
  const r = spawnSync(TSX, [CLI, 'validate'], {
    input: JSON.stringify(stdin),
    encoding: 'utf8',
  });
  return { json: r.stdout ? JSON.parse(r.stdout) : null, status: r.status, stderr: r.stderr ?? '' };
}

describe('cli validate — body passthrough (G6b reachable, ⑩)', () => {
  // 待评审→已评审：requiredFields 齐 + gateOutcome 通过 + reviewType 需求评审 + 日期已确认；
  // 唯一变量是 assigneeUser 是否与「交付协同」表的研发角色一致（G6b 交叉校验）。
  const payload = (assignee: string) => ({
    type: 'story', from: '待评审', to: '已评审',
    fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'link' },
    gateOutcome: '通过', reviewType: '需求评审', assigneeUser: assignee, datesConfirmed: true,
  });
  const TABLE_BODY = '# 需求\n## 交付协同\n\n| 角色 | GitLab 用户 |\n| --- | --- |\n| 产品 | @pm |\n| 研发 | @dev |\n| 测试 | @qa |\n';

  it('flags G6b mismatch when body present and assignee disagrees with table', () => {
    const { json, status } = cliValidate({
      type: 'story', labels: ['type::story', 'story-status::待评审'], body: TABLE_BODY, payload: payload('@someone-else'),
    });
    expect(status).toBe(0);
    const g = json as { ok: boolean; reasons: string[] };
    expect(g.ok).toBe(false);
    expect(g.reasons.some((x) => x.includes('与交付协同表'))).toBe(true);
  });

  it('does NOT flag G6b when body omitted (back-compat: empty body skips cross-check)', () => {
    // 旧用法（无 body）→ G6b 跳过；@someone-else 是合法 @ 用户，仅过格式 G6 → ok
    const { json, status } = cliValidate({
      type: 'story', labels: ['type::story', 'story-status::待评审'], payload: payload('@someone-else'),
    });
    expect(status).toBe(0);
    const g = json as { ok: boolean };
    expect(g.ok).toBe(true);
  });
});
