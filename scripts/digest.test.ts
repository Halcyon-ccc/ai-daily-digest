import { describe, expect, test } from 'bun:test';
import {
  satisfiesRequiredSignalGroups,
  scoreArticlesWithAI,
  selectProjectIntelligenceCandidates,
  loadConfiguredSources,
  validateProjectsConfig,
  validateSourcesConfig,
} from './digest';

const agentSecurityProject = {
  id: 'agent-security',
  name: 'Agent security',
  goal: 'Track agent security controls',
  requiredSignalGroups: [
    ['AI agent', 'MCP', 'tool calling'],
    ['prompt injection', 'tool authorization', 'sandboxing', 'safety tests', 'social engineering'],
  ],
  requiredSignals: ['AI agent', 'MCP', 'tool calling'],
  supportingSignals: [],
  negativeSignals: [],
  keywords: ['agent security'],
  entities: [],
  exclude: [],
  selection: {
    preset: 'balanced' as const,
    minMatchRelevance: 6,
    minSectionRelevance: 7,
    minArticleQuality: 5,
    minActionability: 1,
    maxItems: 2,
  },
  sourcePreferences: { preferredTiers: [], preferredTags: [] },
};

describe('config validation', () => {
  test('resolves project presets and source metadata', () => {
    const [project] = validateProjectsConfig({
      projects: [{
        id: 'multi-agent',
        name: 'Multi-agent',
        goal: 'Track orchestration',
        keywords: ['multi-agent'],
        selection: { preset: 'strict', maxItems: 4 },
      }],
    });
    expect(project?.selection).toEqual({
      preset: 'strict',
      minMatchRelevance: 7,
      minSectionRelevance: 8,
      minArticleQuality: 7,
      minActionability: 6,
      maxItems: 4,
    });

    const sources = validateSourcesConfig({
      sources: [
        { name: 'Research', xmlUrl: 'https://example.com/feed', htmlUrl: 'https://example.com', tier: 'research', tags: ['multi-agent'] },
        { name: 'Invalid', xmlUrl: 'file:///tmp/feed', htmlUrl: 'https://example.com' },
      ],
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.tier).toBe('research');
    expect(sources[0]?.tags).toEqual(['multi-agent']);
  });

  test('falls back to built-in sources when additional config is missing', async () => {
    expect(await loadConfiguredSources('/tmp/nonexistent-digest-sources.json')).toEqual([]);
  });
});

describe('project signal groups', () => {
  test('requires both an agent signal and an explicit security signal', () => {
    expect(satisfiesRequiredSignalGroups(
      agentSecurityProject,
      'Pi is an AI agent with a minimalist architecture and better performance.'
    )).toBe(false);

    expect(satisfiesRequiredSignalGroups(
      agentSecurityProject,
      'An AI agent adds tool authorization to prevent unsafe actions.'
    )).toBe(true);

    expect(satisfiesRequiredSignalGroups(
      agentSecurityProject,
      'An AI agent went rogue during safety tests and launched social engineering attacks.'
    )).toBe(true);
  });
});

describe('AI scoring batches', () => {
  test('uses batches of at most eight and retries malformed JSON once', async () => {
    const articles = Array.from({ length: 9 }, (_, index) => ({
      title: index === 0
        ? 'A minimalist AI agent architecture'
        : index === 1
          ? 'AI agent tool authorization and sandboxing'
          : `Engineering article ${index}`,
      description: index === 1 ? 'Security controls for tool calling.' : 'A technical update.',
      link: `https://example.com/${index}`,
      pubDate: new Date(),
      sourceName: 'Test source',
      sourceUrl: 'https://example.com',
    }));

    const callsByBatch = new Map<number, number>();
    const observedBatchSizes: number[] = [];
    const aiClient = {
      async call(prompt: string): Promise<string> {
        const indices = [...prompt.matchAll(/^Index (\d+):/gm)].map(match => Number(match[1]));
        const batchKey = indices[0]!;
        const attempt = (callsByBatch.get(batchKey) || 0) + 1;
        callsByBatch.set(batchKey, attempt);
        observedBatchSizes.push(indices.length);

        if (batchKey === 0 && attempt === 1) return '{"results": [';

        return JSON.stringify({
          results: indices.map(index => ({
            index,
            relevance: 8,
            quality: 8,
            timeliness: 8,
            category: 'security',
            keywords: ['agent', 'security'],
            projectMatches: [{
              projectId: 'agent-security',
              projectRelevance: 9,
              actionability: 8,
              whyRelevant: 'Test evidence',
              recommendedAction: 'Review controls',
            }],
          })),
        });
      },
    };

    const scores = await scoreArticlesWithAI(articles, aiClient, [agentSecurityProject]);

    expect(scores.size).toBe(9);
    expect(observedBatchSizes.every(size => size <= 8)).toBe(true);
    expect([...callsByBatch.values()].reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(scores.get(0)?.projectMatches).toEqual([]);
    expect(scores.get(1)?.projectMatches).toHaveLength(1);
  });
});

describe('per-project selection', () => {
  test('applies strict quality and actionability thresholds', () => {
    const [strictProject] = validateProjectsConfig({
      projects: [{
        id: 'multi-agent',
        name: 'Multi-agent',
        goal: 'Track orchestration',
        keywords: ['multi-agent'],
        selection: { preset: 'strict' },
      }],
    });
    expect(strictProject).toBeDefined();

    const makeArticle = (quality: number, actionability: number) => ({
      title: `Multi-agent orchestration quality ${quality}`,
      description: 'Agent team handoff architecture',
      link: `https://example.com/${quality}-${actionability}`,
      pubDate: new Date(),
      sourceName: 'Research',
      sourceUrl: 'https://example.com',
      sourceTier: 'research' as const,
      sourceTags: ['multi-agent'],
      genericScore: 24,
      projectAwareScore: 40,
      breakdown: {
        relevance: 8,
        quality,
        timeliness: 8,
        category: 'ai-ml' as const,
        keywords: ['multi-agent'],
        projectMatches: [{
          projectId: 'multi-agent',
          projectRelevance: 9,
          actionability,
          whyRelevant: 'Architecture evidence',
          recommendedAction: 'Evaluate',
        }],
      },
    });

    const selected = selectProjectIntelligenceCandidates(
      [makeArticle(6, 8), makeArticle(8, 5), makeArticle(8, 8)],
      [strictProject!]
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.article.breakdown.quality).toBe(8);
    expect(selected[0]?.matches[0]?.actionability).toBe(8);
  });
});
