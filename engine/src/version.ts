import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

/** 引擎能力版本——每合入改变流转契约的功能时 +1；Skill 侧声明兼容下限。 */
export const ENGINE_CAPABILITY_VERSION = 1;

export interface RuntimeVersion {
  /** 本地 HEAD 短 SHA;git 不可用时为 'unknown'。 */
  commit: string;
  /** 本地 HEAD 与 origin/master 是否一致(true=最新,false=落后或无法比较)。 */
  upToDate: boolean;
  /** origin/master 短 SHA;不可达时为空。 */
  remoteCommit: string;
  /** 引擎能力版本(静态,随代码走)。 */
  capability: number;
  /** 判定过程说明,供 Leader 展示。 */
  notes: string[];
}

function git(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

function pkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 检测运行时副本版本(issue 22):本地 HEAD vs origin/master。
 * 纯读——fetch 不在此做(引擎零网络),由 Skill 侧启动时先 `git fetch origin` 再调本命令;
 * 未 fetch 时只比较本地已知的 origin/master ref,拿不到就报 '无法比较' 而非假装最新。
 */
export function checkRuntimeVersion(fetched: boolean): RuntimeVersion {
  const notes: string[] = [`pkg=${pkgVersion()}`, `capability=v${ENGINE_CAPABILITY_VERSION}`];
  const commit = git(['rev-parse', '--short', 'HEAD']) ?? 'unknown';
  if (commit === 'unknown') {
    notes.push('git 不可用(非 git 分发或 git 缺失)——无法自动判定更新；当前包仍可运行,请用发布版本或 capability 人工核对');
    return { commit, upToDate: false, remoteCommit: '', capability: ENGINE_CAPABILITY_VERSION, notes };
  }
  notes.push(`HEAD=${commit}`);

  // 优先比较本地 origin/master(上次 fetch 的快照);fetch 后即为最新远端状态。
  let remote = git(['rev-parse', '--short', 'origin/master']);
  if (remote) {
    notes.push(`origin/master=${remote}${fetched ? '(刚 fetch)' : '(本地缓存,可能陈旧)'}`);
    const base = git(['merge-base', 'HEAD', 'origin/master']);
    const headFull = git(['rev-parse', 'HEAD']);
    const remoteFull = git(['rev-parse', 'origin/master']);
    const behind = git(['rev-list', '--count', 'HEAD..origin/master']);
    if (headFull && remoteFull && headFull === remoteFull) {
      return { commit, upToDate: true, remoteCommit: remote, capability: ENGINE_CAPABILITY_VERSION, notes };
    }
    if (base && behind && Number(behind) > 0) {
      notes.push(`本地落后 origin/master ${behind} 个提交——运行时副本陈旧，下游契约可能失效`);
      return { commit, upToDate: false, remoteCommit: remote, capability: ENGINE_CAPABILITY_VERSION, notes };
    }
    // 本地领先(未推送的提交)或分叉:本地包含远端全部内容,视为可用但提示。
    notes.push('本地未落后 origin/master(可能领先/含未推送提交)');
    return { commit, upToDate: true, remoteCommit: remote, capability: ENGINE_CAPABILITY_VERSION, notes };
  }

  if (!existsSync(join(REPO_ROOT, '.git'))) {
    notes.push('非 git 安装(如复制分发)——无法自动检测更新,请人工确认版本');
  } else if (!fetched) {
    notes.push('无 origin/master ref 且未 fetch——请先 git fetch origin 再跑 version');
  } else {
    notes.push('fetch 后仍无 origin/master——远端不可达或未配置 remote');
  }
  return { commit, upToDate: false, remoteCommit: '', capability: ENGINE_CAPABILITY_VERSION, notes };
}
