import { parse as parseYaml } from 'yaml';

/**
 * test-config(独立于交付配置 config.md):
 *   本配置统一承载环境上下文：脚本运行根、仓库→Apifox 项目映射(可选索引)、数据库 MCP、
 *   前端构建、测试数据策略、测试账号。
 * 消费方:glab-flow 开发中自测 / 测试中(test-flow 用 .claude/project-config.md,互不相干)。
 */

export interface ApifoxProjectRef {
  projectId: string;
  branch: string;
  /** 环境名(如 local/test) → Apifox 环境 ID。 */
  envs: Record<string, string>;
}

export interface RouteRule {
  /** 命中任一仓库即走此 route(与 --repos 求交集)。 */
  repos: string[];
  apifox?: string;
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
  /** 索引:apifox_projects 里的项目名 + 环境名;base_url 不复制,以 Apifox 为准。仅声明 Apifox 资产时必需。 */
  apifox?: { project: string; env: string };
  /** databases 键名 → config.md databases 的引用(只存键,连接信息在交付配置)。 */
  databases?: Record<string, string>;
  frontend?: { build?: string; workdir?: string; output?: string };
  testData?: TestDataConfig;
  /** account/password 为值;vars 为场景变量名映射({{名}})——运行时按名注入,不落 Apifox。 */
  credentials?: { account?: string; password?: string; vars?: { account?: string; password?: string } };
  /** 全局登录契约(共用 PHP 登录):哪个项目持有登录接口、token 变量名、注入方式。 */
  login?: { owner: string; endpoint?: string; tokenVar?: string; note?: string };
  /** 前端入口 url(E2E 浏览器测试用;API base 以 Apifox 环境为准)。 */
  webUrl?: string;
  /** 本地/测试环境脚本运行上下文；脚本文件由 test-plan 的 script 行声明。 */
  scripts?: ScriptRuntimeConfig;
  desc?: string;
}

export interface TestConfig {
  environments: Record<string, TestEnvironmentProfile>;
  apifoxProjects: Record<string, ApifoxProjectRef>;
  routes: RouteRule[];
}

/** 一个 Apifox 测试目标(routes 推导;跨平台+Java 需求会有多个,逐项目跑)。 */
export interface ApifoxTarget {
  project: string;
  projectId: string;
  branch: string;
  envName: string;
  envId: string | undefined;
}

export interface TestContext {
  env: string;
  /** 兼容字段:单项目时等于 apifoxTargets[0](既有消费者不破)。 */
  apifox?: ApifoxTarget;
  /** 全部命中项目(多仓跨项目需求逐个跑;单项目时长度 1)。 */
  apifoxTargets: ApifoxTarget[];
  databases: Record<string, string>;
  frontend: { build?: string; workdir?: string; output?: string };
  testData: TestDataConfig;
  credentials: { account?: string; password?: string; vars?: { account?: string; password?: string } };
  login?: { owner: string; endpoint?: string; tokenVar?: string; note?: string };
  webUrl?: string;
  scripts: ScriptRuntimeConfig;
  /** routes 推导说明(哪些仓库命中/未命中),供 Leader 展示决策依据。 */
  resolution: { repos: string[]; matchedRoutes: string[]; unmatchedRepos: string[]; scriptOnlyRoutes: string[] };
  warnings: string[];
}

interface RawTestConfig {
  environments?: Record<string, {
    apifox?: { project?: string; env?: string };
    databases?: Record<string, string>;
    frontend?: { build?: string; workdir?: string; output?: string };
    test_data?: { prefix?: string; cleanup_required?: boolean; prohibited?: string[]; seed_files?: string[]; asset_retention?: string; realistic_naming?: boolean };
    credentials?: { account?: string; password?: string; vars?: { account?: string; password?: string } };
    login?: { owner?: string; endpoint?: string; token_var?: string; note?: string };
    web_url?: string;
    scripts?: { root?: string; command?: string; env_file?: string; variables?: Record<string, string | number | boolean> };
    desc?: string;
  }>;
  apifox_projects?: Record<string, {
    project_id?: string | number;
    branch?: string;
    envs?: Record<string, string | number>;
  }>;
  routes?: Array<{ repos?: string[]; apifox?: string }>;
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
    if (env?.apifox && (!env.apifox.project || !env.apifox.env)) throw new Error(`test-config: environments.${name}.apifox 缺 {project, env} 索引`);
    environments[name] = {
      ...(env.apifox?.project && env.apifox.env ? { apifox: { project: env.apifox.project, env: env.apifox.env } } : {}),
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

  const apifoxProjects: Record<string, ApifoxProjectRef> = {};
  for (const [name, project] of Object.entries(raw.apifox_projects ?? {})) {
    if (!project?.project_id) throw new Error(`test-config: apifox_projects.${name} 缺 project_id`);
    apifoxProjects[name] = {
      projectId: String(project.project_id),
      branch: project.branch?.trim() || 'main',
      envs: Object.fromEntries(
        Object.entries(project.envs ?? {}).map(([envName, id]) => [envName, String(id)]),
      ),
    };
  }

  const routes: RouteRule[] = (raw.routes ?? [])
    .filter((route) => route?.repos?.length)
    .map((route) => ({ repos: route.repos!, ...(route.apifox ? { apifox: route.apifox } : {}) }));

  if (!Object.keys(environments).length) throw new Error('test-config: environments 为空——至少配置一个环境 Profile');
  return { environments, apifoxProjects, routes };
}

/** routes 按仓库命中推导 Apifox 项目;未命中的仓库进 warnings(不阻断,由 Leader/用户裁决)。 */
function resolveApifoxProject(config: TestConfig, repos: string[]): { project: string | undefined; matchedRoutes: string[]; unmatchedRepos: string[]; scriptOnlyRoutes: string[] } {
  const matched = new Set<string>();
  const scriptOnly = new Set<string>();
  const unmatched: string[] = [];
  for (const repo of repos) {
    const rule = config.routes.find((route) => route.repos.includes(repo));
    if (rule?.apifox) matched.add(rule.apifox);
    else if (rule) scriptOnly.add(repo);
    else unmatched.push(repo);
  }
  const projects = [...matched];
  return { project: projects.length === 1 ? projects[0] : undefined, matchedRoutes: projects, unmatchedRepos: unmatched, scriptOnlyRoutes: [...scriptOnly] };
}

/**
 * 组装完备测试上下文(--repos 命中 routes 推 Apifox 项目 → 环境 Profile → 拼库/前端/凭据/测试数据)。
 * `{iid}` 占位在 prefix 中替换。多项目命中/未命中仓库/环境 ID 缺失 → warnings,不阻断输出。
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

  const resolution = resolveApifoxProject(config, input.repos);
  if (resolution.matchedRoutes.length > 1) {
    warnings.push(`改动仓库命中 ${resolution.matchedRoutes.length} 个 Apifox 项目(${resolution.matchedRoutes.join(', ')})——apifoxTargets 含全部,逐项目跑`);
  }
  if (resolution.unmatchedRepos.length) {
    warnings.push(`仓库 ${resolution.unmatchedRepos.join(', ')} 未命中任何 route,不参与 Apifox 项目推导`);
  }
  if (resolution.scriptOnlyRoutes.length) {
    warnings.push(`仓库 ${resolution.scriptOnlyRoutes.join(', ')} 命中脚本测试路由,不推导 Apifox 项目`);
  }

  // 项目集 = routes 命中的全部(跨平台+Java 需求逐项目跑);未命中时回落 Profile 默认单项目。
  const projectNames = resolution.matchedRoutes.length ? resolution.matchedRoutes : profile.apifox ? [profile.apifox.project] : [];
  if (!resolution.matchedRoutes.length && profile.apifox) {
    warnings.push(`routes 未能从 [${input.repos.join(', ')}] 推导出项目,已回落到环境 Profile 默认 "${profile.apifox.project}"`);
  }
  const apifoxTargets = projectNames.map<ApifoxTarget>((name) => {
    const project = config.apifoxProjects[name];
    if (!project) {
      warnings.push(`apifox_projects 缺 "${name}"——请在 test-config 补齐项目索引`);
      return { project: name, projectId: '', branch: 'main', envName: profile.apifox?.env ?? input.env, envId: undefined };
    }
    const envName = profile.apifox?.env ?? input.env;
    const envId = project.envs[envName];
    // M1：envId 解析不到必须显式警告——静默 undefined 会让 -e 拼出空值或回落默认环境，
    // 「test 轮」实跑 local。文档承诺「报错退出」，此处先以高可见警告 + CLI 侧缺失计数兜底。
    if (!envId) {
      warnings.push(`环境 "${input.env}" 的 apifox_projects.${name}.envs.${envName} 缺环境 ID——继续执行会拼出 -e undefined 或回落项目默认环境（可能是 local），请在 test-config 补齐后再跑`);
    }
    return { project: name, projectId: project.projectId, branch: project.branch, envName, envId };
  });

  const testData = { ...profile.testData };
  if (testData.prefix && input.iid !== undefined) {
    testData.prefix = replaceRuntimePlaceholders(testData.prefix, input);
  }
  if (testData.seedFiles) testData.seedFiles = testData.seedFiles.map((item) => replaceRuntimePlaceholders(item, input));

  return {
    env: input.env,
    ...(apifoxTargets[0] ? { apifox: apifoxTargets[0] } : {}),
    apifoxTargets,
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
    resolution: { repos: input.repos, matchedRoutes: resolution.matchedRoutes, unmatchedRepos: resolution.unmatchedRepos, scriptOnlyRoutes: resolution.scriptOnlyRoutes },
    warnings,
  };
}
