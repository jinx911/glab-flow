import { describe, expect, it } from 'vitest';
import { progressCommand, stateReceiptCommand, stateWritebackCommand } from './cli-commands.js';
import { initState } from './state.js';
import type { ArtifactReceipt } from './types.js';

const base = initState({ iid: '1', type: 'story', host: 'h', projectId: '1', workspaceRoot: '/r', now: 't0' });
const designReceipt: ArtifactReceipt = {
  kind: 'design', target: { kind: 'issue', projectId: '1', iid: 1 }, source: '.glab-flow/1/spec/design.md', sha256: 'design-sha', noteId: '9', observedAt: 't1',
};

describe('CLI state command handlers', () => {
  it('uses state-receipt output as progress input and returns bare state on success', () => {
    const withReceipt = stateReceiptCommand({ state: base, receipt: designReceipt, now: 't1' });
    const output = progressCommand({ state: { ...withReceipt, progress: { node: '已评审', done: [] } }, step: '技术方案 design.md', now: 't2' });
    expect(output).toMatchObject({ progress: { node: '已评审', done: ['技术方案 design.md'] }, artifactReceipts: [designReceipt] });
    expect(output).not.toHaveProperty('ok');
  });

  it('returns the state-writeback state directly', () => {
    const output = stateWritebackCommand({
      state: base,
      audit: { target: 'issue', stage: 'metadata', status: 'succeeded', detail: 'labels read back' },
      now: 't1',
    });
    expect(output.writebackAudit).toEqual([{ target: 'issue', stage: 'metadata', status: 'succeeded', detail: 'labels read back', at: 't1' }]);
  });

  it('returns a structured receipt failure from progress', () => {
    const output = progressCommand({ state: base, step: '测试计划', now: 't1' });
    expect(output).toEqual({
      ok: false,
      error: { code: 'missing_artifact_receipt', required: 'test-plan', step: '测试计划' },
      state: base,
    });
  });

  it('resumes legacy persisted state through CLI commands with new fields defaulted', () => {
    const legacy = { ...base } as Partial<typeof base>;
    delete legacy.artifactReceipts;
    delete legacy.writebackAudit;
    delete legacy.dataEvidenceProfile;
    const resumed = progressCommand({ state: legacy as typeof base, resetToNode: '开发中', now: 't1' });
    expect(resumed).toMatchObject({ progress: { node: '开发中', done: [] }, artifactReceipts: [], writebackAudit: [] });
    expect(progressCommand({ state: legacy as typeof base, now: 't1' })).toMatchObject({ artifactReceipts: [], writebackAudit: [] });
    expect(stateReceiptCommand({ state: legacy as typeof base, receipt: designReceipt, now: 't1' }).artifactReceipts).toEqual([designReceipt]);
    expect(stateWritebackCommand({ state: legacy as typeof base, audit: { target: 'issue', stage: 'metadata', status: 'succeeded', detail: 'read back' }, now: 't1' }).writebackAudit).toHaveLength(1);
  });
});
