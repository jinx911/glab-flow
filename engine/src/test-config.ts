import { parse as parseYaml } from 'yaml';

/**
 * test-config(独立于交付配置 config.md):
 *   本配置统一承载环境上下文：脚本运行根、仓库路由、数据库 MCP、前端构建、
 *   测试数据策略、测试账号。
 * 消费方:glab-flow 开发中自测 / 测试中(test-flow 用 .claude/project-config.md,互不相干)。
 */

export interface RouteRule {
  /** 命中任一仓库即走此 route(与 --repos 求交集)。 */
  repos: string[];
  target?: string;
}

export interface ScriptRuntimeConfig {
  root?: string;
  command?: string;
  envFile?: string;
  variables?: Record<string, string>;
}

export interface TestDataConfig {
  prefix?: string;
  cleanupRequired?: boolean;
  prohibited?: string[];
  seedFiles?: string[];
  assetRetention?: 'preserve' | 'promote-shared' | 'cleanup';
  realisticNaming?: boolean;
}

export interface TestEnvironmentProfile {
  /** databases 键名 → config.md databases 的引用(只存键,连接信息在交付配置)。 */
  databases?: Record<string, string>;
  frontend?: { build?: string; workdir?: string; output?: string };
  testData?: TestDataConfig;
  /** account/password 为值；vars 为脚本变量名映射——运行时按名注入，不写入 Issue 评论。 */
  credentials?: { account?: string; password?: string; vars?: { account?: string; password?: string } };
  /** 全局登录契约(共用 PHP 登录):哪个项目持有登录接口、token 变量名、注入方式。 */
  login?: { owner: string; endpoint?: string; tokenVar?: string; note?: string };
  /** 前端入口 url(E2E 浏览器测试用；API base 以 scripts.variables/env_file 注入为准)。 */
  webUrl?: string;
  /** 本地/测试环境脚本运行上下文；脚本文件由 test-plan 的 script 行声明。 */
  scripts?: ScriptRuntimeConfig;
  desc?: string;
}

export interface TestConfig {
  environments: Record<string, TestEnvironmentProfile>;
  routes: RouteRule[];
}

export interface TestContext {
  env: string;
  databases: Record<string, string>;
  frontend: { build?: string; workdir?: string; output?: string };
  testData: TestDataConfig;
  credentials: { account?: string; password?: string; vars?: { account?: string; password?: string } };
  login?: { owner: string; endpoint?: string; tokenVar?: string; note?: string };
  webUrl?: string;
  scripts: ScriptRuntimeConfig;
  /** routes 推导说明(哪些仓库命中/未命中),供 Leader 展示决策依据。 */
  resolution: { repos: string[]; matchedRoutes: string[]; unmatchedRepos: string[] };
  warnings: string[];
}

interface RawTestConfig {
  environments?: Record<string, {
    databases?: Record<string, string>;
    frontend?: { build?: string; workdir?: string; output?: string };
    test_data?: { prefix?: string; cleanup_required?: boolean; prohibited?: string[]; seed_files?: string[]; asset_retention?: string; realistic_naming?: boolean };
    credentials?: { account?: string; password?: string; vars?: { account?: string; password?: string } };
    login?: { owner?: string; endpoint?: string; token_var?: string; note?: string };
    web_url?: string;
    scripts?: { root?: string; command?: string; env_file?: string; variables?: Record<string, string | number | boolean> };
    desc?: string;
  }>;
  routes?: Array<{ repos?: string[]; target?: string }>;
}

const MANAGED_RELATIVE_PATH_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;
const TEST_DATA_RETENTIONS = new Set(['preserve', 'promote-shared', 'cleanup']);

function validateManagedRelativePath(value: string | undefined, field: string): string | undefined {
  if (!value) return undefined;
  if (!MANAGED_RELATIVE_PATH_RE.test(value)) {
    throw new Error(`test-config: ${field} 路径无效（必须是相对路径，不能以 / 开头或包含 ..）`);
  }
  return value;
}

function replaceRuntimePlaceholders(value: string, input: { env: string; iid?: number }): string {
  return value.replace('{iid}', String(input.iid ?? '{iid}')).replace('{env}', input.env);
}

function parseTestDataConfig(value: NonNullable<RawTestConfig['environments']>[string]['test_data'] | undefined, envName: string): TestDataConfig | undefined {
  if (!value) return undefined;
  if (value.asset_retention && !TEST_DATA_RETENTIONS.has(value.asset_retention)) {
    throw new Error(`test-config: environments.${envName}.test_data.asset_retention 无效（应为 preserve|promote-shared|cleanup）`);
  }
  return {
    ...(value.prefix ? { prefix: value.prefix } : {}),
    ...(typeof value.cleanup_required === 'boolean' ? { cleanupRequired: value.cleanup_required } : {}),
    ...(value.prohibited ? { prohibited: value.prohibited } : {}),
    ...(value.seed_files ? { seedFiles: value.seed_files.map((item) => validateManagedRelativePath(item, `environments.${envName}.test_data.seed_files`)!) } : {}),
    ...(value.asset_retention ? { assetRetention: value.asset_retention as TestDataConfig['assetRetention'] } : {}),
    ...(typeof value.realistic_naming === 'boolean' ? { realisticNaming: value.realistic_naming } : {}),
  };
}

export function parseTestConfig(markdown: string): TestConfig {
  const match = markdown.match(/```yaml\n([\s\S]*?)\n```/);
  if (!match?.[1]) throw new Error('test-config: no ```yaml fenced block found');
  const raw = parseYaml(match[1]) as RawTestConfig;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('test-config: yaml block is empty or invalid');

  const environments: Record<string, TestEnvironmentProfile> = {};
  for (const [name, env] of Object.entries(raw.environments ?? {})) {
    environments[name] = {
      ...(env.databases ? { databases: env.databases } : {}),
      ...(env.frontend ? { frontend: env.frontend } : {}),
      ...(env.test_data ? { testData: parseTestDataConfig(env.test_data, name) } : {}),
      ...(env.credentials
        ? {
            credentials: {
              ...(env.credentials.account ? { account: env.credentials.account } : {}),
              ...(env.credentials.password ? { password: env.credentials.password } : {}),
              ...(env.credentials.vars ? { vars: env.credentials.vars } : {}),
            },
          }
        : {}),
      ...(env.login?.owner
        ? {
            login: {
              owner: env.login.owner,
              ...(env.login.endpoint ? { endpoint: env.login.endpoint } : {}),
              ...(env.login.token_var ? { tokenVar: env.login.token_var } : {}),
              ...(env.login.note ? { note: env.login.note } : {}),
            },
          }
        : {}),
      ...(env.web_url ? { webUrl: env.web_url } : {}),
      ...(env.scripts
        ? {
            scripts: {
              ...(env.scripts.root ? { root: validateManagedRelativePath(env.scripts.root, `environments.${name}.scripts.root`) } : {}),
              ...(env.scripts.command ? { command: env.scripts.command } : {}),
              ...(env.scripts.env_file ? { envFile: validateManagedRelativePath(env.scripts.env_file, `environments.${name}.scripts.env_file`) } : {}),
              ...(env.scripts.variables ? { variables: Object.fromEntries(Object.entries(env.scripts.variables).map(([k, v]) => [k, String(v)])) } : {}),
            },
          }
        : {}),
      ...(env.desc ? { desc: env.desc } : {}),
    };
  }

  const routes: RouteRule[] = (raw.routes ?? [])
    .filter((route) => route?.repos?.length)
    .map((route) => ({ repos: route.repos!, ...(route.target ? { target: route.target } : {}) }));

  if (!Object.keys(environments).length) throw new Error('test-config: environments 为空——至少配置一个环境 Profile');
  return { environments, routes };
}

/** routes 按仓库命中测试目标；未命中的仓库进 warnings（不阻断，由 Leader/用户裁决）。 */
function resolveTestRoutes(config: TestConfig, repos: string[]): { matchedRoutes: string[]; unmatchedRepos: string[] } {
  const matched = new Set<string>();
  const unmatched: string[] = [];
  for (const repo of repos) {
    const rule = config.routes.find((route) => route.repos.includes(repo));
    if (rule) matched.add(rule.target ?? repo);
    else unmatched.push(repo);
  }
  return { matchedRoutes: [...matched], unmatchedRepos: unmatched };
}

/**
 * 组装完备测试上下文（--repos 命中 routes → 环境 Profile → 拼脚本/库/前端/凭据/测试数据）。
 * `{iid}` 占位在 prefix 中替换。未命中仓库 → warnings，不阻断输出。
 */
export function buildTestContext(
  config: TestConfig,
  input: { env: string; repos: string[]; iid?: number },
): TestContext {
  const warnings: string[] = [];
  const profile = config.environments[input.env];
  if (!profile) {
    throw new Error(`test-config: 环境 "${input.env}" 不存在;可用: ${Object.keys(config.environments).join(', ')}`);
  }

  const resolution = resolveTestRoutes(config, input.repos);
  if (resolution.unmatchedRepos.length) {
    warnings.push(`仓库 ${resolution.unmatchedRepos.join(', ')} 未命中任何测试 route，请确认是否需要新增脚本测试入口`);
  }

  const testData = { ...profile.testData };
  if (testData.prefix && input.iid !== undefined) {
    testData.prefix = replaceRuntimePlaceholders(testData.prefix, input);
  }
  if (testData.seedFiles) testData.seedFiles = testData.seedFiles.map((item) => replaceRuntimePlaceholders(item, input));

  return {
    env: input.env,
    databases: profile.databases ?? {},
    frontend: profile.frontend ?? {},
    testData,
    credentials: profile.credentials ?? {},
    ...(profile.login ? { login: profile.login } : {}),
    ...(profile.webUrl ? { webUrl: profile.webUrl } : {}),
    scripts: {
      root: replaceRuntimePlaceholders(profile.scripts?.root ?? `.glab-flow/${input.iid ?? '{iid}'}/tests`, input),
      ...(profile.scripts?.command ? { command: replaceRuntimePlaceholders(profile.scripts.command, input) } : {}),
      ...(profile.scripts?.envFile ? { envFile: replaceRuntimePlaceholders(profile.scripts.envFile, input) } : {}),
      ...(profile.scripts?.variables
        ? { variables: Object.fromEntries(Object.entries(profile.scripts.variables).map(([k, v]) => [k, replaceRuntimePlaceholders(v, input)])) }
        : {}),
    },
    resolution: { repos: input.repos, matchedRoutes: resolution.matchedRoutes, unmatchedRepos: resolution.unmatchedRepos },
    warnings,
  };
}
