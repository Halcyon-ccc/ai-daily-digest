import { describe, expect, test } from 'bun:test';
import {
  satisfiesRequiredSignalGroups,
  buildOpenAIRequestBody,
  scoreArticlesWithAI,
  selectProjectIntelligenceCandidates,
  loadConfiguredSources,
  extractTopDigestHistory,
  rankArticles,
  validateProjectsConfig,
  validateSourcesConfig,
} from './digest';

describe('DeepSeek request modes', () => {
  test('uses JSON output and reserves thinking for project scoring', () => {
    const thinkingTasks = new Set(['project-scoring'] as const);
    const generic = buildOpenAIRequestBody('prompt', 'deepseek-v4-flash', 'scoring', thinkingTasks, true);
    const project = buildOpenAIRequestBody('prompt', 'deepseek-v4-flash', 'project-scoring', thinkingTasks, true);

    expect(generic.response_format).toEqual({ type: 'json_object' });
    expect(generic.thinking).toEqual({ type: 'disabled' });
    expect(project.response_format).toEqual({ type: 'json_object' });
    expect(project.thinking).toEqual({ type: 'enabled' });
    expect(project.reasoning_effort).toBe('high');
  });
});

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
        { name: 'Research', xmlUrl: 'https://example.com/feed', htmlUrl: 'https://example.com', tier: 'research', tags: ['multi-agent'], maxTopItems: 3 },
        { name: 'Invalid', xmlUrl: 'file:///tmp/feed', htmlUrl: 'https://example.com' },
      ],
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.tier).toBe('research');
    expect(sources[0]?.tags).toEqual(['multi-agent']);
    expect(sources[0]?.maxTopItems).toBe(3);
  });

  test('falls back to built-in sources when additional config is missing', async () => {
    expect(await loadConfiguredSources('/tmp/nonexistent-digest-sources.json')).toEqual([]);
  });
});

describe('global digest ranking', () => {
  const makeArticle = (title: string, link: string, sourceName: string, score: number, maxTopItems?: number) => ({
    title,
    description: title,
    link,
    pubDate: new Date('2026-08-06T00:00:00Z'),
    sourceName,
    sourceUrl: link,
    sourceTier: 'research' as const,
    sourceMaxTopItems: maxTopItems,
    genericScore: score,
    projectAwareScore: score,
    breakdown: {
      relevance: 8,
      quality: 8,
      timeliness: 8,
      category: 'ai-ml' as const,
      keywords: title.split(' '),
      projectMatches: [],
    },
  });

  test('deduplicates the same event, applies source limits, and prefers fresh articles', () => {
    const articles = [
      makeArticle('OpenAI launches new agent security benchmark', 'https://aggregator.example/openai', 'Aggregator', 30),
      makeArticle('OpenAI launches new agent security benchmark today', 'https://openai.com/security-benchmark', 'Official', 29),
      makeArticle('Multi agent orchestration architecture alpha', 'https://arxiv.org/1', 'arXiv', 28, 1),
      makeArticle('Distributed agent consensus evaluation beta', 'https://arxiv.org/2', 'arXiv', 27, 1),
      makeArticle('Speech recognition latency benchmark', 'https://speech.example/benchmark', 'Speech', 26),
    ];
    const ranked = rankArticles(articles, 3, [{
      title: 'Speech recognition latency benchmark',
      link: 'https://speech.example/benchmark',
    }]);

    expect(ranked).toHaveLength(3);
    expect(ranked.some(article => article.link === 'https://openai.com/security-benchmark')).toBe(true);
    expect(ranked.filter(article => article.sourceName === 'arXiv')).toHaveLength(1);
    expect(ranked[2]?.link).toBe('https://speech.example/benchmark');
  });

  test('extracts only articles from the Top N section', () => {
    const markdown = `## 🏆 今日必读\n\n🥇 **标题**\n\n[Original title](https://example.com/a) — Source\n\n---\n\n## 🤖 AI / ML\n\n### 1. 标题\n\n[Original title](https://example.com/a) — **Source**\n\n### 2. 另一条\n\n[Another title](https://example.com/c) — **Source**\n\n## 🎯 项目相关情报\n\n[Project item](https://example.com/b) — Source`;
    expect(extractTopDigestHistory(markdown)).toEqual([
      { title: 'Original title', link: 'https://example.com/a' },
      { title: 'Another title', link: 'https://example.com/c' },
    ]);
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
    const observedTasks: string[] = [];
    const aiClient = {
      async call(prompt: string, task: string): Promise<string> {
        observedTasks.push(task);
        const indices = [...prompt.matchAll(/^Index (\d+):/gm)].map(match => Number(match[1]));
        const batchKey = indices[0]!;
        const attempt = (callsByBatch.get(batchKey) || 0) + 1;
        callsByBatch.set(batchKey, attempt);
        observedBatchSizes.push(indices.length);

        if (task === 'scoring' && batchKey === 0 && attempt === 1) return '{"results": [';

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
    expect([...callsByBatch.values()].reduce((sum, count) => sum + count, 0)).toBe(4);
    expect(observedTasks.filter(task => task === 'scoring')).toHaveLength(3);
    expect(observedTasks.filter(task => task === 'project-scoring')).toHaveLength(1);
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

  test('does not merge distinct articles from the same research domain', () => {
    const [project] = validateProjectsConfig({
      projects: [{
        id: 'multi-agent',
        name: 'Multi-agent',
        goal: 'Track orchestration',
        keywords: ['multi-agent'],
        selection: { preset: 'strict' },
      }],
    });
    const makeArticle = (title: string, link: string) => ({
      title,
      description: title,
      link,
      pubDate: new Date(),
      sourceName: 'arXiv',
      sourceUrl: 'https://arxiv.org',
      sourceTier: 'research' as const,
      sourceTags: ['multi-agent'],
      genericScore: 24,
      projectAwareScore: 40,
      breakdown: {
        relevance: 8,
        quality: 8,
        timeliness: 8,
        category: 'ai-ml' as const,
        keywords: ['multi-agent'],
        projectMatches: [{
          projectId: 'multi-agent',
          projectRelevance: 9,
          actionability: 8,
          whyRelevant: 'Architecture evidence',
          recommendedAction: 'Evaluate',
        }],
      },
    });

    const selected = selectProjectIntelligenceCandidates([
      makeArticle('Hierarchical sparse coordination over complementary topologies', 'https://arxiv.org/1'),
      makeArticle('Decentralized multimodal semantic navigation', 'https://arxiv.org/2'),
    ], [project!]);
    expect(selected).toHaveLength(2);
  });
});
