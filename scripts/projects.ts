import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { validateProjectsConfig, validateSourcesConfig } from './digest';

const DEFAULT_PROJECTS_PATH = 'config/projects.json';
const DEFAULT_SOURCES_PATH = 'config/sources.json';
const VALID_PRESETS = new Set(['strict', 'balanced', 'broad']);

function usage(): never {
  console.log(`Project profile helper

Usage:
  bun scripts/projects.ts validate [--config <path>] [--sources <path>]
  bun scripts/projects.ts add --id <id> --name <name> --goal <goal> [options]

Add options:
  --preset <name>       strict, balanced, or broad (default: balanced)
  --groups <value>      Required groups separated by semicolons; signals by commas
  --keywords <value>    Comma-separated keywords (defaults to words from id)
  --supporting <value>  Comma-separated supporting signals
  --exclude <value>     Comma-separated exclusions
  --min-match <n>       Override model-match relevance threshold (1-10)
  --min-section <n>     Override project-section relevance threshold (1-10)
  --min-quality <n>     Override article quality threshold (1-10)
  --min-actionability <n> Override actionability threshold (1-10)
  --max-items <n>       Override maximum project items (1-10)
  --config <path>       Project config path (default: config/projects.json)

Example:
  bun scripts/projects.ts add \
    --id multi-agent-evaluation \
    --name "Multi-agent evaluation" \
    --goal "Track multi-agent benchmarks and evaluation methods" \
    --preset strict \
    --groups "multi-agent,agent team;benchmark,evaluation"
`);
  process.exit(0);
}

function parseOptions(args: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!key?.startsWith('--')) continue;
    const value = args[index + 1];
    if (value && !value.startsWith('--')) {
      options.set(key.slice(2), value);
      index++;
    }
  }
  return options;
}

function splitList(value: string | undefined): string[] {
  return (value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function parseGroups(value: string | undefined): string[][] {
  return (value || '').split(';').map(splitList).filter(group => group.length > 0);
}

function parseOptionalInteger(options: Map<string, string>, key: string): number | undefined {
  const value = options.get(key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) throw new Error(`--${key} must be an integer from 1 to 10`);
  return parsed;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function validateCommand(options: Map<string, string>): Promise<void> {
  const projectsPath = options.get('config') || DEFAULT_PROJECTS_PATH;
  const sourcesPath = options.get('sources') || DEFAULT_SOURCES_PATH;
  const projectsRaw = await readJson(projectsPath);
  const sourcesRaw = await readJson(sourcesPath);
  const rawProjectCount = Array.isArray((projectsRaw as { projects?: unknown })?.projects)
    ? (projectsRaw as { projects: unknown[] }).projects.length
    : 0;
  const rawSourceCount = Array.isArray((sourcesRaw as { sources?: unknown })?.sources)
    ? (sourcesRaw as { sources: unknown[] }).sources.filter(source => (source as { enabled?: unknown })?.enabled !== false).length
    : 0;
  const projects = validateProjectsConfig(projectsRaw);
  const sources = validateSourcesConfig(sourcesRaw);

  if (projects.length !== rawProjectCount || sources.length !== rawSourceCount) {
    throw new Error(`Validation failed: projects ${projects.length}/${rawProjectCount}, sources ${sources.length}/${rawSourceCount}`);
  }
  console.log(`[projects] Valid: ${projects.length} projects, ${sources.length} enabled sources`);
}

async function addCommand(options: Map<string, string>): Promise<void> {
  const configPath = options.get('config') || DEFAULT_PROJECTS_PATH;
  const id = options.get('id')?.trim() || '';
  const name = options.get('name')?.trim() || '';
  const goal = options.get('goal')?.trim() || '';
  const preset = options.get('preset')?.trim() || 'balanced';
  const requiredSignalGroups = parseGroups(options.get('groups'));
  const keywords = splitList(options.get('keywords'));

  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('--id must use lowercase letters, numbers, and hyphens');
  if (!name) throw new Error('--name is required');
  if (!goal) throw new Error('--goal is required');
  if (!VALID_PRESETS.has(preset)) throw new Error('--preset must be strict, balanced, or broad');
  if (requiredSignalGroups.length === 0) throw new Error('--groups must contain at least one signal group');

  const parsed = await readJson(configPath) as { projects?: unknown[] };
  if (!Array.isArray(parsed.projects)) throw new Error(`${configPath} does not contain a projects array`);
  if (parsed.projects.some(project => (project as { id?: unknown })?.id === id)) throw new Error(`Project ${id} already exists`);

  const selection = {
    preset,
    minMatchRelevance: parseOptionalInteger(options, 'min-match'),
    minSectionRelevance: parseOptionalInteger(options, 'min-section'),
    minArticleQuality: parseOptionalInteger(options, 'min-quality'),
    minActionability: parseOptionalInteger(options, 'min-actionability'),
    maxItems: parseOptionalInteger(options, 'max-items'),
  };
  const project = {
    id,
    name,
    goal,
    requiredSignalGroups,
    requiredSignals: requiredSignalGroups[0],
    supportingSignals: splitList(options.get('supporting')),
    negativeSignals: [],
    keywords: keywords.length > 0 ? keywords : id.split('-'),
    entities: [],
    exclude: splitList(options.get('exclude')),
    selection: Object.fromEntries(Object.entries(selection).filter(([, value]) => value !== undefined)),
    sourcePreferences: { preferredTiers: ['first-party', 'research'], preferredTags: [] },
  };

  const validated = validateProjectsConfig({ projects: [...parsed.projects, project] });
  if (validated.length !== parsed.projects.length + 1) throw new Error('Generated project did not pass validation');

  parsed.projects.push(project);
  await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  console.log(`[projects] Added ${id} to ${configPath} with preset=${preset}`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') usage();
  const options = parseOptions(args);

  if (command === 'validate') await validateCommand(options);
  else if (command === 'add') await addCommand(options);
  else throw new Error(`Unknown command: ${command}`);
}

if (import.meta.main) {
  main().catch(error => {
    console.error(`[projects] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
