import { parse as parseYaml } from 'yaml';

/**
 * test-config(独立于交付配置 config.md):
 *   Apifox 是测试资产的事实源(base_url/接口/用例/套件/报告),本配置只承载 Apifox 不知道的——
 *   仓库→Apifox 项目映射(索引)、项目名→ID、数据库 MCP、前端构建、测试数据策略、测试账号。
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
  apifox: string;
}

export interface TestEnvironmentProfile {
  /** 索引:apifox_projects 里的项目名 + 环境名;base_url 不复制,以 Apifox 为准。 */
  apifox: { project: string; env: string };
  /** databases 键名 → config.md databases 的引用(只存键,连接信息在交付配置)。 */
  databases?: Record<string, string>;
  frontend?: { build?: string; workdir?: string; output?: string };
  testData?: { prefix?: string; cleanupRequired?: boolean; prohibited?: string[] };
  credentials?: { account?: string; password?: string };
  /** 前端入口 url(E2E 浏览器测试用;API base 以 Apifox 环境为准)。 */
  webUrl?: string;
  desc?: string;
}

export interface TestConfig {
  environments: Record<string, TestEnvironmentProfile>;
  apifoxProjects: Record<string, ApifoxProjectRef>;
  routes: RouteRule[];
}

export interface TestContext {
  env: string;
  apifox: { project: string; projectId: string; branch: string; envName: string; envId: string | undefined };
  databases: Record<string, string>;
  frontend: { build?: string; workdir?: string; output?: string };
  testData: { prefix?: string; cleanupRequired?: boolean; prohibited?: string[] };
  credentials: { account?: string; password?: string };
  webUrl?: string;
  /** routes 推导说明(哪些仓库命中/未命中),供 Leader 展示决策依据。 */
  resolution: { repos: string[]; matchedRoutes: string[]; unmatchedRepos: string[] };
  warnings: string[];
}

interface RawTestConfig {
  environments?: Record<string, {
    apifox?: { project?: string; env?: string };
    databases?: Record<string, string>;
    frontend?: { build?: string; workdir?: string; output?: string };
    test_data?: { prefix?: string; cleanup_required?: boolean; prohibited?: string[] };
    credentials?: { account?: string; password?: string };
    web_url?: string;
    desc?: string;
  }>;
  apifox_projects?: Record<string, {
    project_id?: string | number;
    branch?: string;
    envs?: Record<string, string | number>;
  }>;
  routes?: Array<{ repos?: string[]; apifox?: string }>;
}

export function parseTestConfig(markdown: string): TestConfig {
  const match = markdown.match(/```yaml\n([\s\S]*?)\n```/);
  if (!match?.[1]) throw new Error('test-config: no ```yaml fenced block found');
  const raw = parseYaml(match[1]) as RawTestConfig;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('test-config: yaml block is empty or invalid');

  const environments: Record<string, TestEnvironmentProfile> = {};
  for (const [name, env] of Object.entries(raw.environments ?? {})) {
    if (!env?.apifox?.project || !env.apifox.env) {
      throw new Error(`test-config: environments.${name} 缺 apifox {project, env} 索引`);
    }
    environments[name] = {
      apifox: { project: env.apifox.project, env: env.apifox.env },
      ...(env.databases ? { databases: env.databases } : {}),
      ...(env.frontend ? { frontend: env.frontend } : {}),
      ...(env.test_data
        ? {
            testData: {
              ...(env.test_data.prefix ? { prefix: env.test_data.prefix } : {}),
              ...(typeof env.test_data.cleanup_required === 'boolean' ? { cleanupRequired: env.test_data.cleanup_required } : {}),
              ...(env.test_data.prohibited ? { prohibited: env.test_data.prohibited } : {}),
            },
          }
        : {}),
      ...(env.credentials ? { credentials: env.credentials } : {}),
      ...(env.web_url ? { webUrl: env.web_url } : {}),
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
    .filter((route) => route?.repos?.length && route?.apifox)
    .map((route) => ({ repos: route.repos!, apifox: route.apifox! }));

  if (!Object.keys(environments).length) throw new Error('test-config: environments 为空——至少配置一个环境 Profile');
  return { environments, apifoxProjects, routes };
}

/** routes 按仓库命中推导 Apifox 项目;未命中的仓库进 warnings(不阻断,由 Leader/用户裁决)。 */
function resolveApifoxProject(config: TestConfig, repos: string[]): { project: string | undefined; matchedRoutes: string[]; unmatchedRepos: string[] } {
  const matched = new Set<string>();
  const unmatched: string[] = [];
  for (const repo of repos) {
    const rule = config.routes.find((route) => route.repos.includes(repo));
    if (rule) matched.add(rule.apifox); else unmatched.push(repo);
  }
  const projects = [...matched];
  return { project: projects.length === 1 ? projects[0] : undefined, matchedRoutes: projects, unmatchedRepos: unmatched };
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
    warnings.push(`改动仓库命中多个 Apifox 项目(${resolution.matchedRoutes.join(', ')}),已取第一个 "${resolution.project}";若不符请拆分 --repos 或调整 routes`);
  }
  if (resolution.unmatchedRepos.length) {
    warnings.push(`仓库 ${resolution.unmatchedRepos.join(', ')} 未命中任何 route,不参与 Apifox 项目推导`);
  }

  // routes 推导为主(改哪个仓→用哪个项目测);未命中(如 --repos 为空/全未命中)时回落环境 Profile 的默认项目。
  const projectName = resolution.project ?? profile.apifox.project;
  if (!resolution.project) {
    warnings.push(`routes 未能从 [${input.repos.join(', ')}] 推导出唯一项目,已回落到环境 Profile 默认 "${profile.apifox.project}"`);
  }
  const project = config.apifoxProjects[projectName];
  if (!project) {
    warnings.push(`apifox_projects 缺 "${projectName}"(environments.${input.env}.apifox.project 指向它)——请在 test-config 补齐项目索引`);
  }
  const envId = project?.envs[profile.apifox.env];

  const testData = { ...profile.testData };
  if (testData.prefix && input.iid !== undefined) {
    testData.prefix = testData.prefix.replace('{iid}', String(input.iid));
  }

  return {
    env: input.env,
    apifox: {
      project: projectName,
      projectId: project?.projectId ?? '',
      branch: project?.branch ?? 'main',
      envName: profile.apifox.env,
      envId,
    },
    databases: profile.databases ?? {},
    frontend: profile.frontend ?? {},
    testData,
    credentials: profile.credentials ?? {},
    ...(profile.webUrl ? { webUrl: profile.webUrl } : {}),
    resolution: { repos: input.repos, matchedRoutes: resolution.matchedRoutes, unmatchedRepos: resolution.unmatchedRepos },
    warnings,
  };
}
