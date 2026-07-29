import { parse as parseYaml } from 'yaml';

export type RunMode = 'semi-auto' | 'full-auto';

export interface GlabConfig {
  gitlab: { host: string; projectId: string; harnessClone?: string };
  workspace: { root: string };
  branchNaming: { format: string; typeMap: Record<string, string> };
  runMode: RunMode;
  deployBranch?: string;
  jenkins?: { jobName: string; branchParam: string; defaultParams: Record<string, string> };
  databases?: Record<string, { mcp: string; desc?: string }>;
  testEnvironments?: Record<string, { url: string; account?: string; password?: string; desc?: string }>;
}

interface RawConfig {
  gitlab?: { host?: string; project_id?: string; project_path?: string; harness_clone?: string };
  workspace?: { root?: string };
  branch_naming?: { format?: string; type_map?: Record<string, string> };
  run_mode?: string;
  deploy_branch?: string;
  jenkins?: { job_name?: string; branch_param?: string; default_params?: Record<string, string> };
  databases?: Record<string, { mcp?: string; desc?: string }>;
  test_environments?: Record<string, { url?: string; account?: string; password?: string; desc?: string }>;
}

function extractYamlBlock(markdown: string): string | null {
  const match = markdown.match(/```yaml\n([\s\S]*?)\n```/);
  const block = match?.[1];
  return block ?? null;
}

export function parseConfig(markdown: string): GlabConfig {
  const block = extractYamlBlock(markdown);
  if (!block) throw new Error('config: no ```yaml fenced block found in config markdown');

  const raw = parseYaml(block) as RawConfig;
  const host = raw.gitlab?.host;
  const projectId = raw.gitlab?.project_id ?? raw.gitlab?.project_path;
  const root = raw.workspace?.root;
  if (!host || !projectId || !root) {
    throw new Error(
      `config: missing required fields — need gitlab.host, gitlab.project_id (or project_path), workspace.root; ` +
        `got host=${host ?? '<empty>'}, projectId=${projectId ?? '<empty>'}, root=${root ?? '<empty>'}`,
    );
  }

  const runMode: RunMode = raw.run_mode === 'full-auto' ? 'full-auto' : 'semi-auto';
  const gitlab: GlabConfig['gitlab'] = { host, projectId: String(projectId) };
  if (raw.gitlab?.harness_clone) gitlab.harnessClone = raw.gitlab.harness_clone;

  const config: GlabConfig = {
    gitlab,
    workspace: { root },
    branchNaming: {
      format: raw.branch_naming?.format ?? '{type}/{iid}',
      typeMap: raw.branch_naming?.type_map ?? { story: 'feat', bug: 'fix' },
    },
    runMode,
  };

  if (raw.deploy_branch) config.deployBranch = raw.deploy_branch;
  if (raw.jenkins?.job_name) {
    config.jenkins = {
      jobName: raw.jenkins.job_name,
      branchParam: raw.jenkins.branch_param ?? 'oa_branch',
      defaultParams: raw.jenkins.default_params ?? {},
    };
  }
  if (raw.databases) {
    config.databases = Object.fromEntries(
      Object.entries(raw.databases).map(([key, value]) => [
        key,
        { mcp: value.mcp ?? '', ...(value.desc ? { desc: value.desc } : {}) },
      ]),
    );
  }
  if (raw.test_environments) {
    config.testEnvironments = Object.fromEntries(
      Object.entries(raw.test_environments).map(([key, value]) => [
        key,
        {
          url: value.url ?? '',
          ...(value.account ? { account: value.account } : {}),
          ...(value.password ? { password: value.password } : {}),
          ...(value.desc ? { desc: value.desc } : {}),
        },
      ]),
    );
  }

  return config;
}
