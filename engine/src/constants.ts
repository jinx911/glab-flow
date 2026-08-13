import type { IssueType } from './types.js';

/**
 * 状态标签的单一事实来源——引擎内所有拼/识别状态标签的地方都走这里，
 * 避免 `transition.ts`/`guard.ts`/`model.ts`/`plan.ts` 各写一遍造成漂移。
 */

/** 状态标签前缀（带 `::`），用于 `startsWith` 识别与 `slice` 取节点名。 */
export const STATUS_PREFIX: Record<IssueType, string> = { story: 'story-status::', bug: 'status::' };

/** 状态标签命名空间（不带 `::`），用于拼 `${ns}::${node}` 这类 label 字面量。 */
export const STATUS_NAMESPACE: Record<IssueType, string> = { story: 'story-status', bug: 'status' };

/** 终态节点集合。 */
export const TERMINAL: ReadonlySet<string> = new Set(['已完成']);

/** 角色名集合（角色名不是具体 GitLab 用户）。 */
export const ROLES: ReadonlySet<string> = new Set(['产品', '研发', '测试']);
