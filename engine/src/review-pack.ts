import type { DuState, MissingItem, TransitionInput } from './types.js';
import { runTransition } from './transition.js';
import { TERMINAL } from './constants.js';

/** 评审上下文包输入：与 next 同源（Leader 只读 glab + 本地 DU/testPlan）。 */
export type ReviewPackInput = Omit<TransitionInput, 'to'>;

/** 喂给 reviewer 的标准化材料：对齐 spec/计划/证据，不靠 Leader 手工拼。 */
export interface ReviewPack {
  issue: { iid: number; node: string; type: TransitionInput['type'] };
  /** 评审应对齐的规格来源（Leader 落盘路径）。 */
  spec: { proposal: string; design: string; testPlan: string };
  /** 当前节点未齐缺口（reviewer 需知悉的门禁上下文）。 */
  pendingGates: MissingItem[];
  /** DU 证据摘要行（与流转评论「## 证据摘要」同源渲染，reviewer 看到团队同款事实）。 */
  evidenceDigest: string[];
  /** 评审指令：维度清单 + 严重度门槛 + 结论格式，直接作为 reviewer prompt 的约束段。 */
  instructions: string[];
}

const SPEC_DIR = (iid: number): string => `.glab-flow/${iid}/spec`;

/**
 * 组装评审上下文包（开发中·代码评审 / 测试中·MR 评审共用骨架）。
 * 纯计算：从 transition 结果 + DU 事实推导，不读文件——路径由 Leader 的
 * 既有落点约定决定（nodes.md「工作产物落点」），reviewer 自行 Read。
 */
export function buildReviewPack(model: Parameters<typeof runTransition>[0], input: ReviewPackInput): ReviewPack | { error: string } {
  const out = runTransition(model, input);
  if (out.dirty) return { error: `状态标签异常，先对账：${out.dirtyReason}` };
  const node = out.node as string;
  if (node === null || TERMINAL.has(node)) return { error: `当前节点 ${node ?? '?'} 不需要评审上下文包` };

  const iid = input.iid;
  const dir = SPEC_DIR(iid);
  const evidenceDigest: string[] = [];
  const du: DuState | undefined = input.du;
  if (du) {
    const environments = [...new Set(du.evidence.map((e) => e.environment))];
    for (const env of environments) {
      const run = [...du.evidence].reverse().find((e) => e.kind === 'test-run' && e.environment === env);
      if (run) evidenceDigest.push(`${env}：${run.planVersion} / ${run.outcome}${run.detailRef ? ` / ${run.detailRef}` : ''}`);
    }
    if (du.gateSet) evidenceDigest.push(`门禁单：${du.gateSet.scopes.join('、')}（MR 评审${du.gateSet.mrReview ? '要求' : '豁免'}，回归=${du.gateSet.regression}）`);
  }

  return {
    issue: { iid, node, type: input.type },
    spec: {
      proposal: `${dir}/proposal.md`,
      design: `${dir}/design.md`,
      testPlan: `${dir}/test-plan.md`,
    },
    pendingGates: out.missing,
    evidenceDigest,
    instructions: [
      '评审维度：正确性（对齐 proposal/design 验收标准）/ 安全 / 性能 / 栈最佳实践 / 跨栈激活（后端新字段前端真在用，codegraph 查 callers）。',
      '严重度分级：CRITICAL=安全/数据丢失/崩溃（BLOCK）；HIGH=明显缺陷/重要边界（WARN，须修复或显式记录接受理由）；MEDIUM/LOW 不阻塞。',
      '必须对齐上述 spec 文件与证据摘要，不接受脱离规格的笼统反馈；每条问题带 文件:行号 与建议。',
      '结论格式：每维度 通过/问题清单 + 合并严重度 + 门槛判定（无 CRITICAL、HIGH 需处置）。只产出意见，不改代码。',
    ],
  };
}
