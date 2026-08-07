import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  satisfiesRequiredSignalGroups,
  buildOpenAIRequestBody,
  createAIClient,
  scoreArticlesWithAI,
  selectProjectIntelligenceCandidates,
  extractProjectDigestHistory,
  loadConfiguredSources,
  extractTopDigestHistory,
  getGenericRankingAdjustment,
  isSameDigestEvent,
  loadRecentDigestHistory,
  loadRecentProjectDigestHistory,
  rankArticles,
  summarizeArticles,
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

  test('keeps a sole provider eligible after a transient request failure', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) throw new Error('temporary provider failure');
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"results":[]}' } }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = createAIClient({
        openaiApiKey: 'test-key',
        openaiApiBase: 'https://api.example.com/v1',
        openaiModel: 'test-model',
        deepseekThinkingTasks: new Set(),
        primaryProvider: 'openai',
        requestTimeoutMs: 1_000,
      });

      await expect(client.call('first', 'scoring')).rejects.toThrow('temporary provider failure');
      await expect(client.call('second', 'scoring')).resolves.toBe('{"results":[]}');
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  test('deduplicates the same entity and departure event across different headlines', () => {
    const combined = makeArticle(
      'Google DeepMind loses its CEO as Demis Hassabis and Jeff Dean step down',
      'https://news.example/deepmind-leadership',
      'News',
      28
    );
    const focused = makeArticle(
      'Jeff Dean leaving Alphabet',
      'https://news.example/jeff-dean',
      'News',
      27
    );
    const unrelated = makeArticle(
      'Jeff Dean publishes a new systems research paper',
      'https://news.example/jeff-dean-paper',
      'News',
      26
    );
    expect(isSameDigestEvent(combined, focused)).toBe(true);
    expect(isSameDigestEvent(combined, unrelated)).toBe(false);
  });

  test('loads an existing same-day output file as cooldown history', async () => {
    const directory = await mkdtemp('/tmp/digest-history-');
    const outputPath = join(directory, 'digest-20260806.md');
    try {
      await writeFile(outputPath, '## 🤖 AI / ML\n\n### 1. 已有文章\n\n[Existing article](https://example.com/existing) — **Source**\n');
      const history = await loadRecentDigestHistory(outputPath, new Date('2026-08-06T08:00:00Z'));
      expect(history).toEqual([{ title: 'Existing article', link: 'https://example.com/existing' }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('boosts first-party sources and penalizes low-information uncertain descriptions', () => {
    const detailed = 'The release notes document benchmark results, implementation details, compatibility changes, migration steps, and links to the complete technical specification.';
    expect(getGenericRankingAdjustment({ title: 'Official release', description: detailed, sourceTier: 'first-party' })).toBe(2);
    expect(getGenericRankingAdjustment({ title: 'Rumor', description: 'Reportedly this may happen.', sourceTier: 'community' })).toBe(-3);
    expect(getGenericRankingAdjustment({ title: 'Brief update', description: 'Technical update with benchmark numbers, deployment details, and a link to the full report.' })).toBe(-1);

    const community = { ...makeArticle('Community analysis', 'https://community.example/analysis', 'Community', 25), description: detailed, sourceTier: 'community' as const };
    const official = { ...makeArticle('Official technical release', 'https://official.example/release', 'Official', 24), description: detailed, sourceTier: 'first-party' as const };
    expect(rankArticles([community, official], 1)[0]?.sourceName).toBe('Official');
  });
});

describe('project digest cooldown', () => {
  test('extracts project articles independently from generic sections', () => {
    const markdown = `## 🏆 今日必读\n\n[Generic item](https://example.com/generic) — Source\n\n---\n\n## 🎯 项目相关情报\n\n### ASR\n\n#### [Project item](https://example.com/project)\n\n摘要\n\n---`;
    expect(extractProjectDigestHistory(markdown)).toEqual([
      { title: 'Project item', link: 'https://example.com/project' },
    ]);
    expect(extractTopDigestHistory(markdown)).toEqual([
      { title: 'Generic item', link: 'https://example.com/generic' },
    ]);
  });

  test('loads project articles from an existing same-day report', async () => {
    const directory = await mkdtemp('/tmp/project-digest-history-');
    const outputPath = join(directory, 'digest-20260806.md');
    try {
      await writeFile(outputPath, '## 🎯 项目相关情报\n\n### ASR\n\n#### [Existing project item](https://example.com/project)\n\n摘要\n\n---\n');
      const history = await loadRecentProjectDigestHistory(outputPath, new Date('2026-08-06T08:00:00Z'));
      expect(history).toEqual([{ title: 'Existing project item', link: 'https://example.com/project' }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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

  test('accepts a production multi-agent build as architecture evidence', async () => {
    const config = await Bun.file('config/projects.json').json();
    const project = validateProjectsConfig(config)
      .find(item => item.id === 'multi-agent-architecture');
    expect(project).toBeDefined();
    expect(satisfiesRequiredSignalGroups(
      project!,
      'How LendingTree built a multi-agent mortgage assistant on Amazon Bedrock for production use.'
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

  test('keeps every qualifying project match for a production multi-agent article', async () => {
    const projects = validateProjectsConfig(await Bun.file('config/projects.json').json());
    const article = {
      title: 'How LendingTree built a multi-agent mortgage assistant on Amazon Bedrock',
      description: 'A production implementation with coordinated agents, tool authorization, guardrails, and compliance controls.',
      link: 'https://aws.example/lendingtree',
      pubDate: new Date(),
      sourceName: 'AWS Machine Learning Blog',
      sourceUrl: 'https://aws.example',
      sourceTier: 'first-party' as const,
    };
    const aiClient = {
      async call(_prompt: string, task: string): Promise<string> {
        return JSON.stringify({
          results: [{
            index: 0,
            relevance: 8,
            quality: 8,
            timeliness: 8,
            category: 'ai-ml',
            keywords: ['multi-agent', 'guardrails'],
            projectMatches: task === 'project-scoring' ? [{
              projectId: 'multi-agent-architecture',
              projectRelevance: 9,
              actionability: 9,
              whyRelevant: '生产级多智能体架构与协调实现。',
              recommendedAction: '评估其编排与共享状态设计。',
            }, {
              projectId: 'agent-security',
              projectRelevance: 8,
              actionability: 8,
              whyRelevant: '包含工具授权、护栏和合规控制。',
              recommendedAction: '对照当前权限和审计机制。',
            }] : [],
          }],
        });
      },
    };

    const scores = await scoreArticlesWithAI([article], aiClient, projects);
    expect(scores.get(0)?.projectMatches.map(match => match.projectId).sort()).toEqual([
      'agent-security',
      'multi-agent-architecture',
    ]);
  });
});

describe('AI summary batches', () => {
  test('retries only omitted summary indices', async () => {
    const articles = [0, 1].map(index => ({
      index,
      title: `Article ${index}`,
      description: `Technical description for article ${index}`,
      link: `https://example.com/${index}`,
      pubDate: new Date(),
      sourceName: 'Test source',
      sourceUrl: 'https://example.com',
    }));
    const prompts: string[] = [];
    const aiClient = {
      async call(prompt: string): Promise<string> {
        prompts.push(prompt);
        const indices = [...prompt.matchAll(/^Index (\d+):/gm)].map(match => Number(match[1]));
        return JSON.stringify({
          results: indices
            .filter(index => prompts.length > 1 || index === 0)
            .map(index => ({
              index,
              titleZh: `文章 ${index}`,
              summary: `这是文章 ${index} 的完整技术摘要，包含足够的信息用于验证摘要结果。`,
              reason: '具备明确的技术参考价值。',
            })),
        });
      },
    };

    const summaries = await summarizeArticles(articles, aiClient, 'zh');
    expect(summaries.size).toBe(2);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).not.toContain('Index 0:');
    expect(prompts[1]).toContain('Index 1:');
  });

  test('uses a clean fallback after repeated missing summaries', async () => {
    let calls = 0;
    const summaries = await summarizeArticles([{
      index: 0,
      title: 'Original title',
      description: '&lt;p&gt;Raw fallback text&lt;/p&gt;',
      link: 'https://example.com/fallback',
      pubDate: new Date(),
      sourceName: 'Test source',
      sourceUrl: 'https://example.com',
    }], {
      async call(): Promise<string> {
        calls++;
        return '{"results": []}';
      },
    }, 'zh');

    expect(calls).toBe(2);
    expect(summaries.get(0)?.summary).toBe('Raw fallback text');
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

  test('prefers fresh project articles and backfills cooling-down items when needed', () => {
    const [project] = validateProjectsConfig({
      projects: [{
        id: 'asr',
        name: 'ASR',
        goal: 'Track speech recognition',
        keywords: ['ASR'],
        selection: { preset: 'balanced', maxItems: 2 },
      }],
    });
    const makeArticle = (title: string, link: string, relevance: number) => ({
      title,
      description: `${title} with detailed benchmark results and implementation guidance for production speech recognition systems.`,
      link,
      pubDate: new Date(),
      sourceName: 'Research',
      sourceUrl: 'https://research.example',
      sourceTier: 'research' as const,
      genericScore: 24,
      projectAwareScore: 40,
      breakdown: {
        relevance: 8,
        quality: 8,
        timeliness: 8,
        category: 'ai-ml' as const,
        keywords: ['ASR'],
        projectMatches: [{
          projectId: 'asr',
          projectRelevance: relevance,
          actionability: 8,
          whyRelevant: 'ASR benchmark',
          recommendedAction: 'Evaluate',
        }],
      },
    });
    const cooledHigh = makeArticle('High-ranked repeated ASR benchmark', 'https://example.com/cooled-high', 10);
    const fresh = makeArticle('Fresh ASR latency benchmark', 'https://example.com/fresh', 8);
    const cooledLow = makeArticle('Older repeated ASR benchmark', 'https://example.com/cooled-low', 7);

    const selected = selectProjectIntelligenceCandidates(
      [cooledHigh, fresh, cooledLow],
      [project!],
      [
        { title: cooledHigh.title, link: cooledHigh.link },
        { title: cooledLow.title, link: cooledLow.link },
      ]
    );

    expect(selected.map(item => item.article.link)).toEqual([
      fresh.link,
      cooledHigh.link,
    ]);
  });
});
