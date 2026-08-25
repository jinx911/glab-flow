import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { ENGINE_CAPABILITY_VERSION, checkRuntimeVersion } from './version.js';

const REPO_ROOT = process.cwd();

function git(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

describe('checkRuntimeVersion (issue 22 运行时版本守卫)', () => {
  it('reports current commit and capability version', () => {
    const r = checkRuntimeVersion(false);
    expect(r.capability).toBe(ENGINE_CAPABILITY_VERSION);
    expect(r.capability).toBeGreaterThanOrEqual(1);
    // GitHub source ZIP 与 npm/tarball 不含 .git；这是支持的分发方式，
    // 只是不具备自动比较 origin/master 的能力。
    expect(r.commit === 'unknown' || /^[0-9a-f]{7,}$/.test(r.commit)).toBe(true);
    expect(Array.isArray(r.notes)).toBe(true);
    expect(r.notes.some((n) => n.includes('capability'))).toBe(true);
  });

  it('detects behind when local HEAD is behind origin/master', () => {
    // 构造真实落后态:用已存在的旧提交(仓库首个提交)检出临时分支的模拟成本高,
    // 直接用 rev-list 语义验证——当前 HEAD..origin/master 若 >0 必须报 behind。
    const behind = git(['rev-list', '--count', 'HEAD..origin/master']);
    const r = checkRuntimeVersion(true);
    if (behind !== undefined && Number(behind) > 0) {
      expect(r.upToDate).toBe(false);
      expect(r.notes.some((n) => n.includes('落后'))).toBe(true);
    } else {
      // 本地未落后(同步后的常态):要么 upToDate,要么无法比较(绝不假装最新)
      if (r.remoteCommit) expect(r.upToDate).toBe(true);
      else expect(r.notes.some((n) => n.includes('无法') || n.includes('不可达') || n.includes('未配置'))).toBe(true);
    }
  });

  it('never claims up-to-date when remote ref is unavailable', () => {
    // 无 origin/master 场景在单测仓不可直接构造;验证语义:remoteCommit 为空时 upToDate 必为 false
    const r = checkRuntimeVersion(false);
    if (!r.remoteCommit) expect(r.upToDate).toBe(false);
  });
});
