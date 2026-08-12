import { describe, it, expect } from 'vitest';
import { loadModel } from './model.js';
import { runTransition } from './transition.js';
import type { TransitionInput } from './types.js';

const model = loadModel();
const notes = [{ body: '' }];

function baseInput(over: Partial<TransitionInput>): TransitionInput {
  return { type: 'story', iid: 42, labels: [], body: '', notes, state: 'opened', ...over };
}

const TABLE_BODY = `# 需求\n## 交付协同\n\n| 角色 | GitLab 用户 |\n| --- | --- |\n| 产品 | @pm |\n| 研发 | @dev |\n| 测试 | @qa |\n`;

const TEST_DONE_FIELDS = {
  测试完成日期: '2026-08-07',
  测试Assignee: '@qa',
  测试结论: '通过',
  回归范围或证据: 'r',
  阻塞发布问题均已验证通过: '是',
  feature分支MR评审结论: '通过，无 HIGH 残留',
};

const DEVELOPMENT_START_FIELDS = {
  技术方案评审通过记录或免评审结论: '通过',
  实际开始日期: '2026-08-07',
  研发Assignee: '@dev',
  计划提测时间: '2026-08-08',
  计划上线时间: '2026-08-09',
};

const TEST_SUBMISSION_FIELDS = {
  代码评审与自测结论: '通过',
  提测日期: '2026-08-07',
  研发Assignee: '@dev',
  可测试版本或环境: 'test-v1',
  测试说明: '说明',
};

function evidenceLines(kind: string): string[] {
  if (kind === 'deployment-evidence') return ['mode: automation', 'capability: jenkins-deploy', 'job: oa-service', 'branch: feature/42', 'environment: test', 'build: 123', 'version: test-v1', 'verification: smoke-pass'];
  if (kind === 'mr-review') return ['outcome: passed', 'method: mr-review-lite', 'high-findings: none'];
  return [];
}

function receiptNote(kind: string, id = '99', evidence = evidenceLines(kind)) {
  const sha256 = 'a'.repeat(64);
  return {
    id,
    observedAt: '2026-08-12T10:00:00Z',
    body: `<!-- glab-flow:artifact-receipt:v1\nkind: ${kind}\nsource: .glab-flow/42/${kind}.md\nsha256: ${sha256}\n${evidence.join('\n')}\n-->`,
  };
}

function withArtifactContext(artifactContext: NonNullable<TransitionInput['artifactContext']>): Pick<TransitionInput, 'artifactContext'> {
  const notes = [
    ...(artifactContext.issueNotes ?? []),
    ...(artifactContext.mergeRequests ?? []).flatMap((mr) => mr.notes),
  ];
  const artifactManifest = notes.reduce<NonNullable<TransitionInput['artifactContext']>['artifactManifest']>((manifest, note) => {
    const kind = note.body.match(/^kind: ([a-z-]+)$/m)?.[1];
    const source = note.body.match(/^source: (.+)$/m)?.[1];
    const sha256 = note.body.match(/^sha256: (.+)$/m)?.[1];
    return kind && source && sha256 ? { ...manifest, [kind]: { source, sha256 } } : manifest;
  }, {});
  return { artifactContext: { projectId: '3915', ...artifactContext, artifactManifest: artifactContext.artifactManifest ?? artifactManifest } };
}

function pendingReleaseReceipts() {
  return {
    issueNotes: [receiptNote('test-plan')],
    mergeRequests: [{ projectPath: 'group/api', iid: 1, notes: [receiptNote('mr-review')] }],
  };
}

describe('transition — artifact receipt gates', () => {
  it('requires data evidence profile selection when a story enters review', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::草稿中'], body: TABLE_BODY,
      ...withArtifactContext({ issueNotes: [receiptNote('proposal')] }),
    }));
    expect(r.validate.ok).toBe(false);
    expect(r.missing).toContainEqual(expect.objectContaining({ field: 'dataEvidenceProfile' }));
  });

  it('blocks 已评审→开发中 when no explicit data evidence profile is supplied', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::已评审'], body: TABLE_BODY,
      fields: DEVELOPMENT_START_FIELDS, datesConfirmed: true,
      ...withArtifactContext({ issueNotes: [receiptNote('design')] }),
    }));
    expect(r.validate.ok).toBe(false);
    expect(r.missing).toContainEqual(expect.objectContaining({ field: 'dataEvidenceProfile' }));
    expect(r.validate.reasons.join('\n')).toContain('dataEvidenceProfile');
  });

  it.each([
    {
      name: '草稿中→待评审',
      input: {
        labels: ['type::story', 'story-status::草稿中'], body: TABLE_BODY,
        ...withArtifactContext({
          dataEvidenceProfile: 'bogus' as unknown as 'standard',
          issueNotes: [receiptNote('proposal')],
        }),
      },
    },
    {
      name: '已评审→开发中',
      input: {
        labels: ['type::story', 'story-status::已评审'], body: TABLE_BODY,
        fields: DEVELOPMENT_START_FIELDS, datesConfirmed: true,
        ...withArtifactContext({
          dataEvidenceProfile: 'bogus' as unknown as 'standard',
          issueNotes: [receiptNote('design')],
        }),
      },
    },
  ])('blocks $name when the supplied data evidence profile is invalid', ({ input }) => {
    const r = runTransition(model, baseInput(input));

    expect(r.validate.ok).toBe(false);
    expect(r.plan).toBeUndefined();
    expect(r.missing).toContainEqual(expect.objectContaining({
      field: 'dataEvidenceProfile',
      hint: expect.stringContaining('无效'),
    }));
    expect(r.validate.reasons.join('\n')).toContain('standard 或 data-backed');
  });

  it('blocks 已评审→开发中 with local-only design when all fields are valid', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::已评审'], body: TABLE_BODY,
      fields: DEVELOPMENT_START_FIELDS, datesConfirmed: true,
      ...withArtifactContext({ issueNotes: [] }),
    }));
    expect(r.validate.ok).toBe(false);
    expect(r.missing.map((item) => item.field)).toContain('design');
    expect(r.plan).toBeUndefined();
    expect(r.shouldConfirm).toBe(true);
    expect(r.preview).toContain('design');
  });

  it('allows 测试中→待发布 only after the Issue test plan and every MR review are read back', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      fields: TEST_DONE_FIELDS, datesConfirmed: true,
      ...withArtifactContext({
        issueNotes: [receiptNote('test-plan')],
        mergeRequests: [
          { projectPath: 'group/api', iid: 1, notes: [receiptNote('mr-review', '100')] },
          { projectPath: 'group/web', iid: 2, notes: [receiptNote('mr-review', '101')] },
        ],
      }),
    }));
    expect(r.validate.ok).toBe(true);
    expect(r.verifiedReceipts.map((receipt) => receipt.noteId)).toEqual(['99', '100', '101']);
    expect(r.preview).toContain('已验证回执');
    expect(r.preview).toContain('Issue');
    expect(r.preview).toContain('MR group/api!1');
    expect(r.preview).toContain('MR group/web!2');
    expect(r.preview).toContain('source=.glab-flow/42/test-plan.md');
    expect(r.preview).toContain(`sha256=${'a'.repeat(64)}`);
    expect(r.preview).toContain('observedAt=2026-08-12T10:00:00Z');
  });

  it('blocks 测试中→待发布 when one supplied MR lacks a review receipt', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      fields: TEST_DONE_FIELDS, datesConfirmed: true,
      ...withArtifactContext({
        issueNotes: [receiptNote('test-plan')],
        mergeRequests: [
          { projectPath: 'group/api', iid: 1, notes: [receiptNote('mr-review')] },
          { projectPath: 'group/web', iid: 2, notes: [] },
        ],
      }),
    }));
    expect(r.validate.ok).toBe(false);
    expect(r.missing.map((item) => item.field)).toContain('mr-review:group/web!2');
    expect(r.preview).toContain('mr-review:group/web!2');
  });

  it('requires data evidence only for data-backed designs', () => {
    const common = {
      labels: ['type::story', 'story-status::已评审'], body: TABLE_BODY,
      fields: DEVELOPMENT_START_FIELDS, datesConfirmed: true,
      issueNotes: [receiptNote('design')],
    };
    const standard = runTransition(model, baseInput({
      ...common,
      ...withArtifactContext({ dataEvidenceProfile: 'standard', issueNotes: common.issueNotes }),
    }));
    const dataBacked = runTransition(model, baseInput({
      ...common,
      ...withArtifactContext({ dataEvidenceProfile: 'data-backed', issueNotes: common.issueNotes }),
    }));
    expect(standard.validate.ok).toBe(true);
    expect(dataBacked.validate.ok).toBe(false);
    expect(dataBacked.missing.map((item) => item.field)).toContain('data-evidence');
  });

  it('allows data-backed designs after design and data-evidence receipts are read back', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::已评审'], body: TABLE_BODY,
      fields: DEVELOPMENT_START_FIELDS, datesConfirmed: true,
      ...withArtifactContext({
        dataEvidenceProfile: 'data-backed',
        issueNotes: [receiptNote('design'), receiptNote('data-evidence')],
      }),
    }));
    expect(r.validate.ok).toBe(true);
    expect(r.verifiedReceipts.map((receipt) => receipt.kind)).toEqual(['design', 'data-evidence']);
  });

  it('blocks 已评审→开发中 when the read-back design source or hash is stale against the local manifest', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::已评审'], body: TABLE_BODY,
      fields: DEVELOPMENT_START_FIELDS, datesConfirmed: true,
      ...withArtifactContext({
        dataEvidenceProfile: 'standard',
        issueNotes: [receiptNote('design')],
        artifactManifest: { design: { source: '.glab-flow/42/spec/design.md', sha256: 'b'.repeat(64) } },
      }),
    }));
    expect(r.validate.ok).toBe(false);
    expect(r.missing).toContainEqual(expect.objectContaining({ field: 'artifactManifest.design' }));
    expect(r.verifiedReceipts).toEqual([]);
  });

  it('requires deployment evidence only when the active playbook includes Jenkins', () => {
    const common = {
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY,
      fields: TEST_SUBMISSION_FIELDS, datesConfirmed: true,
    };
    const withoutJenkins = runTransition(model, baseInput(common));
    const withJenkins = runTransition(model, baseInput({
      ...common, config: { jenkins: true }, ...withArtifactContext({ issueNotes: [] }),
    }));
    expect(withoutJenkins.validate.ok).toBe(true);
    expect(withJenkins.validate.ok).toBe(false);
    expect(withJenkins.missing.map((item) => item.field)).toContain('deployment-evidence');
  });

  it('allows Jenkins-active submission after deployment evidence is read back', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY,
      fields: TEST_SUBMISSION_FIELDS, datesConfirmed: true, config: { jenkins: true },
      ...withArtifactContext({ issueNotes: [receiptNote('deployment-evidence')] }),
    }));
    expect(r.validate.ok).toBe(true);
    expect(r.verifiedReceipts.map((receipt) => receipt.kind)).toEqual(['deployment-evidence']);
  });

  it('blocks Jenkins-active submission with incomplete deployment evidence', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY,
      fields: TEST_SUBMISSION_FIELDS, datesConfirmed: true, config: { jenkins: true },
      ...withArtifactContext({ issueNotes: [receiptNote('deployment-evidence', '98', ['mode: automation'])] }),
    }));
    expect(r.validate.ok).toBe(false);
    expect(r.missing.map((item) => item.field)).toContain('deployment-evidence');
  });

  it('blocks G14 when an MR review receipt has a rejected outcome', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      fields: TEST_DONE_FIELDS, datesConfirmed: true,
      ...withArtifactContext({
        issueNotes: [receiptNote('test-plan')],
        mergeRequests: [{ projectPath: 'group/api', iid: 1, notes: [receiptNote('mr-review', '98', ['outcome: failed', 'method: mr-review-lite', 'high-findings: none'])] }],
      }),
    }));
    expect(r.validate.ok).toBe(false);
    expect(r.missing.map((item) => item.field)).toContain('mr-review:group/api!1');
  });

  it('blocks each-MR requirements when no MR targets were supplied', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      fields: TEST_DONE_FIELDS, datesConfirmed: true,
      ...withArtifactContext({ issueNotes: [receiptNote('test-plan')], mergeRequests: [] }),
    }));
    expect(r.validate.ok).toBe(false);
    expect(r.missing.map((item) => item.field)).toContain('mr-review');
  });

  it('keeps transitions without receipt requirements valid', () => {
    const r = runTransition(model, baseInput({
      type: 'bug', labels: ['type::bug', 'status::已确认缺陷'], body: TABLE_BODY,
    }));
    expect(r.validate.ok).toBe(true);
    expect(r.verifiedReceipts).toEqual([]);
  });
});

describe('transition — dirty detection', () => {
  it('flags 0 status labels', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story'] }));
    expect(r.dirty).toBe(true);
    expect(r.validate.ok).toBe(false);
    expect(r.preview).toContain('脏状态');
  });
  it('flags ≥2 status labels', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中', 'story-status::待发布'] }));
    expect(r.dirty).toBe(true);
  });
  it('flags closed but non-terminal node', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::待发布'], state: 'closed' }));
    expect(r.dirty).toBe(true);
    expect(r.preview).toContain('已关闭');
  });
  it('clean open node is not dirty', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'] }));
    expect(r.dirty).toBe(false);
  });
});

describe('transition — assignee resolution', () => {
  it('resolves assignee from 交付协同 table (测试中→待发布, role=研发)', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: TEST_DONE_FIELDS, datesConfirmed: true }));
    expect(r.dirty).toBe(false);
    expect(r.prefilled.assigneeUser).toContain('@dev');
    expect(r.prefilled.assigneeUser).toContain('交付协同表');
    expect(r.payload?.assigneeUser).toBe('@dev');
  });
  it('falls back to config.roles when no table', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], fields: TEST_DONE_FIELDS, datesConfirmed: true,
      config: { roles: { 研发: '@devrole', 测试: '@qarole' } },
    }));
    expect(r.payload?.assigneeUser).toBe('@devrole');
    expect(r.prefilled.assigneeUser).toContain('config.roles');
  });
  it('auto-prefixes @ when user given without it', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: TEST_DONE_FIELDS, datesConfirmed: true, assigneeUser: 'dev' }));
    expect(r.payload?.assigneeUser).toBe('@dev');
    expect(r.prefilled.assigneeUser).toContain('输入');
  });
  it('reports missing assignee when none resolvable (bug, no table/roles/input)', () => {
    const r = runTransition(model, baseInput({ type: 'bug', labels: ['type::bug', 'status::测试中'], fields: { ...TEST_DONE_FIELDS }, datesConfirmed: true }));
    expect(r.missing.some((m) => m.field === 'assigneeUser')).toBe(true);
    expect(r.validate.ok).toBe(false);
  });
});

describe('transition — G11 normalization flows through', () => {
  const f = (val: string) => runTransition(model, baseInput({
    labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
    fields: { 测试完成日期: '2026-08-07', 测试Assignee: '@qa', 测试结论: '通过', 回归范围或证据: 'r', 阻塞发布问题均已验证通过: val, feature分支MR评审结论: '通过，无 HIGH 残留' },
    datesConfirmed: true, ...withArtifactContext(pendingReleaseReceipts()),
  }));
  it('accepts 已验证', () => expect(f('已验证').validate.ok).toBe(true));
  it('accepts 是(无阻塞)', () => expect(f('是(无阻塞)').validate.ok).toBe(true));
  it('rejects 否', () => expect(f('否').validate.ok).toBe(false));
});

describe('transition — missing fields carry hints', () => {
  it('hints each missing required field (测试中→待发布)', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: {}, datesConfirmed: true }));
    const fields = r.missing.map((m) => m.field);
    expect(fields).toContain('测试完成日期');
    expect(fields).toContain('阻塞发布问题均已验证通过');
    expect(r.missing.find((m) => m.field === '阻塞发布问题均已验证通过')?.hint).toMatch(/是 \/ 已验证/);
  });
  it('hints 上线清单 on 测试说明 (开发中→测试中)', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY, fields: {}, datesConfirmed: true }));
    expect(r.next).toBe('测试中');
    expect(r.missing.find((m) => m.field === '测试说明')?.hint).toMatch(/上线步骤与配置清单/);
  });
  it('requires feature MR review before 待发布 (blocks when missing)', () => {
    const fieldsWithoutMR = { ...TEST_DONE_FIELDS };
    delete (fieldsWithoutMR as Record<string, string>).feature分支MR评审结论;
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: fieldsWithoutMR, datesConfirmed: true }));
    expect(r.validate.ok).toBe(false);
    expect(r.missing.find((m) => m.field === 'feature分支MR评审结论')?.hint).toMatch(/MR 代码评审/);
  });
});

describe('transition — plan + preview + shouldConfirm', () => {
  it('builds forward plan when valid and previews the change', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: TEST_DONE_FIELDS, datesConfirmed: true, ...withArtifactContext(pendingReleaseReceipts()) }));
    expect(r.validate.ok).toBe(true);
    expect(r.plan?.ops.some((o) => o.kind === 'add_label')).toBe(true);
    expect(r.plan?.ops.some((o) => o.kind === 'remove_label')).toBe(true);
    expect(r.preview).toContain('测试中 → 待发布');
  });
  it('does not build plan when invalid', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: {}, datesConfirmed: true }));
    expect(r.validate.ok).toBe(false);
    expect(r.plan).toBeUndefined();
  });
  it('semi-auto always confirms', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: TEST_DONE_FIELDS, datesConfirmed: true, runMode: 'semi-auto' }));
    expect(r.shouldConfirm).toBe(true);
  });
  it('full-auto skips confirm when ok and not hardGate', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: TEST_DONE_FIELDS, datesConfirmed: true, runMode: 'full-auto', ...withArtifactContext(pendingReleaseReceipts()) }));
    expect(r.validate.ok).toBe(true);
    expect(r.shouldConfirm).toBe(false);
  });
  it('full-auto still confirms hardGate (待发布→生产验收中)', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::待发布'], body: TABLE_BODY,
      fields: { 发布日期: '2026-08-07', 研发Assignee: '@dev', 生产版本: 'v1', 发布记录或回滚信息: 'rec' },
      datesConfirmed: true, humanConfirmed: true, runMode: 'full-auto', ...withArtifactContext({ issueNotes: [receiptNote('release-plan')] }),
    }));
    expect(r.validate.ok).toBe(true);
    expect(r.shouldConfirm).toBe(true);
  });
  it('full-auto confirms when !ok (gap)', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: {}, datesConfirmed: true, runMode: 'full-auto' }));
    expect(r.shouldConfirm).toBe(true);
  });
});

describe('transition — default next node when to omitted', () => {
  it('picks the default forward transition', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::草稿中'], body: TABLE_BODY, fields: {} }));
    expect(r.next).toBe('待评审');
  });
  it('returns no transition when explicit to has no match', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::草稿中'], body: TABLE_BODY, to: '不存在节点' }));
    expect(r.validate.ok).toBe(false);
    expect(r.preview).toContain('无可用转换');
  });
});

describe('transition — per-transition side-effect playbook', () => {
  it('提测 bundles commit/merge/jenkins + issue writeback when config present', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY, fields: {}, datesConfirmed: true,
      config: { deployBranch: 'test', jenkins: true },
    }));
    expect(r.next).toBe('测试中');
    expect(r.playbook.map((s) => s.action)).toEqual(['commit_push_feature', 'merge_to_deploy_branch', 'trigger_jenkins', 'issue_writeback']);
    expect(r.playbook[r.playbook.length - 1]?.isWriteback).toBe(true);
  });
  it('提测 filters out merge/jenkins when config absent', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY, fields: {}, datesConfirmed: true,
    }));
    expect(r.playbook.map((s) => s.action)).toEqual(['commit_push_feature', 'issue_writeback']);
  });
  it('发布 = 执行上线 deploy + issue writeback（生产 deploy 无条件，手动也推进 Issue）', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::待发布'], body: TABLE_BODY,
      fields: { 发布日期: '2026-08-07', 研发Assignee: '@dev', 生产版本: 'v1', 发布记录或回滚信息: 'rec' },
      datesConfirmed: true, humanConfirmed: true,
    }));
    expect(r.next).toBe('生产验收中');
    expect(r.playbook.map((s) => s.action)).toEqual(['deploy', 'issue_writeback']);
    expect(r.shouldConfirm).toBe(true);
  });
  it('测试中→待发布 准备发布：create_mr + mr_review + release_check + issue writeback', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      fields: { ...TEST_DONE_FIELDS }, datesConfirmed: true,
    }));
    expect(r.next).toBe('待发布');
    expect(r.playbook.map((s) => s.action)).toEqual(['create_mr_to_master', 'mr_review', 'release_check', 'issue_writeback']);
  });
  it('transitions without declared playbook default to issue_writeback only', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::草稿中'], body: TABLE_BODY, fields: {} }));
    expect(r.next).toBe('待评审');
    expect(r.playbook.map((s) => s.action)).toEqual(['issue_writeback']);
  });
  it('preview lists code-side actions when present', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY, fields: {}, datesConfirmed: true,
      config: { deployBranch: 'test', jenkins: true },
    }));
    expect(r.preview).toContain('动作包');
    expect(r.preview).toContain('合并 feature → deploy_branch');
  });
});

describe('transition — node progress checklist (layer 2 visibility)', () => {
  it('surfaces 开发中 sub-steps in nodeProgress and preview', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY, fields: {}, datesConfirmed: true }));
    expect(r.nodeProgress).toEqual(['技术方案', '编码实现', '自测', '代码评审']);
    expect(r.preview).toContain('当前节点子步骤');
    expect(r.preview).toContain('代码评审');
  });
  it('surfaces 草稿中 sub-steps (entry node)', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::草稿中'], body: TABLE_BODY, fields: {} }));
    expect(r.next).toBe('待评审');
    expect(r.nodeProgress).toEqual(['需求澄清', '六清楚草稿']);
  });
});

describe('transition — evidence smart prefill', () => {
  const NOTE = '## 状态变更\n- 测试完成日期：2026-08-05\n- 测试结论：通过\n- 回归范围或证据：回归通过\n';
  const rest = { 测试Assignee: '@qa', 阻塞发布问题均已验证通过: '是', feature分支MR评审结论: '通过' };

  it('prefills required fields from note "- 字段：值" lines', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      notes: [{ body: NOTE }], fields: rest, datesConfirmed: true, ...withArtifactContext(pendingReleaseReceipts()),
    }));
    expect(r.payload?.fields.测试完成日期).toBe('2026-08-05');
    expect(r.prefilled.测试完成日期).toContain('2026-08-05');
    expect(r.prefilled.测试完成日期).toContain('评论');
    expect(r.missing.map((m) => m.field)).not.toContain('测试完成日期');
    expect(r.validate.ok).toBe(true);
  });
  it('user-provided fields take priority over evidence', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      notes: [{ body: NOTE }], fields: { ...rest, 测试完成日期: '2026-08-09' }, datesConfirmed: true,
    }));
    expect(r.payload?.fields.测试完成日期).toBe('2026-08-09');
    expect(r.prefilled.测试完成日期).toBeUndefined();
  });
  it('skips 待确认 placeholder values in notes', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      notes: [{ body: '## 状态变更\n- 测试完成日期：待确认\n' }], fields: rest, datesConfirmed: true,
    }));
    expect(r.payload?.fields.测试完成日期).toBeUndefined();
    expect(r.missing.map((m) => m.field)).toContain('测试完成日期');
  });
});
