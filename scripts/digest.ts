import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import process from 'node:process';

// ============================================================================
// Constants
// ============================================================================

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const OPENAI_DEFAULT_API_BASE = 'https://api.openai.com/v1';
const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
const FEED_FETCH_TIMEOUT_MS = 15_000;
const FEED_CONCURRENCY = 10;
const GEMINI_BATCH_SIZE = 10;
const SCORING_BATCH_SIZE = 8;
const SCORING_MAX_ATTEMPTS = 2;
const SUMMARY_MAX_ATTEMPTS = 2;
const MAX_CONCURRENT_GEMINI = 2;
const DEFAULT_AI_REQUEST_TIMEOUT_MS = 180_000;
const DEFAULT_DEEPSEEK_THINKING_TASKS = 'project-scoring,highlights';
const DEFAULT_PROJECTS_CONFIG_PATH = 'config/projects.json';
const DEFAULT_SOURCES_CONFIG_PATH = 'config/sources.json';
const DESIGN_SECTION_ENABLED = /^(1|true|yes|on)$/i.test(process.env.DESIGN_SECTION_ENABLED?.trim() || '');
const IGNORE_SAME_DAY_COOLDOWN = /^(1|true|yes|on)$/i.test(process.env.DIGEST_IGNORE_SAME_DAY_COOLDOWN?.trim() || '');
const MAX_PROJECT_MATCHES_PER_ARTICLE = 5;
const MAX_PROJECT_TEXT_LENGTH = 240;
const DIGEST_COOLDOWN_HOURS = 48;
const FIRST_PARTY_RANKING_BONUS = 2;
const MAX_LOW_INFORMATION_PENALTY = 3;
const SECONDARY_SOURCE_TOP_LIMIT = 2;
const AGGREGATOR_SOURCE_TOP_LIMIT = 3;
const COMMUNITY_SOURCE_TOP_LIMIT = 2;
const MAX_SUPPLEMENTAL_VIEWS = 3;
const MIN_SUPPLEMENTAL_QUALITY = 6;
const MIN_SUPPLEMENTAL_RELEVANCE = 6;
const MIN_SUPPLEMENTAL_ADJUSTED_SCORE = 22;
const MAX_SUMMARY_REPLACEMENT_CANDIDATES = 5;
const DEFAULT_GENERIC_MAX_ITEMS = 50;
const MAX_PROJECT_RESEARCH_CANDIDATES_PER_PROFILE = 4;
const MAX_PROJECT_NON_RESEARCH_CANDIDATES_PER_PROFILE = 8;
const MAX_TOTAL_PROJECT_RESEARCH_CANDIDATES = 8;
const PROJECT_SOURCE_SOFT_LIMIT = 2;
const RESEARCH_SOURCE_SOFT_LIMIT = 2;
const SOURCE_HEALTH_WARNING_FAILURES = 3;
const SOURCE_HEALTH_PAUSE_FAILURES = 7;
const SOURCE_HEALTH_RETRY_INTERVAL_MS = 72 * 60 * 60 * 1000;
const AGGREGATOR_HOSTS = new Set([
  'news.ycombinator.com',
  'reddit.com',
  'www.reddit.com',
  'old.reddit.com',
  'lobste.rs',
  'x.com',
  'twitter.com',
]);
const EVENT_GENERIC_TOKENS = new Set([
  'ai', 'agent', 'agents', 'article', 'attack', 'blog', 'breach', 'incident',
  'intrusion', 'issue', 'model', 'models', 'new', 'post', 'sandbox', 'security',
  'system', 'systems', 'technical', 'technology', 'tool', 'tools',
]);
const EVENT_STOP_WORDS = new Set([
  'about', 'after', 'against', 'from', 'have', 'including', 'into', 'more',
  'than', 'that', 'their', 'the', 'this', 'with', 'without', 'your',
]);
const EVENT_ACTION_GROUPS = [
  ['leave', 'leaves', 'leaving', 'left', 'depart', 'departs', 'departing', 'resign', 'resigns', 'resigned', 'step down', 'steps down', 'stepped down'],
  ['launch', 'launches', 'launched', 'release', 'releases', 'released', 'unveil', 'unveils', 'unveiled'],
  ['acquire', 'acquires', 'acquired', 'acquisition', 'buy', 'buys', 'bought'],
  ['hack', 'hacks', 'hacked', 'breach', 'breaches', 'breached', 'attack', 'attacks', 'attacked'],
];

// 96 RSS feeds from Hacker News Popularity Contest 2025 (curated by Karpathy)
const RSS_FEEDS: FeedSource[] = [
  { name: "simonwillison.net", xmlUrl: "https://simonwillison.net/atom/everything/", htmlUrl: "https://simonwillison.net" },
  { name: "jeffgeerling.com", xmlUrl: "https://www.jeffgeerling.com/blog.xml", htmlUrl: "https://jeffgeerling.com" },
  { name: "seangoedecke.com", xmlUrl: "https://www.seangoedecke.com/rss.xml", htmlUrl: "https://seangoedecke.com" },
  { name: "krebsonsecurity.com", xmlUrl: "https://krebsonsecurity.com/feed/", htmlUrl: "https://krebsonsecurity.com" },
  { name: "daringfireball.net", xmlUrl: "https://daringfireball.net/feeds/main", htmlUrl: "https://daringfireball.net" },
  { name: "ericmigi.com", xmlUrl: "https://ericmigi.com/rss.xml", htmlUrl: "https://ericmigi.com" },
  { name: "antirez.com", xmlUrl: "http://antirez.com/rss", htmlUrl: "http://antirez.com" },
  { name: "idiallo.com", xmlUrl: "https://idiallo.com/feed.rss", htmlUrl: "https://idiallo.com" },
  { name: "maurycyz.com", xmlUrl: "https://maurycyz.com/index.xml", htmlUrl: "https://maurycyz.com" },
  { name: "pluralistic.net", xmlUrl: "https://pluralistic.net/feed/", htmlUrl: "https://pluralistic.net" },
  { name: "shkspr.mobi", xmlUrl: "https://shkspr.mobi/blog/feed/", htmlUrl: "https://shkspr.mobi" },
  { name: "lcamtuf.substack.com", xmlUrl: "https://lcamtuf.substack.com/feed", htmlUrl: "https://lcamtuf.substack.com" },
  { name: "mitchellh.com", xmlUrl: "https://mitchellh.com/feed.xml", htmlUrl: "https://mitchellh.com" },
  { name: "dynomight.net", xmlUrl: "https://dynomight.net/feed.xml", htmlUrl: "https://dynomight.net" },
  { name: "utcc.utoronto.ca/~cks", xmlUrl: "https://utcc.utoronto.ca/~cks/space/blog/?atom", htmlUrl: "https://utcc.utoronto.ca/~cks" },
  { name: "xeiaso.net", xmlUrl: "https://xeiaso.net/blog.rss", htmlUrl: "https://xeiaso.net" },
  { name: "devblogs.microsoft.com/oldnewthing", xmlUrl: "https://devblogs.microsoft.com/oldnewthing/feed", htmlUrl: "https://devblogs.microsoft.com/oldnewthing" },
  { name: "righto.com", xmlUrl: "https://www.righto.com/feeds/posts/default", htmlUrl: "https://righto.com" },
  { name: "lucumr.pocoo.org", xmlUrl: "https://lucumr.pocoo.org/feed.atom", htmlUrl: "https://lucumr.pocoo.org" },
  { name: "skyfall.dev", xmlUrl: "https://skyfall.dev/rss.xml", htmlUrl: "https://skyfall.dev" },
  { name: "garymarcus.substack.com", xmlUrl: "https://garymarcus.substack.com/feed", htmlUrl: "https://garymarcus.substack.com" },
  { name: "rachelbythebay.com", xmlUrl: "https://rachelbythebay.com/w/atom.xml", htmlUrl: "https://rachelbythebay.com" },
  { name: "overreacted.io", xmlUrl: "https://overreacted.io/rss.xml", htmlUrl: "https://overreacted.io" },
  { name: "timsh.org", xmlUrl: "https://timsh.org/rss/", htmlUrl: "https://timsh.org" },
  { name: "johndcook.com", xmlUrl: "https://www.johndcook.com/blog/feed/", htmlUrl: "https://johndcook.com" },
  { name: "gilesthomas.com", xmlUrl: "https://gilesthomas.com/feed/rss.xml", htmlUrl: "https://gilesthomas.com" },
  { name: "matklad.github.io", xmlUrl: "https://matklad.github.io/feed.xml", htmlUrl: "https://matklad.github.io" },
  { name: "derekthompson.org", xmlUrl: "https://www.theatlantic.com/feed/author/derek-thompson/", htmlUrl: "https://derekthompson.org" },
  { name: "evanhahn.com", xmlUrl: "https://evanhahn.com/feed.xml", htmlUrl: "https://evanhahn.com" },
  { name: "terriblesoftware.org", xmlUrl: "https://terriblesoftware.org/feed/", htmlUrl: "https://terriblesoftware.org" },
  { name: "rakhim.exotext.com", xmlUrl: "https://rakhim.exotext.com/rss.xml", htmlUrl: "https://rakhim.exotext.com" },
  { name: "joanwestenberg.com", xmlUrl: "https://joanwestenberg.com/rss", htmlUrl: "https://joanwestenberg.com" },
  { name: "xania.org", xmlUrl: "https://xania.org/feed", htmlUrl: "https://xania.org" },
  { name: "micahflee.com", xmlUrl: "https://micahflee.com/feed/", htmlUrl: "https://micahflee.com" },
  { name: "nesbitt.io", xmlUrl: "https://nesbitt.io/feed.xml", htmlUrl: "https://nesbitt.io" },
  { name: "construction-physics.com", xmlUrl: "https://www.construction-physics.com/feed", htmlUrl: "https://construction-physics.com" },
  { name: "tedium.co", xmlUrl: "https://feed.tedium.co/", htmlUrl: "https://tedium.co" },
  { name: "susam.net", xmlUrl: "https://susam.net/feed.xml", htmlUrl: "https://susam.net" },
  { name: "entropicthoughts.com", xmlUrl: "https://entropicthoughts.com/feed.xml", htmlUrl: "https://entropicthoughts.com" },
  { name: "buttondown.com/hillelwayne", xmlUrl: "https://buttondown.com/hillelwayne/rss", htmlUrl: "https://buttondown.com/hillelwayne" },
  { name: "dwarkesh.com", xmlUrl: "https://www.dwarkeshpatel.com/feed", htmlUrl: "https://dwarkesh.com" },
  { name: "borretti.me", xmlUrl: "https://borretti.me/feed.xml", htmlUrl: "https://borretti.me" },
  { name: "wheresyoured.at", xmlUrl: "https://www.wheresyoured.at/rss/", htmlUrl: "https://wheresyoured.at" },
  { name: "jayd.ml", xmlUrl: "https://jayd.ml/feed.xml", htmlUrl: "https://jayd.ml" },
  { name: "minimaxir.com", xmlUrl: "https://minimaxir.com/index.xml", htmlUrl: "https://minimaxir.com" },
  { name: "geohot.github.io", xmlUrl: "https://geohot.github.io/blog/feed.xml", htmlUrl: "https://geohot.github.io" },
  { name: "paulgraham.com", xmlUrl: "http://www.aaronsw.com/2002/feeds/pgessays.rss", htmlUrl: "https://paulgraham.com" },
  { name: "filfre.net", xmlUrl: "https://www.filfre.net/feed/", htmlUrl: "https://filfre.net" },
  { name: "blog.jim-nielsen.com", xmlUrl: "https://blog.jim-nielsen.com/feed.xml", htmlUrl: "https://blog.jim-nielsen.com" },
  { name: "dfarq.homeip.net", xmlUrl: "https://dfarq.homeip.net/feed/", htmlUrl: "https://dfarq.homeip.net" },
  { name: "jyn.dev", xmlUrl: "https://jyn.dev/atom.xml", htmlUrl: "https://jyn.dev" },
  { name: "geoffreylitt.com", xmlUrl: "https://www.geoffreylitt.com/feed.xml", htmlUrl: "https://geoffreylitt.com" },
  { name: "downtowndougbrown.com", xmlUrl: "https://www.downtowndougbrown.com/feed/", htmlUrl: "https://downtowndougbrown.com" },
  { name: "brutecat.com", xmlUrl: "https://brutecat.com/rss.xml", htmlUrl: "https://brutecat.com" },
  { name: "eli.thegreenplace.net", xmlUrl: "https://eli.thegreenplace.net/feeds/all.atom.xml", htmlUrl: "https://eli.thegreenplace.net" },
  { name: "abortretry.fail", xmlUrl: "https://www.abortretry.fail/feed", htmlUrl: "https://abortretry.fail" },
  { name: "fabiensanglard.net", xmlUrl: "https://fabiensanglard.net/rss.xml", htmlUrl: "https://fabiensanglard.net" },
  { name: "oldvcr.blogspot.com", xmlUrl: "https://oldvcr.blogspot.com/feeds/posts/default", htmlUrl: "https://oldvcr.blogspot.com" },
  { name: "bogdanthegeek.github.io", xmlUrl: "https://bogdanthegeek.github.io/blog/index.xml", htmlUrl: "https://bogdanthegeek.github.io" },
  { name: "hugotunius.se", xmlUrl: "https://hugotunius.se/feed.xml", htmlUrl: "https://hugotunius.se" },
  { name: "gwern.net", xmlUrl: "https://gwern.substack.com/feed", htmlUrl: "https://gwern.net" },
  { name: "berthub.eu", xmlUrl: "https://berthub.eu/articles/index.xml", htmlUrl: "https://berthub.eu" },
  { name: "chadnauseam.com", xmlUrl: "https://chadnauseam.com/rss.xml", htmlUrl: "https://chadnauseam.com" },
  { name: "simone.org", xmlUrl: "https://simone.org/feed/", htmlUrl: "https://simone.org" },
  { name: "it-notes.dragas.net", xmlUrl: "https://it-notes.dragas.net/feed/", htmlUrl: "https://it-notes.dragas.net" },
  { name: "beej.us", xmlUrl: "https://beej.us/blog/rss.xml", htmlUrl: "https://beej.us" },
  { name: "hey.paris", xmlUrl: "https://hey.paris/index.xml", htmlUrl: "https://hey.paris" },
  { name: "danielwirtz.com", xmlUrl: "https://danielwirtz.com/rss.xml", htmlUrl: "https://danielwirtz.com" },
  { name: "matduggan.com", xmlUrl: "https://matduggan.com/rss/", htmlUrl: "https://matduggan.com" },
  { name: "refactoringenglish.com", xmlUrl: "https://refactoringenglish.com/index.xml", htmlUrl: "https://refactoringenglish.com" },
  { name: "worksonmymachine.substack.com", xmlUrl: "https://worksonmymachine.substack.com/feed", htmlUrl: "https://worksonmymachine.substack.com" },
  { name: "philiplaine.com", xmlUrl: "https://philiplaine.com/index.xml", htmlUrl: "https://philiplaine.com" },
  { name: "steveblank.com", xmlUrl: "https://steveblank.com/feed/", htmlUrl: "https://steveblank.com" },
  { name: "bernsteinbear.com", xmlUrl: "https://bernsteinbear.com/feed.xml", htmlUrl: "https://bernsteinbear.com" },
  { name: "danieldelaney.net", xmlUrl: "https://danieldelaney.net/feed", htmlUrl: "https://danieldelaney.net" },
  { name: "troyhunt.com", xmlUrl: "https://www.troyhunt.com/rss/", htmlUrl: "https://troyhunt.com" },
  { name: "herman.bearblog.dev", xmlUrl: "https://herman.bearblog.dev/feed/", htmlUrl: "https://herman.bearblog.dev" },
  { name: "tomrenner.com", xmlUrl: "https://tomrenner.com/index.xml", htmlUrl: "https://tomrenner.com" },
  { name: "blog.pixelmelt.dev", xmlUrl: "https://blog.pixelmelt.dev/rss/", htmlUrl: "https://blog.pixelmelt.dev" },
  { name: "martinalderson.com", xmlUrl: "https://martinalderson.com/feed.xml", htmlUrl: "https://martinalderson.com" },
  { name: "danielchasehooper.com", xmlUrl: "https://danielchasehooper.com/feed.xml", htmlUrl: "https://danielchasehooper.com" },
  { name: "chiark.greenend.org.uk/~sgtatham", xmlUrl: "https://www.chiark.greenend.org.uk/~sgtatham/quasiblog/feed.xml", htmlUrl: "https://chiark.greenend.org.uk/~sgtatham" },
  { name: "grantslatton.com", xmlUrl: "https://grantslatton.com/rss.xml", htmlUrl: "https://grantslatton.com" },
  { name: "experimental-history.com", xmlUrl: "https://www.experimental-history.com/feed", htmlUrl: "https://experimental-history.com" },
  { name: "anildash.com", xmlUrl: "https://anildash.com/feed.xml", htmlUrl: "https://anildash.com" },
  { name: "aresluna.org", xmlUrl: "https://aresluna.org/main.rss", htmlUrl: "https://aresluna.org" },
  { name: "michael.stapelberg.ch", xmlUrl: "https://michael.stapelberg.ch/feed.xml", htmlUrl: "https://michael.stapelberg.ch" },
  { name: "miguelgrinberg.com", xmlUrl: "https://blog.miguelgrinberg.com/feed", htmlUrl: "https://miguelgrinberg.com" },
  { name: "keygen.sh", xmlUrl: "https://keygen.sh/blog/feed.xml", htmlUrl: "https://keygen.sh" },
  { name: "mjg59.dreamwidth.org", xmlUrl: "https://mjg59.dreamwidth.org/data/rss", htmlUrl: "https://mjg59.dreamwidth.org" },
  { name: "computer.rip", xmlUrl: "https://computer.rip/rss.xml", htmlUrl: "https://computer.rip" },
  { name: "tedunangst.com", xmlUrl: "https://www.tedunangst.com/flak/rss", htmlUrl: "https://tedunangst.com" },

  // ── Design & Generative AI Blogs ──
  { name: "Hugging Face Blog", xmlUrl: "https://huggingface.co/blog/feed.xml", htmlUrl: "https://huggingface.co/blog" },
  { name: "Lilian Weng", xmlUrl: "https://lilianweng.github.io/index.xml", htmlUrl: "https://lilianweng.github.io" },
  { name: "The Decoder", xmlUrl: "https://the-decoder.com/feed/", htmlUrl: "https://the-decoder.com", tier: "secondary" },
  { name: "Replicate Blog", xmlUrl: "https://replicate.com/blog/rss", htmlUrl: "https://replicate.com/blog" },
  { name: "NVIDIA Technical Blog", xmlUrl: "https://developer.nvidia.com/blog/feed/", htmlUrl: "https://developer.nvidia.com/blog" },
  { name: "Stability AI Blog", xmlUrl: "https://stability.ai/blog/feed", htmlUrl: "https://stability.ai/blog" },
  { name: "Google DeepMind Blog", xmlUrl: "https://deepmind.google/blog/rss.xml", htmlUrl: "https://deepmind.google/blog" },
  { name: "Runway Research", xmlUrl: "https://research.runwayml.com/feed.xml", htmlUrl: "https://research.runwayml.com" },

  // ── Additional Sources: HN, Reddit, Product Hunt, Lobste.rs ──
  { name: "Hacker News Best", xmlUrl: "https://hnrss.org/best", htmlUrl: "https://news.ycombinator.com", tier: "aggregator" },
  { name: "r/programming", xmlUrl: "https://www.reddit.com/r/programming/top/.rss?t=day", htmlUrl: "https://www.reddit.com/r/programming", tier: "community" },
  { name: "r/MachineLearning", xmlUrl: "https://www.reddit.com/r/MachineLearning/top/.rss?t=day", htmlUrl: "https://www.reddit.com/r/MachineLearning", tier: "community" },
  { name: "r/LocalLLaMA", xmlUrl: "https://www.reddit.com/r/LocalLLaMA/top/.rss?t=day", htmlUrl: "https://www.reddit.com/r/LocalLLaMA", tier: "community" },
  { name: "r/StableDiffusion", xmlUrl: "https://www.reddit.com/r/StableDiffusion/top/.rss?t=day", htmlUrl: "https://www.reddit.com/r/StableDiffusion", tier: "community" },
  { name: "r/midjourney", xmlUrl: "https://www.reddit.com/r/midjourney/top/.rss?t=day", htmlUrl: "https://www.reddit.com/r/midjourney", tier: "community" },
  { name: "r/comfyui", xmlUrl: "https://www.reddit.com/r/comfyui/top/.rss?t=day", htmlUrl: "https://www.reddit.com/r/comfyui", tier: "community" },
  { name: "r/singularity", xmlUrl: "https://www.reddit.com/r/singularity/top/.rss?t=day", htmlUrl: "https://www.reddit.com/r/singularity", tier: "community" },
  { name: "Product Hunt", xmlUrl: "https://www.producthunt.com/feed", htmlUrl: "https://www.producthunt.com", tier: "aggregator" },
  { name: "Lobste.rs", xmlUrl: "https://lobste.rs/rss", htmlUrl: "https://lobste.rs", tier: "aggregator" },
];

// X/Twitter feeds via RSSHub proxy
const RSSHUB_BASE_URL = (process.env.RSSHUB_BASE_URL || 'https://rsshub.app').replace(/\/+$/, '');
const X_ACCOUNTS = process.env.X_ACCOUNTS || '';

function buildXFeeds(): Array<{ name: string; xmlUrl: string; htmlUrl: string }> {
  if (!X_ACCOUNTS.trim()) return [];
  return X_ACCOUNTS.split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(account => ({
      name: `𝕏 @${account}`,
      xmlUrl: `${RSSHUB_BASE_URL}/twitter/user/${account}`,
      htmlUrl: `https://x.com/${account}`,
    }));
}

// ============================================================================
// Types
// ============================================================================

type CategoryId = 'ai-ml' | 'security' | 'engineering' | 'tools' | 'opinion' | 'other';

const CATEGORY_META: Record<CategoryId, { emoji: string; label: string }> = {
  'ai-ml':       { emoji: '🤖', label: 'AI / ML' },
  'security':    { emoji: '🔒', label: '安全' },
  'engineering': { emoji: '⚙️', label: '工程' },
  'tools':       { emoji: '🛠', label: '工具 / 开源' },
  'opinion':     { emoji: '💡', label: '观点 / 杂谈' },
  'other':       { emoji: '📝', label: '其他' },
};

type SourceTier = 'first-party' | 'research' | 'secondary' | 'community' | 'aggregator';
type VerificationStatus = 'first-party' | 'secondary' | 'traceable-secondary' | 'unverified';
type ProjectSelectionPreset = 'strict' | 'balanced' | 'broad';
type ResearchMode = 'disabled' | 'section' | 'replace-generic' | 'hybrid';
type ProjectMatchType = 'direct' | 'transferable' | 'adjacent';
type AIRelation = 'direct' | 'enabling' | 'none';

interface FeedSource {
  name: string;
  xmlUrl: string;
  htmlUrl: string;
  tier?: SourceTier;
  tags?: string[];
  maxTopItems?: number;
}

interface Article {
  title: string;
  link: string;
  pubDate: Date;
  description: string;
  sourceName: string;
  sourceUrl: string;
  sourceTier?: SourceTier;
  sourceTags?: string[];
  sourceMaxTopItems?: number;
}

interface ScoredArticle extends Article {
  score: number;
  scoreBreakdown: {
    relevance: number;
    quality: number;
    timeliness: number;
  };
  category: CategoryId;
  keywords: string[];
  projectMatches: ProjectMatch[];
  titleZh: string;
  summary: string;
  reason: string;
  projectCooldownIds?: string[];
}

interface ProjectConfig {
  id: string;
  name: string;
  goal: string;
  requiredSignalGroups: string[][];
  requiredSignals: string[];
  supportingSignals: string[];
  negativeSignals: string[];
  keywords: string[];
  entities: string[];
  exclude: string[];
  selection: ProjectSelection;
  sourcePreferences: ProjectSourcePreferences;
}

interface DigestPolicy {
  includeGeneric: boolean;
  genericMaxItems: number;
}

interface LoadedProjectConfig {
  projects: ProjectConfig[];
  digestPolicy: DigestPolicy;
  researchPolicy: ResearchPolicy;
}

interface ResearchPolicy {
  enabled: boolean;
  mode: ResearchMode;
  topics: string[];
  maxItems: number;
  candidateLimit: number;
  minFrontierScore: number;
  minEvidenceScore: number;
  minAttentionScore: number;
}

interface ResearchAssessment {
  frontierScore: number;
  evidenceScore: number;
  impactScore: number;
  reproducibilityScore: number;
  whyImportant: string;
  limitations: string;
}

interface ResearchIntelligenceArticle extends ScoredArticle {
  researchAssessment: ResearchAssessment;
  attentionScore: number;
  attentionSignals: string[];
}

interface ProjectSelection {
  preset: ProjectSelectionPreset;
  minMatchRelevance: number;
  minSectionRelevance: number;
  minArticleQuality: number;
  minActionability: number;
  maxItems: number;
}

interface ProjectSourcePreferences {
  preferredTiers: SourceTier[];
  preferredTags: string[];
}

interface ProjectMatch {
  projectId: string;
  matchType?: ProjectMatchType;
  projectRelevance: number;
  actionability: number;
  whyRelevant: string;
  recommendedAction: string;
}

interface SourceHealthRecord {
  name: string;
  consecutiveFailures: number;
  lastAttempt: string;
  lastSuccess?: string;
  lastError?: string;
}

interface SourceHealthFile {
  version: 1;
  sources: Record<string, SourceHealthRecord>;
}

interface ArticleScore {
  aiRelevance: number;
  aiRelation: AIRelation;
  aiEvidence: string;
  relevance: number;
  quality: number;
  timeliness: number;
  category: CategoryId;
  keywords: string[];
  projectMatches: ProjectMatch[];
}

const MIN_GENERIC_AI_RELEVANCE = 6;
const EXPLICIT_AI_CONTEXT_REGEX = /\b(?:ai|artificial intelligence|machine learning|deep learning|generative ai|ai systems?|ai models?|ai agents?|agentic|llms?|large language models?|language models?|foundation models?|reasoning models?|multimodal|vision[- ]language|text[- ]to[- ]image|diffusion models?|transformers?|neural networks?|speech recognition|automatic speech recognition|asr|optical character recognition|ocr|model (?:training|inference|serving|release|benchmark|evaluation|weights?|parameters?)|\d+(?:\.\d+)?[bm]\s+(?:parameter )?models?|training (?:cluster|pipeline)|inference (?:cluster|service|server)|prompt injection|jailbreak|tool calling|chatgpt|claude|gemini|copilot|grok|deepseek|llama|mistral|nemotron|pytorch|tensorflow|hugging face|cuda)\b|人工智能|机器学习|深度学习|大模型|语言模型|基础模型|推理模型|多模态|智能体|模型训练|模型推理|推理服务|提示注入|越狱|工具调用|语音识别|文档理解|计算机视觉/i;

export function isAIQualifiedForGeneric(
  score: Pick<ArticleScore, 'aiRelevance' | 'aiRelation' | 'aiEvidence'>,
  article?: Pick<Article, 'title' | 'description'>
): boolean {
  return score.aiRelevance >= MIN_GENERIC_AI_RELEVANCE
    && (score.aiRelation === 'direct' || score.aiRelation === 'enabling')
    && score.aiEvidence.trim().length > 0
    && (!article || EXPLICIT_AI_CONTEXT_REGEX.test(`${article.title} ${article.description}`));
}

function getProjectMatchType(match: ProjectMatch): Exclude<ProjectMatchType, 'adjacent'> | 'adjacent' {
  return match.matchType || (match.projectRelevance >= 9 ? 'direct' : 'transferable');
}

interface GeminiScoringResult {
  results?: unknown;
}

interface GeminiSummaryResult {
  results?: unknown;
}

interface ArticleSummary {
  titleZh: string;
  summary: string;
  reason: string;
}

type AITask = 'scoring' | 'project-scoring' | 'research-scoring' | 'summary' | 'highlights' | 'design';
type AIProvider = 'gemini' | 'openai';

interface AIClient {
  call(prompt: string, task: AITask): Promise<string>;
}

interface TrendingRepo {
  name: string;
  url: string;
  description: string;
  stars: number;
  todayStars: number;
  language: string;
  forks: number;
}

// ============================================================================
// Design & Generative AI
// ============================================================================

type DesignSubCategory = 'generative-ui' | 'generative-image' | 'world-model' | 'generative-video';

const DESIGN_SUB_CATEGORY_META: Record<DesignSubCategory, { emoji: string; label: string; labelEn: string }> = {
  'generative-ui':    { emoji: '🖥️', label: '生成式 UI', labelEn: 'Generative UI' },
  'generative-image': { emoji: '🖼️', label: '生成式图片', labelEn: 'Generative Image' },
  'world-model':      { emoji: '🌍', label: '世界模型 / 3D', labelEn: 'World Model / 3D' },
  'generative-video': { emoji: '🎬', label: '生成式视频', labelEn: 'Generative Video' },
};

interface DesignArticle {
  title: string;
  link: string;
  pubDate: Date;
  sourceName: string;
  subCategory: DesignSubCategory;
  titleZh: string;
  oneLiner: string;
}

const DESIGN_KEYWORDS_REGEX = /\b(v0\.dev|claude.?artifact|a2ui|pencil\.li|generative.?ui|ai.?ui|ui.?generat|stable.?diffusion|midjourney|dall[\-\.]?e|flux\.?1|comfyui|nanobanana|firefly|controlnet|lora|img2img|txt2img|inpaint|outpaint|dreambooth|sdxl|sd3|imagen|ideogram|recraft|playground.?ai|world.?model|gaussian.?splat|nerf|3d.?generat|scene.?generat|point.?cloud|radiance.?field|3d.?gaussian|instant.?ngp|sora|runway|pika|kling|veo|gen[\-\s]?[23]|luma.?ai|animate.?diff|svd|stable.?video|mora|cogvideo|video.?generat|text.?to.?video)\b/i;

const MAX_DESIGN_CANDIDATES = 15;

function matchesDesignKeywords(article: { title: string; keywords: string[] }): boolean {
  const text = `${article.title} ${article.keywords.join(' ')}`;
  return DESIGN_KEYWORDS_REGEX.test(text);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function buildDesignCategorizationPrompt(articles: Array<{ index: number; title: string; description: string; sourceName: string }>, lang: string): string {
  const langLabel = lang === 'zh' ? '中文' : 'English';
  const items = articles.map(a => `[${a.index}] "${a.title}" — ${a.sourceName}\n    ${stripHtml(a.description).slice(0, 200)}`).join('\n');
  return `You are a tech editor. Classify each article into ONE sub-category and generate a ${langLabel} title + one-liner summary.

Sub-categories:
- generative-ui: AI-powered UI generation (v0, Claude Artifacts, Vercel AI SDK UI, etc.)
- generative-image: AI image generation (Stable Diffusion, Midjourney, DALL-E, Flux, ComfyUI, etc.)
- world-model: 3D/world models (NeRF, Gaussian Splatting, 3D generation, scene generation)
- generative-video: AI video generation (Sora, Runway, Pika, Kling, Veo, etc.)

Articles:
${items}

Return ONLY valid JSON (no markdown fences):
{"results":[{"index":0,"subCategory":"generative-image","titleZh":"中文标题","oneLiner":"一句话摘要"}]}`;
}

async function categorizeDesignArticles(
  candidates: Array<{ index: number; title: string; link: string; pubDate: Date; description: string; sourceName: string; keywords: string[] }>,
  aiClient: AIClient,
  lang: string,
): Promise<DesignArticle[]> {
  if (candidates.length === 0) return [];

  const prompt = buildDesignCategorizationPrompt(
    candidates.map((c, i) => ({ index: i, title: c.title, description: c.description, sourceName: c.sourceName })),
    lang,
  );

  try {
    const raw = await aiClient.call(prompt, 'design');
    const cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned) as { results: Array<{ index: number; subCategory: string; titleZh: string; oneLiner: string }> };

    const validSubs = new Set<string>(['generative-ui', 'generative-image', 'world-model', 'generative-video']);

    return parsed.results
      .filter(r => r.index >= 0 && r.index < candidates.length)
      .map(r => {
        const c = candidates[r.index];
        return {
          title: c.title,
          link: c.link,
          pubDate: c.pubDate,
          sourceName: c.sourceName,
          subCategory: (validSubs.has(r.subCategory) ? r.subCategory : 'generative-image') as DesignSubCategory,
          titleZh: r.titleZh || c.title,
          oneLiner: r.oneLiner || c.title,
        };
      });
  } catch (err) {
    console.warn(`[digest] ⚠️ Design categorization failed: ${err instanceof Error ? err.message : String(err)}`);
    return candidates.map(c => ({
      title: c.title,
      link: c.link,
      pubDate: c.pubDate,
      sourceName: c.sourceName,
      subCategory: 'generative-image' as DesignSubCategory,
      titleZh: c.title,
      oneLiner: c.title,
    }));
  }
}

// ============================================================================
// ClawFeed & GitHub Trending
// ============================================================================

async function fetchClawFeedDigest(): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);

    const response = await fetch('https://clawfeed.kevinhe.io/api/digests?type=daily&limit=1&offset=0', {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json() as Array<{ content?: string }>;
    const content = data?.[0]?.content || '';
    if (content) {
      console.log(`[digest] ClawFeed: fetched daily digest (${content.length} chars)`);
    }
    return content;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[digest] ClawFeed: fetch failed (${msg})`);
    return '';
  }
}

function extractClawFeedSections(markdown: string): string {
  if (!markdown) return '';

  // Extract key sections: headlines, top 10, recommended follows, observations
  const sections = ['🔥 今日头条', '📰 精选 Top 10', '👀 今日推荐关注', '🧹 今日建议取关', '📊 今日观察'];
  let result = '';

  for (const section of sections) {
    const pattern = new RegExp(`## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n([\\s\\S]*?)(?=\\n## |$)`);
    const match = markdown.match(pattern);
    if (match) {
      result += `### ${section}\n\n${match[1].trim()}\n\n`;
    }
  }

  return result || markdown;
}

async function fetchGitHubTrendingPage(language?: string): Promise<TrendingRepo[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);

    const langParam = language ? `/${language}` : '';
    const url = `https://github.com/trending${langParam}?since=daily`;

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AI-Daily-Digest/1.0',
        'Accept': 'text/html',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const repos: TrendingRepo[] = [];

    const articles = html.split('<article class="Box-row">');
    for (let i = 1; i < articles.length; i++) {
      const art = articles[i];

      // repo path: <h2 ...><a href="/owner/repo">
      const repoMatch = art.match(/<h2[^>]*>\s*<a[^>]*href="\/([^"]+)"/);
      if (!repoMatch) continue;

      const name = repoMatch[1];
      const url = `https://github.com/${name}`;

      // description
      const descMatch = art.match(/<p class="col-9[^"]*">\s*([\s\S]*?)\s*<\/p>/);
      const description = descMatch ? descMatch[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim() : '';

      // language
      const langMatch = art.match(/itemprop="programmingLanguage"[^>]*>([^<]+)/);
      const lang = langMatch ? langMatch[1].trim() : '';

      // total stars
      const starsMatch = art.match(/href="[^"]*\/stargazers"[^>]*>\s*<svg[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/);
      const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, ''), 10) : 0;

      // forks
      const forkMatch = art.match(/href="[^"]*\/forks"[^>]*>\s*<svg[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/);
      const forks = forkMatch ? parseInt(forkMatch[1].replace(/,/g, ''), 10) : 0;

      // today stars
      const todayMatch = art.match(/([\d,]+)\s*stars today/);
      const todayStars = todayMatch ? parseInt(todayMatch[1].replace(/,/g, ''), 10) : 0;

      repos.push({ name, url, description, stars, todayStars, language: lang, forks });
    }

    return repos;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[digest] GitHub Trending${language ? ` (${language})` : ''}: fetch failed (${msg})`);
    return [];
  }
}

async function fetchGitHubTrending(): Promise<TrendingRepo[]> {
  const [allLang, pythonLang] = await Promise.all([
    fetchGitHubTrendingPage(),
    fetchGitHubTrendingPage('python'),
  ]);

  // Merge and dedup by repo name
  const seen = new Set<string>();
  const merged: TrendingRepo[] = [];

  for (const repo of [...allLang, ...pythonLang]) {
    if (!seen.has(repo.name)) {
      seen.add(repo.name);
      merged.push(repo);
    }
  }

  // Sort by today's stars descending, take top 15
  merged.sort((a, b) => b.todayStars - a.todayStars);
  const result = merged.slice(0, 15);

  console.log(`[digest] GitHub Trending: ${allLang.length} all-lang + ${pythonLang.length} Python → ${merged.length} unique → Top ${result.length}`);
  return result;
}

function formatStarCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ============================================================================
// RSS/Atom Parsing (using Bun's built-in HTMLRewriter or manual XML parsing)
// ============================================================================

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .trim();
}

function extractCDATA(text: string): string {
  const cdataMatch = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return cdataMatch ? cdataMatch[1] : text;
}

function getTagContent(xml: string, tagName: string): string {
  // Handle namespaced and non-namespaced tags
  const patterns = [
    new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'),
    new RegExp(`<${tagName}[^>]*/>`, 'i'), // self-closing
  ];
  
  for (const pattern of patterns) {
    const match = xml.match(pattern);
    if (match?.[1]) {
      return extractCDATA(match[1]).trim();
    }
  }
  return '';
}

function getAttrValue(xml: string, tagName: string, attrName: string): string {
  const pattern = new RegExp(`<${tagName}[^>]*\\s${attrName}=["']([^"']*)["'][^>]*/?>`, 'i');
  const match = xml.match(pattern);
  return match?.[1] || '';
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  
  // Try common RSS date formats
  // RFC 822: "Mon, 01 Jan 2024 00:00:00 GMT"
  const rfc822 = dateStr.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (rfc822) {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  
  return null;
}

function parseRSSItems(xml: string): Array<{ title: string; link: string; pubDate: string; description: string }> {
  const items: Array<{ title: string; link: string; pubDate: string; description: string }> = [];
  
  // Detect format: Atom vs RSS
  const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"') || xml.includes('<feed ');
  
  if (isAtom) {
    // Atom format: <entry>
    const entryPattern = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    let entryMatch;
    while ((entryMatch = entryPattern.exec(xml)) !== null) {
      const entryXml = entryMatch[1];
      const title = stripHtml(getTagContent(entryXml, 'title'));
      
      // Atom link: <link href="..." rel="alternate"/>
      let link = getAttrValue(entryXml, 'link[^>]*rel="alternate"', 'href');
      if (!link) {
        link = getAttrValue(entryXml, 'link', 'href');
      }
      
      const pubDate = getTagContent(entryXml, 'published') 
        || getTagContent(entryXml, 'updated');
      
      const description = stripHtml(
        getTagContent(entryXml, 'summary') 
        || getTagContent(entryXml, 'content')
      );
      
      if (title || link) {
        items.push({ title, link, pubDate, description: description.slice(0, 500) });
      }
    }
  } else {
    // RSS format: <item>
    const itemPattern = /<item[\s>]([\s\S]*?)<\/item>/gi;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(xml)) !== null) {
      const itemXml = itemMatch[1];
      const title = stripHtml(getTagContent(itemXml, 'title'));
      const link = getTagContent(itemXml, 'link') || getTagContent(itemXml, 'guid');
      const pubDate = getTagContent(itemXml, 'pubDate') 
        || getTagContent(itemXml, 'dc:date')
        || getTagContent(itemXml, 'date');
      const description = stripHtml(
        getTagContent(itemXml, 'description') 
        || getTagContent(itemXml, 'content:encoded')
      );
      
      if (title || link) {
        items.push({ title, link, pubDate, description: description.slice(0, 500) });
      }
    }
  }
  
  return items;
}

// ============================================================================
// Feed Fetching
// ============================================================================

interface FeedFetchResult {
  articles: Article[];
  error?: string;
}

async function fetchFeed(feed: FeedSource): Promise<FeedFetchResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);
    
    const response = await fetch(feed.xmlUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AI-Daily-Digest/1.0 (RSS Reader)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const xml = await response.text();
    const items = parseRSSItems(xml);
    
    return { articles: items.map(item => ({
      title: item.title,
      link: item.link,
      pubDate: parseDate(item.pubDate) || new Date(0),
      description: item.description,
      sourceName: feed.name,
      sourceUrl: feed.htmlUrl,
      sourceTier: feed.tier,
      sourceTags: feed.tags,
      sourceMaxTopItems: feed.maxTopItems,
    })) };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Only log non-abort errors to reduce noise
    if (!msg.includes('abort')) {
      console.warn(`[digest] ✗ ${feed.name}: ${msg}`);
    } else {
      console.warn(`[digest] ✗ ${feed.name}: timeout`);
    }
    return { articles: [], error: msg.includes('abort') ? 'timeout' : msg };
  }
}

async function loadSourceHealth(path: string): Promise<SourceHealthFile> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<SourceHealthFile>;
    return parsed.version === 1 && parsed.sources && typeof parsed.sources === 'object'
      ? { version: 1, sources: parsed.sources }
      : { version: 1, sources: {} };
  } catch {
    return { version: 1, sources: {} };
  }
}

async function saveSourceHealth(path: string, health: SourceHealthFile): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(health, null, 2)}\n`);
  } catch (error) {
    console.warn(`[digest] Source health: could not save state (${error instanceof Error ? error.message : String(error)})`);
  }
}

export function shouldPauseUnhealthySource(record: SourceHealthRecord | undefined, now: Date): boolean {
  if (!record || record.consecutiveFailures < SOURCE_HEALTH_PAUSE_FAILURES) return false;
  const lastAttempt = Date.parse(record.lastAttempt);
  return Number.isFinite(lastAttempt) && now.getTime() - lastAttempt < SOURCE_HEALTH_RETRY_INTERVAL_MS;
}

async function fetchAllFeeds(feeds: FeedSource[], healthPath: string): Promise<Article[]> {
  const allArticles: Article[] = [];
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  const now = new Date();
  const health = await loadSourceHealth(healthPath);
  const activeFeeds = feeds.filter(feed => {
    if (!shouldPauseUnhealthySource(health.sources[feed.xmlUrl], now)) return true;
    skippedCount++;
    return false;
  });
  if (skippedCount > 0) {
    console.warn(`[digest] Source health: temporarily skipped ${skippedCount} source(s) after ${SOURCE_HEALTH_PAUSE_FAILURES}+ consecutive failures; retry interval 72h`);
  }
  
  for (let i = 0; i < activeFeeds.length; i += FEED_CONCURRENCY) {
    const batch = activeFeeds.slice(i, i + FEED_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(fetchFeed));
    
    for (let offset = 0; offset < results.length; offset++) {
      const result = results[offset]!;
      const feed = batch[offset]!;
      const previous = health.sources[feed.xmlUrl];
      if (result.status === 'fulfilled' && result.value.articles.length > 0) {
        allArticles.push(...result.value.articles);
        successCount++;
        delete health.sources[feed.xmlUrl];
      } else {
        failCount++;
        const error = result.status === 'rejected'
          ? result.reason instanceof Error ? result.reason.message : String(result.reason)
          : result.value.error || 'empty feed';
        const consecutiveFailures = (previous?.consecutiveFailures || 0) + 1;
        health.sources[feed.xmlUrl] = {
          name: feed.name,
          consecutiveFailures,
          lastAttempt: now.toISOString(),
          lastSuccess: previous?.lastSuccess,
          lastError: error.slice(0, 200),
        };
        if (consecutiveFailures >= SOURCE_HEALTH_WARNING_FAILURES) {
          console.warn(`[digest] Source health warning: ${feed.name} failed ${consecutiveFailures} consecutive run(s) (${error})`);
        }
      }
    }
    
    const progress = Math.min(i + FEED_CONCURRENCY, activeFeeds.length);
    console.log(`[digest] Progress: ${progress}/${activeFeeds.length} active feeds processed (${successCount} ok, ${failCount} failed, ${skippedCount} paused)`);
  }
  
  await saveSourceHealth(healthPath, health);
  console.log(`[digest] Fetched ${allArticles.length} articles from ${successCount} feeds (${failCount} failed, ${skippedCount} paused)`);
  return allArticles;
}

// ============================================================================
// AI Providers (Gemini + OpenAI-compatible fallback)
// ============================================================================

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  providerLabel: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${providerLabel} request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function logAIUsage(
  provider: string,
  model: string,
  task: AITask,
  usage: {
    input?: number;
    output?: number;
    reasoning?: number;
    cached?: number;
    total?: number;
  } | undefined
): void {
  if (!usage) return;

  const values = [
    ['input', usage.input],
    ['output', usage.output],
    ['reasoning', usage.reasoning],
    ['cached', usage.cached],
    ['total', usage.total],
  ]
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .map(([name, value]) => `${name}=${value}`)
    .join(' ');

  if (values) {
    console.log(`[digest] AI usage: provider=${provider} model=${model} task=${task} ${values}`);
  }
}

async function callGemini(
  prompt: string,
  apiKey: string,
  task: AITask,
  timeoutMs: number
): Promise<string> {
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [30_000, 60_000, 90_000]; // 30s, 60s, 90s

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetchTextWithTimeout(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          topP: 0.8,
          topK: 40,
        },
      }),
    }, timeoutMs, 'Gemini');

    if (response.status === 429 && attempt < MAX_RETRIES) {
      // Try to parse "retry after Xs" from the error message
      const retryMatch = response.body.match(/retry\s+(?:after\s+|in\s+)([\d.]+)s/i);
      const waitMs = retryMatch
        ? Math.ceil(parseFloat(retryMatch[1]) * 1000)
        : RETRY_DELAYS[attempt];
      const waitSec = Math.round(waitMs / 1000);
      console.warn(`[digest] Gemini 429 rate limited (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${waitSec}s...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      continue;
    }

    if (!response.ok) {
      throw new Error(`Gemini API error (${response.status}): ${response.body || 'Unknown error'}`);
    }

    const data = JSON.parse(response.body) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
        cachedContentTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    logAIUsage('gemini', 'gemini-2.0-flash', task, data.usageMetadata ? {
      input: data.usageMetadata.promptTokenCount,
      output: data.usageMetadata.candidatesTokenCount,
      reasoning: data.usageMetadata.thoughtsTokenCount,
      cached: data.usageMetadata.cachedContentTokenCount,
      total: data.usageMetadata.totalTokenCount,
    } : undefined);

    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  throw new Error('Gemini API: max retries exceeded (429 rate limit)');
}

export function buildOpenAIRequestBody(
  prompt: string,
  model: string,
  task: AITask,
  thinkingTasks: ReadonlySet<AITask>,
  isDeepSeekV4: boolean
): Record<string, unknown> {
  const thinkingEnabled = isDeepSeekV4 && task !== 'scoring' && thinkingTasks.has(task);
  const requestBody: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: prompt }],
  };

  if (isDeepSeekV4) {
    if (task === 'scoring' || task === 'project-scoring' || task === 'research-scoring' || task === 'summary' || task === 'design') {
      requestBody.response_format = { type: 'json_object' };
    }
    requestBody.thinking = { type: thinkingEnabled ? 'enabled' : 'disabled' };
    if (thinkingEnabled) {
      requestBody.reasoning_effort = 'high';
    } else {
      requestBody.temperature = 0.3;
      requestBody.top_p = 0.8;
    }
  } else {
    requestBody.temperature = 0.3;
    requestBody.top_p = 0.8;
  }
  return requestBody;
}

async function callOpenAICompatible(
  prompt: string,
  apiKey: string,
  apiBase: string,
  model: string,
  task: AITask,
  thinkingTasks: ReadonlySet<AITask>,
  timeoutMs: number
): Promise<string> {
  const normalizedBase = apiBase.replace(/\/+$/, '');
  const isDeepSeekV4 = normalizedBase.toLowerCase().includes('api.deepseek.com')
    && model.toLowerCase().startsWith('deepseek-v4-');
  const requestBody = buildOpenAIRequestBody(prompt, model, task, thinkingTasks, isDeepSeekV4);

  const response = await fetchTextWithTimeout(`${normalizedBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  }, timeoutMs, 'OpenAI-compatible AI');

  if (!response.ok) {
    throw new Error(`OpenAI-compatible API error (${response.status}): ${response.body || 'Unknown error'}`);
  }

  const data = JSON.parse(response.body) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_cache_hit_tokens?: number;
      total_tokens?: number;
      completion_tokens_details?: {
        reasoning_tokens?: number;
      };
    };
  };

  const providerLabel = isDeepSeekV4 ? 'deepseek' : 'openai-compatible';
  logAIUsage(providerLabel, model, task, data.usage ? {
    input: data.usage.prompt_tokens,
    output: data.usage.completion_tokens,
    reasoning: data.usage.completion_tokens_details?.reasoning_tokens,
    cached: data.usage.prompt_cache_hit_tokens,
    total: data.usage.total_tokens,
  } : undefined);

  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(item => item.type === 'text' && typeof item.text === 'string')
      .map(item => item.text)
      .join('\n');
  }
  return '';
}

function inferOpenAIModel(apiBase: string): string {
  const base = apiBase.toLowerCase();
  if (base.includes('deepseek')) return 'deepseek-v4-flash';
  return OPENAI_DEFAULT_MODEL;
}

function parseDeepSeekThinkingTasks(value: string | undefined): Set<AITask> {
  const validTasks = new Set<AITask>(['project-scoring', 'research-scoring', 'summary', 'highlights', 'design']);
  const configured = (value?.trim().toLowerCase() || DEFAULT_DEEPSEEK_THINKING_TASKS);

  if (configured === 'all') return new Set(validTasks);
  if (configured === 'none') return new Set();

  const tasks = new Set<AITask>();
  for (const name of configured.split(',').map(item => item.trim()).filter(Boolean)) {
    if (name === 'scoring') {
      tasks.add('project-scoring');
      continue;
    }
    if (validTasks.has(name as AITask)) {
      tasks.add(name as AITask);
    } else {
      console.warn(`[digest] Ignoring unknown DeepSeek thinking task: ${name}`);
    }
  }
  return tasks;
}

function parseAIPrimaryProvider(value: string | undefined): AIProvider {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'gemini') return 'gemini';
  if (normalized === 'openai' || normalized === 'deepseek') return 'openai';
  console.warn(`[digest] Unknown AI_PRIMARY_PROVIDER=${normalized}; defaulting to gemini`);
  return 'gemini';
}

function parseAIRequestTimeout(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_AI_REQUEST_TIMEOUT_MS;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 1_000) return Math.round(parsed);
  console.warn(`[digest] Invalid AI_REQUEST_TIMEOUT_MS=${value}; using ${DEFAULT_AI_REQUEST_TIMEOUT_MS}`);
  return DEFAULT_AI_REQUEST_TIMEOUT_MS;
}

function resolveAIProviderOrder(
  preferred: AIProvider,
  hasGemini: boolean,
  hasOpenAI: boolean
): AIProvider[] {
  const available = new Set<AIProvider>();
  if (hasGemini) available.add('gemini');
  if (hasOpenAI) available.add('openai');

  return [preferred, preferred === 'gemini' ? 'openai' : 'gemini']
    .filter((provider): provider is AIProvider => available.has(provider));
}

export function createAIClient(config: {
  geminiApiKey?: string;
  openaiApiKey?: string;
  openaiApiBase?: string;
  openaiModel?: string;
  deepseekThinkingTasks: ReadonlySet<AITask>;
  primaryProvider: AIProvider;
  requestTimeoutMs: number;
}): AIClient {
  const state = {
    geminiApiKey: config.geminiApiKey?.trim() || '',
    openaiApiKey: config.openaiApiKey?.trim() || '',
    openaiApiBase: (config.openaiApiBase?.trim() || OPENAI_DEFAULT_API_BASE).replace(/\/+$/, ''),
    openaiModel: config.openaiModel?.trim() || '',
    providers: resolveAIProviderOrder(
      config.primaryProvider,
      Boolean(config.geminiApiKey?.trim()),
      Boolean(config.openaiApiKey?.trim())
    ),
    failedProviders: new Set<AIProvider>(),
    fallbackLogged: false,
  };

  if (!state.openaiModel) {
    state.openaiModel = inferOpenAIModel(state.openaiApiBase);
  }

  const callProvider = (provider: AIProvider, prompt: string, task: AITask): Promise<string> => {
    if (provider === 'gemini') {
      return callGemini(prompt, state.geminiApiKey, task, config.requestTimeoutMs);
    }
    return callOpenAICompatible(
      prompt,
      state.openaiApiKey,
      state.openaiApiBase,
      state.openaiModel,
      task,
      config.deepseekThinkingTasks,
      config.requestTimeoutMs
    );
  };

  return {
    async call(prompt: string, task: AITask): Promise<string> {
      const provider = state.providers.find(item => !state.failedProviders.has(item));
      if (!provider) throw new Error('No working AI provider available.');

      try {
        return await callProvider(provider, prompt, task);
      } catch (error) {
        const fallback = state.providers.find(item => item !== provider && !state.failedProviders.has(item));
        if (!fallback) throw error;

        state.failedProviders.add(provider);
        if (!state.fallbackLogged) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`[digest] ${provider} failed, switching to ${fallback} fallback. Reason: ${reason}`);
          state.fallbackLogged = true;
        }
        return callProvider(fallback, prompt, task);
      }
    },
  };
}

function parseJsonResponse<T>(text: string): T {
  let jsonText = text.trim();
  // Strip markdown code blocks if present
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(jsonText) as T;
}

// ============================================================================
// Project Configuration & Validation
// ============================================================================

function truncateText(value: unknown, maxLength = MAX_PROJECT_TEXT_LENGTH): string {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeSignalGroups(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value
    .map(group => normalizeStringArray(group))
    .filter(group => group.length > 0);
}

const PROJECT_SELECTION_PRESETS: Record<ProjectSelectionPreset, ProjectSelection> = {
  strict: {
    preset: 'strict',
    minMatchRelevance: 7,
    minSectionRelevance: 8,
    minArticleQuality: 7,
    minActionability: 6,
    maxItems: 2,
  },
  balanced: {
    preset: 'balanced',
    minMatchRelevance: 6,
    minSectionRelevance: 7,
    minArticleQuality: 5,
    minActionability: 1,
    maxItems: 2,
  },
  broad: {
    preset: 'broad',
    minMatchRelevance: 5,
    minSectionRelevance: 6,
    minArticleQuality: 4,
    minActionability: 1,
    maxItems: 3,
  },
};

const SOURCE_TIERS = new Set<SourceTier>(['first-party', 'research', 'secondary', 'community', 'aggregator']);

function normalizeBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeProjectSelection(value: unknown): ProjectSelection {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const preset = typeof record.preset === 'string' && Object.hasOwn(PROJECT_SELECTION_PRESETS, record.preset)
    ? record.preset as ProjectSelectionPreset
    : 'balanced';
  const defaults = PROJECT_SELECTION_PRESETS[preset];

  return {
    preset,
    minMatchRelevance: normalizeBoundedInteger(record.minMatchRelevance, defaults.minMatchRelevance, 1, 10),
    minSectionRelevance: normalizeBoundedInteger(record.minSectionRelevance, defaults.minSectionRelevance, 1, 10),
    minArticleQuality: normalizeBoundedInteger(record.minArticleQuality, defaults.minArticleQuality, 1, 10),
    minActionability: normalizeBoundedInteger(record.minActionability, defaults.minActionability, 1, 10),
    maxItems: normalizeBoundedInteger(record.maxItems, defaults.maxItems, 1, 10),
  };
}

function normalizeSourceTiers(value: unknown): SourceTier[] {
  return normalizeStringArray(value)
    .filter((tier): tier is SourceTier => SOURCE_TIERS.has(tier as SourceTier));
}

function normalizeProjectSourcePreferences(value: unknown): ProjectSourcePreferences {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    preferredTiers: normalizeSourceTiers(record.preferredTiers),
    preferredTags: normalizeStringArray(record.preferredTags),
  };
}

function normalizeSignalText(value: string): string {
  return ` ${value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
}

export function satisfiesRequiredSignalGroups(project: ProjectConfig, articleText: string): boolean {
  if (project.requiredSignalGroups.length === 0) return true;

  const normalizedArticle = normalizeSignalText(articleText);
  return project.requiredSignalGroups.every(group =>
    group.some(signal => {
      const normalizedSignal = normalizeSignalText(signal).trim();
      return normalizedSignal.length > 0 && normalizedArticle.includes(` ${normalizedSignal} `);
    })
  );
}

function clampScore(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(10, Math.max(1, Math.round(numeric)));
}

export function validateProjectEntry(value: unknown, index: number): ProjectConfig | null {
  if (!value || typeof value !== 'object') {
    console.warn(`[digest] Project config: skipping project at index ${index} (not an object)`);
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = truncateText(record.id, 80);
  const name = truncateText(record.name, 120);
  const goal = truncateText(record.goal, 500);
  const keywords = normalizeStringArray(record.keywords);

  if (!id || !name || !goal || keywords.length === 0) {
    console.warn(`[digest] Project config: skipping project at index ${index} (missing id, name, goal, or keywords)`);
    return null;
  }

  return {
    id,
    name,
    goal,
    requiredSignalGroups: normalizeSignalGroups(record.requiredSignalGroups),
    requiredSignals: normalizeStringArray(record.requiredSignals),
    supportingSignals: normalizeStringArray(record.supportingSignals),
    negativeSignals: normalizeStringArray(record.negativeSignals),
    keywords,
    entities: normalizeStringArray(record.entities),
    exclude: normalizeStringArray(record.exclude),
    selection: normalizeProjectSelection(record.selection),
    sourcePreferences: normalizeProjectSourcePreferences(record.sourcePreferences),
  };
}

export function validateProjectsConfig(value: unknown): ProjectConfig[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { projects?: unknown }).projects)) return [];

  const seen = new Set<string>();
  return ((value as { projects: unknown[] }).projects)
    .map((entry, index) => validateProjectEntry(entry, index))
    .filter((project): project is ProjectConfig => {
      if (!project) return false;
      if (seen.has(project.id)) {
        console.warn(`[digest] Project config: skipping duplicate project id ${project.id}`);
        return false;
      }
      seen.add(project.id);
      return true;
    });
}

function validateDigestPolicy(value: unknown): DigestPolicy {
  const defaults: DigestPolicy = {
    includeGeneric: true,
    genericMaxItems: DEFAULT_GENERIC_MAX_ITEMS,
  };
  if (!value || typeof value !== 'object') return defaults;

  const record = value as Record<string, unknown>;
  return {
    includeGeneric: typeof record.includeGeneric === 'boolean' ? record.includeGeneric : defaults.includeGeneric,
    genericMaxItems: normalizeBoundedInteger(record.genericMaxItems, defaults.genericMaxItems, 0, 50),
  };
}

function validateResearchPolicy(value: unknown): ResearchPolicy {
  const defaults: ResearchPolicy = {
    enabled: false,
    mode: 'disabled',
    topics: ['llm', 'agent'],
    maxItems: 3,
    candidateLimit: 20,
    minFrontierScore: 7,
    minEvidenceScore: 6,
    minAttentionScore: 4,
  };
  if (!value || typeof value !== 'object') return defaults;

  const record = value as Record<string, unknown>;
  const validModes = new Set<ResearchMode>(['disabled', 'section', 'replace-generic', 'hybrid']);
  const enabled = typeof record.enabled === 'boolean' ? record.enabled : true;
  const mode = typeof record.mode === 'string' && validModes.has(record.mode as ResearchMode)
    ? record.mode as ResearchMode
    : 'hybrid';
  return {
    enabled: enabled && mode !== 'disabled',
    mode: enabled ? mode : 'disabled',
    topics: normalizeStringArray(record.topics).slice(0, 10).length > 0
      ? normalizeStringArray(record.topics).slice(0, 10)
      : defaults.topics,
    maxItems: normalizeBoundedInteger(record.maxItems, defaults.maxItems, 0, 10),
    candidateLimit: normalizeBoundedInteger(record.candidateLimit, defaults.candidateLimit, 1, 50),
    minFrontierScore: normalizeBoundedInteger(record.minFrontierScore, defaults.minFrontierScore, 1, 10),
    minEvidenceScore: normalizeBoundedInteger(record.minEvidenceScore, defaults.minEvidenceScore, 1, 10),
    minAttentionScore: normalizeBoundedInteger(record.minAttentionScore, defaults.minAttentionScore, 1, 10),
  };
}

function resolveDigestPolicy(configPolicy: DigestPolicy): DigestPolicy {
  const mode = process.env.DIGEST_GENERIC_MODE?.trim().toLowerCase();
  if (!mode || mode === 'config') return configPolicy;
  if (mode === 'include') return { ...configPolicy, includeGeneric: true };
  if (mode === 'project-only') return { ...configPolicy, includeGeneric: false };
  console.warn(`[digest] Unknown DIGEST_GENERIC_MODE=${mode}; using config policy`);
  return configPolicy;
}

async function loadProjects(configPath = process.env.PROJECTS_CONFIG_PATH || DEFAULT_PROJECTS_CONFIG_PATH): Promise<LoadedProjectConfig> {
  const fallback: LoadedProjectConfig = {
    projects: [],
    digestPolicy: validateDigestPolicy(undefined),
    researchPolicy: validateResearchPolicy(undefined),
  };
  try {
    const text = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(text) as { projects?: unknown; digestPolicy?: unknown; researchPolicy?: unknown };

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.projects)) {
      console.warn(`[digest] Project config: ${configPath} does not contain a valid projects array; using generic digest`);
      return fallback;
    }

    const projects = validateProjectsConfig(parsed);
    const digestPolicy = validateDigestPolicy(parsed.digestPolicy);
    const researchPolicy = validateResearchPolicy(parsed.researchPolicy);

    console.log(`[digest] Loaded ${projects.length} projects from ${configPath}`);
    if (projects.length === 0) {
      console.warn(`[digest] Project config: no valid projects loaded; using generic digest`);
    }
    return { projects, digestPolicy, researchPolicy };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[digest] Project config: could not load ${configPath} (${msg}); using generic digest`);
    return fallback;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateSourcesConfig(value: unknown): FeedSource[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { sources?: unknown }).sources)) return [];

  const sources: FeedSource[] = [];
  const seenUrls = new Set<string>();
  for (const [index, raw] of ((value as { sources: unknown[] }).sources).entries()) {
    if (!raw || typeof raw !== 'object') {
      console.warn(`[digest] Source config: skipping source at index ${index} (not an object)`);
      continue;
    }
    const record = raw as Record<string, unknown>;
    if (record.enabled === false) continue;

    const name = truncateText(record.name, 120);
    const xmlUrl = truncateText(record.xmlUrl, 500);
    const htmlUrl = truncateText(record.htmlUrl, 500);
    const tier = typeof record.tier === 'string' && SOURCE_TIERS.has(record.tier as SourceTier)
      ? record.tier as SourceTier
      : 'community';
    if (!name || !isHttpUrl(xmlUrl) || !isHttpUrl(htmlUrl) || seenUrls.has(xmlUrl)) {
      console.warn(`[digest] Source config: skipping source at index ${index} (invalid name/URL or duplicate feed)`);
      continue;
    }

    seenUrls.add(xmlUrl);
    const maxTopItems = typeof record.maxTopItems === 'number'
      && Number.isInteger(record.maxTopItems)
      && record.maxTopItems >= 1
      && record.maxTopItems <= 100
      ? record.maxTopItems
      : undefined;
    sources.push({ name, xmlUrl, htmlUrl, tier, tags: normalizeStringArray(record.tags), maxTopItems });
  }
  return sources;
}

export async function loadConfiguredSources(configPath = process.env.SOURCES_CONFIG_PATH || DEFAULT_SOURCES_CONFIG_PATH): Promise<FeedSource[]> {
  try {
    const text = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    const sources = validateSourcesConfig(parsed);
    console.log(`[digest] Loaded ${sources.length} additional sources from ${configPath}`);
    return sources;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[digest] Source config: could not load ${configPath} (${msg}); using built-in sources only`);
    return [];
  }
}

function mergeFeedSources(...groups: FeedSource[][]): FeedSource[] {
  const merged = new Map<string, FeedSource>();
  for (const source of groups.flat()) merged.set(source.xmlUrl, source);
  return [...merged.values()];
}

function validateProjectMatches(
  rawMatches: unknown,
  projectsById: Map<string, ProjectConfig>,
  articleText: string
): ProjectMatch[] {
  if (!Array.isArray(rawMatches)) return [];

  const matches: ProjectMatch[] = [];
  const seen = new Set<string>();

  for (const raw of rawMatches) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const projectId = typeof record.projectId === 'string' ? record.projectId.trim() : '';
    const project = projectsById.get(projectId);
    if (!projectId || !project || seen.has(projectId)) continue;
    if (!satisfiesRequiredSignalGroups(project, articleText)) continue;

    const projectRelevance = clampScore(record.projectRelevance);
    if (projectRelevance < project.selection.minMatchRelevance) continue;
    const matchType: ProjectMatchType = record.matchType === 'direct'
      || record.matchType === 'transferable'
      || record.matchType === 'adjacent'
      ? record.matchType
      : projectRelevance >= 9 ? 'direct' : 'transferable';

    matches.push({
      projectId,
      matchType,
      projectRelevance,
      actionability: clampScore(record.actionability),
      whyRelevant: truncateText(record.whyRelevant),
      recommendedAction: truncateText(record.recommendedAction),
    });
    seen.add(projectId);

    if (matches.length >= MAX_PROJECT_MATCHES_PER_ARTICLE) break;
  }

  return matches.sort((a, b) =>
    b.projectRelevance - a.projectRelevance
    || b.actionability - a.actionability
    || a.projectId.localeCompare(b.projectId)
  );
}

function validateArticleScore(
  rawResult: unknown,
  allowedIndices: Set<number>,
  batchIndices: number[],
  validCategories: Set<string>,
  projectsById: Map<string, ProjectConfig>,
  articleTextByIndex: Map<number, string>
): { index: number; score: ArticleScore } | null {
  if (!rawResult || typeof rawResult !== 'object') return null;

  const record = rawResult as Record<string, unknown>;
  const rawIndex = typeof record.index === 'number'
    ? record.index
    : typeof record.index === 'string' && /^\d+$/.test(record.index.trim())
      ? Number(record.index)
      : NaN;
  if (!Number.isInteger(rawIndex)) return null;

  const index = allowedIndices.has(rawIndex)
    ? rawIndex
    : rawIndex >= 0 && rawIndex < batchIndices.length
      ? batchIndices[rawIndex]!
      : null;
  if (index === null) return null;

  const category = typeof record.category === 'string' && validCategories.has(record.category)
    ? record.category as CategoryId
    : 'other';

  return {
    index,
    score: {
      aiRelevance: clampScore(record.aiRelevance),
      aiRelation: record.aiRelation === 'direct' || record.aiRelation === 'enabling' ? record.aiRelation : 'none',
      aiEvidence: truncateText(record.aiEvidence, 180),
      relevance: clampScore(record.relevance),
      quality: clampScore(record.quality),
      timeliness: clampScore(record.timeliness),
      category,
      keywords: normalizeStringArray(record.keywords).slice(0, 4),
      projectMatches: validateProjectMatches(record.projectMatches, projectsById, articleTextByIndex.get(index) || ''),
    },
  };
}

// ============================================================================
// AI Scoring
// ============================================================================

function buildScoringPrompt(
  articles: Array<{ index: number; title: string; description: string; sourceName: string }>
): string {
  const articlesList = articles.map(a =>
    `Index ${a.index}: [${a.sourceName}] ${a.title}\n${a.description.slice(0, 300)}`
  ).join('\n\n---\n\n');

  return `你是 AI 技术情报编辑，正在为一份以人工智能为核心的每日精选筛选文章。

先判断文章与 AI 的关系，再进行三个维度的评分（1-10 整数，10 分最高），并分配分类标签和提取 2-4 个关键词。

## AI 主题准入

每篇文章必须返回：
- aiRelevance：文章与 AI、机器学习、LLM、Agent、多模态、语音、视觉、模型训练/推理/部署的相关程度，1-10。
- aiRelation：只能是 direct、enabling 或 none。
- aiEvidence：用中文引用或概括标题/摘要中能证明 AI 关系的具体信息，最多 100 字；没有明确证据时返回空字符串。

aiRelation 定义：
- direct：AI 是文章核心主题，例如模型、Agent、AI 产品、AI 安全、AI 政策、多模态或机器学习研究。
- enabling：文章明确影响 AI 系统的训练、推理、部署、数据、算力或供应链，例如 GPU 漏洞明确影响训练集群、PyTorch 供应链攻击、推理服务数据隔离故障。
- none：只是普通软件、安全、商业、硬件或互联网资讯，和 AI 没有明确关系。

严格规则：
1. 公司本身从事 AI，不能让它的所有新闻都成为 AI 新闻。
2. 出现 Microsoft、Google、NVIDIA、OpenAI 等公司名，不能单独构成 AI 证据。
3. 普通 Windows/macOS/Linux 漏洞、软件补丁、网站攻击、数据库或浏览器更新，若未明确影响 AI 系统，必须标为 none，aiRelevance 不得高于 3。
4. 不得根据常识补充标题和摘要中没有写出的 AI 联系。
5. 只有 direct 或 enabling 且 aiRelevance >= ${MIN_GENERIC_AI_RELEVANCE}、aiEvidence 非空的文章，才有资格进入通用 AI 情报。

## 评分维度

### 1. 相关性 (relevance) - 对 AI 技术从业者的价值
- 10: AI 领域重大事件或突破
- 7-9: 对多数 AI 从业者有价值
- 4-6: 对特定 AI 方向有价值
- 1-3: 对 AI 从业者价值有限或与 AI 无关

### 2. 质量 (quality) - 文章本身的深度和写作质量
- 10: 深度分析，原创洞见，引用丰富
- 7-9: 有深度，观点独到
- 4-6: 信息准确，表达清晰
- 1-3: 浅尝辄止或纯转述
- RSS 摘要过短、几乎只是重复标题、只有“阅读全文”等占位文本，或核心事实仍是未经证实的传闻时，应降低质量分；不要替文章补充摘要中没有的事实

### 3. 时效性 (timeliness) - 当前是否值得阅读
- 10: 正在发生的重大事件/刚发布的重要工具
- 7-9: 近期热点相关
- 4-6: 常青内容，不过时
- 1-3: 过时或无时效价值

## 分类标签（必须从以下选一个）
- ai-ml: AI、机器学习、LLM、深度学习相关
- security: 安全、隐私、漏洞、加密相关
- engineering: 软件工程、架构、编程语言、系统设计
- tools: 开发工具、开源项目、新发布的库/框架
- opinion: 行业观点、个人思考、职业发展、文化评论
- other: 以上都不太适合的

## 关键词提取
提取 2-4 个最能代表文章主题的关键词（用英文，简短，如 "Rust", "LLM", "database", "performance"）

## 待评分文章

${articlesList}

请严格按 JSON 格式返回，不要包含 markdown 代码块或其他文字。每个结果的 index 必须原样使用待评分文章中 Index 后的数字，不要按批次重新编号。
{
  "results": [
    {
      "index": 0,
      "aiRelevance": 8,
      "aiRelation": "direct",
      "aiEvidence": "文章直接讨论大模型推理服务的性能优化。",
      "relevance": 8,
      "quality": 7,
      "timeliness": 9,
      "category": "engineering",
      "keywords": ["Rust", "compiler", "performance"]
    }
  ]
}`;
}

function buildProjectScoringPrompt(
  articles: Array<{ index: number; title: string; description: string; sourceName: string; possibleProjectIds?: string[] }>,
  projects: ProjectConfig[]
): string {
  const projectById = new Map(projects.map(project => [project.id, project]));
  const articlesList = articles.map(article => {
    const candidateProjects = (article.possibleProjectIds || [])
      .map(id => projectById.get(id))
      .filter((project): project is ProjectConfig => Boolean(project));
    return `Index ${article.index}: [${article.sourceName}] ${article.title}\n${stripHtml(article.description).slice(0, 220)}\n候选项目: ${candidateProjects.map(project => project.id).join(', ')}`;
  }).join('\n\n---\n\n');
  const projectContext = projects.map(project => `### ${project.id}: ${project.name}
- 目标: ${project.goal}
- 必须信号组: ${project.requiredSignalGroups.length > 0 ? project.requiredSignalGroups.map(group => `(${group.join(', ')})`).join(' + ') : project.requiredSignals.join(', ') || '无'}
- 辅助信号: ${project.supportingSignals.slice(0, 12).join(', ') || '无'}
- 排除: ${[...project.negativeSignals, ...project.exclude].slice(0, 12).join(', ') || '无'}
- 最低相关性: ${project.selection.minMatchRelevance}/10`).join('\n\n');

  return `你是项目技术情报筛选器。只依据文章标题和摘要，对每篇文章列出的候选项目逐个判断，不做通用评分。

${projectContext}

匹配类型：
- direct：文章直接研究、实现、评测或披露该项目要解决的问题。
- transferable：对象不是该项目本身，但方法、模型、数据、评测或失败经验可明确迁移，whyRelevant 必须写清迁移点。
- adjacent：只属于相邻领域或仅有宽泛关键词重合。adjacent 会被项目栏目排除。

规则：
1. 必须满足项目的每个必须信号组；辅助词不能替代缺失的必须组。
2. 关键词重合、品牌背景、泛 Agent/AI 内容不能单独构成匹配。
3. 直接相关优先；不要把可迁移参考夸大为直接相关。
4. 返回所有达到最低相关性的候选项目；无匹配时返回空数组。
5. whyRelevant 和 recommendedAction 使用中文，各不超过 120 字，不得补充原文没有的信息。
6. index 和 projectId 必须原样返回。

文章：

${articlesList}

严格返回 JSON，不要包含 markdown：
{"results":[{"index":0,"projectMatches":[{"projectId":"project-id","matchType":"direct","projectRelevance":8,"actionability":7,"whyRelevant":"直接证据或明确迁移点。","recommendedAction":"具体下一步。"}]}]}`;
}

type IndexedScoringArticle = {
  index: number;
  title: string;
  description: string;
  sourceName: string;
  possibleProjectIds?: string[];
};

async function scoreArticlePass(
  indexed: IndexedScoringArticle[],
  articleTextByIndex: Map<number, string>,
  aiClient: AIClient,
  projects: ProjectConfig[],
  task: 'scoring' | 'project-scoring',
  label: string
): Promise<Map<number, ArticleScore>> {
  const allScores = new Map<number, ArticleScore>();

  const batches: typeof indexed[] = [];
  for (let i = 0; i < indexed.length; i += SCORING_BATCH_SIZE) {
    batches.push(indexed.slice(i, i + SCORING_BATCH_SIZE));
  }
  
  console.log(`[digest] ${label}: ${indexed.length} articles in ${batches.length} batches`);
  
  const validCategories = new Set<string>(['ai-ml', 'security', 'engineering', 'tools', 'opinion', 'other']);
  for (let i = 0; i < batches.length; i += MAX_CONCURRENT_GEMINI) {
    const batchGroup = batches.slice(i, i + MAX_CONCURRENT_GEMINI);
    const promises = batchGroup.map(async (batch) => {
      const possibleProjectIds = new Set(batch.flatMap(item => item.possibleProjectIds || []));
      const promptProjects = task === 'project-scoring'
        ? projects.filter(project => possibleProjectIds.has(project.id))
        : projects;
      const prompt = task === 'project-scoring'
        ? buildProjectScoringPrompt(batch, promptProjects)
        : buildScoringPrompt(batch);
      const batchIndices = batch.map(item => item.index);
      const allowedIndices = new Set(batchIndices);
      const projectsById = new Map(promptProjects.map(project => [project.id, project]));
      let bestScores = new Map<number, ArticleScore>();
      let lastError: unknown;

      for (let attempt = 1; attempt <= SCORING_MAX_ATTEMPTS; attempt++) {
        try {
          const responseText = await aiClient.call(prompt, task);
          const parsed = parseJsonResponse<GeminiScoringResult>(responseText);
          if (!parsed || !Array.isArray(parsed.results)) {
            throw new Error('Scoring response does not contain a results array');
          }

          const attemptScores = new Map<number, ArticleScore>();
          let skippedResults = 0;
          for (const rawResult of parsed.results) {
            const result = validateArticleScore(
              rawResult,
              allowedIndices,
              batchIndices,
              validCategories,
              projectsById,
              articleTextByIndex
            );
            if (!result) {
              skippedResults++;
              continue;
            }
            attemptScores.set(result.index, result.score);
          }

          if (attemptScores.size > bestScores.size) bestScores = attemptScores;
          if (attemptScores.size !== batch.length) {
            throw new Error(`Scoring response returned ${attemptScores.size}/${batch.length} valid result(s)`);
          }

          for (const [index, score] of attemptScores) allScores.set(index, score);
          if (skippedResults > 0) {
            console.warn(`[digest] Scoring batch: skipped ${skippedResults} invalid response item(s)`);
          }
          return;
        } catch (error) {
          lastError = error;
          if (attempt < SCORING_MAX_ATTEMPTS) {
            console.warn(`[digest] ${label} batch attempt ${attempt}/${SCORING_MAX_ATTEMPTS} failed (${error instanceof Error ? error.message : String(error)}); retrying once`);
          }
        }
      }

      for (const [index, score] of bestScores) allScores.set(index, score);
      const missingItems = batch.filter(item => !bestScores.has(item.index));
      console.warn(
        `[digest] ${label} batch failed after ${SCORING_MAX_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}; `
        + `using ${bestScores.size} recovered result(s) and defaults for ${missingItems.length}`
      );
      for (const item of missingItems) {
        allScores.set(item.index, {
          aiRelevance: 1, aiRelation: 'none', aiEvidence: '',
          relevance: 5, quality: 5, timeliness: 5, category: 'other', keywords: [], projectMatches: [],
        });
      }
    });
    
    await Promise.all(promises);
    console.log(`[digest] ${label} progress: ${Math.min(i + MAX_CONCURRENT_GEMINI, batches.length)}/${batches.length} batches`);
  }
  
  return allScores;
}

function containsConfiguredSignal(articleText: string, signal: string): boolean {
  const normalizedSignal = normalizeSignalText(signal).trim();
  return normalizedSignal.length > 0 && normalizeSignalText(articleText).includes(` ${normalizedSignal} `);
}

function articleMightMatchProject(article: Article, project: ProjectConfig): boolean {
  const articleText = `${article.sourceName} ${article.title} ${article.description}`;
  const primarySignals = project.requiredSignalGroups[0]?.length
    ? project.requiredSignalGroups[0]
    : project.requiredSignals;
  const configuredSignals = [...primarySignals, ...project.keywords, ...project.entities];
  return configuredSignals.some(signal => containsConfiguredSignal(articleText, signal));
}

function selectDiverseRecentArticles<T extends Article>(articles: T[], limit: number): T[] {
  if (limit <= 0) return [];
  const groups = new Map<string, T[]>();
  const seenUrls = new Set<string>();
  for (const article of articles) {
    const normalizedUrl = normalizeArticleUrl(article.link);
    if (seenUrls.has(normalizedUrl)) continue;
    seenUrls.add(normalizedUrl);
    const items = groups.get(article.sourceName) || [];
    items.push(article);
    groups.set(article.sourceName, items);
  }
  for (const items of groups.values()) {
    items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  }
  const selected: T[] = [];
  while (selected.length < limit) {
    let added = false;
    for (const items of groups.values()) {
      const article = items.shift();
      if (!article) continue;
      selected.push(article);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected;
}

export function selectArticlesForAIScoring(
  articles: Article[],
  projects: ProjectConfig[],
  researchPolicy: ResearchPolicy
): Article[] {
  const researchSourceArticles = articles.filter(article => article.sourceTier === 'research');
  const selectedResearch = new Set<Article>(selectDiverseRecentArticles(
    researchPolicy.enabled
      ? researchSourceArticles.filter(article => isResearchPaperCandidate(article, researchPolicy.topics))
      : [],
    researchPolicy.candidateLimit
  ));
  for (const project of projects) {
    const projectCandidates = selectDiverseRecentArticles(
      researchSourceArticles.filter(article => articleMightMatchProject(article, project)),
      MAX_PROJECT_RESEARCH_CANDIDATES_PER_PROFILE
    );
    for (const article of projectCandidates) selectedResearch.add(article);
  }
  const selected = articles.filter(article => article.sourceTier !== 'research' || selectedResearch.has(article));
  console.log(
    `[digest] Research pre-scoring cap: kept=${selectedResearch.size}/${researchSourceArticles.length} research-source articles; `
    + `totalAI=${selected.length}/${articles.length}`
  );
  return selected;
}

export async function scoreArticlesWithAI(
  articles: Article[],
  aiClient: AIClient,
  projects: ProjectConfig[]
): Promise<Map<number, ArticleScore>> {
  const indexed = articles.map((article, index) => ({
    index,
    title: article.title,
    description: article.description,
    sourceName: article.sourceName,
  }));
  const articleTextByIndex = new Map(indexed.map(item => [item.index, `${item.title} ${item.description}`]));
  const genericScores = await scoreArticlePass(
    indexed,
    articleTextByIndex,
    aiClient,
    [],
    'scoring',
    'Generic AI scoring'
  );
  if (projects.length === 0) return genericScores;

  const possibleProjectsByIndex = new Map<number, Set<string>>();
  for (const project of projects) {
    const matching = indexed.filter(item => articleMightMatchProject(articles[item.index]!, project));
    const nonResearch = matching
      .filter(item => articles[item.index]!.sourceTier !== 'research')
      .sort((a, b) => {
        const articleA = articles[a.index]!;
        const articleB = articles[b.index]!;
        return getProjectSourcePreferenceScore(articleB, project) - getProjectSourcePreferenceScore(articleA, project)
          || getGenericScore(genericScores.get(b.index)!) - getGenericScore(genericScores.get(a.index)!)
          || articleB.pubDate.getTime() - articleA.pubDate.getTime();
      })
      .slice(0, MAX_PROJECT_NON_RESEARCH_CANDIDATES_PER_PROFILE);
    const research = matching
      .filter(item => articles[item.index]!.sourceTier === 'research')
      .sort((a, b) => getGenericScore(genericScores.get(b.index)!) - getGenericScore(genericScores.get(a.index)!))
      .slice(0, MAX_PROJECT_RESEARCH_CANDIDATES_PER_PROFILE);
    for (const item of [...nonResearch, ...research]) {
      const possibleIds = possibleProjectsByIndex.get(item.index) || new Set<string>();
      possibleIds.add(project.id);
      possibleProjectsByIndex.set(item.index, possibleIds);
    }
  }
  const projectCandidates = indexed.flatMap(item => {
    const possibleProjectIds = [...(possibleProjectsByIndex.get(item.index) || [])];
    return possibleProjectIds.length > 0 ? [{ ...item, possibleProjectIds }] : [];
  });
  const nonResearchProjectCandidates = projectCandidates
    .filter(item => articles[item.index]!.sourceTier !== 'research');
  const researchProjectCandidates = projectCandidates
    .filter(item => articles[item.index]!.sourceTier === 'research')
    .sort((a, b) => getGenericScore(genericScores.get(b.index)!) - getGenericScore(genericScores.get(a.index)!));
  const prioritizedResearchIndices = new Set<number>();
  for (const project of projects) {
    const bestForProject = researchProjectCandidates.find(item => item.possibleProjectIds?.includes(project.id));
    if (bestForProject) prioritizedResearchIndices.add(bestForProject.index);
  }
  for (const item of researchProjectCandidates) {
    if (prioritizedResearchIndices.size >= MAX_TOTAL_PROJECT_RESEARCH_CANDIDATES) break;
    prioritizedResearchIndices.add(item.index);
  }
  const cappedProjectCandidates = [
    ...nonResearchProjectCandidates,
    ...researchProjectCandidates.filter(item => prioritizedResearchIndices.has(item.index)),
  ];
  const referencedProjectIds = new Set(cappedProjectCandidates.flatMap(item => item.possibleProjectIds));
  console.log(
    `[digest] Project scoring candidates: ${cappedProjectCandidates.length}/${articles.length}; `
    + `nonResearchCap=${MAX_PROJECT_NON_RESEARCH_CANDIDATES_PER_PROFILE}/profile; `
    + `research=${Math.min(researchProjectCandidates.length, prioritizedResearchIndices.size)}/${researchProjectCandidates.length}; `
    + `relevant profiles=${referencedProjectIds.size}/${projects.length}`
  );
  if (cappedProjectCandidates.length === 0) return genericScores;

  const projectScores = await scoreArticlePass(
    cappedProjectCandidates,
    articleTextByIndex,
    aiClient,
    projects,
    'project-scoring',
    'Project AI scoring'
  );
  for (const [index, projectScore] of projectScores) {
    const genericScore = genericScores.get(index);
    if (genericScore) genericScore.projectMatches = projectScore.projectMatches;
  }
  return genericScores;
}

// ============================================================================
// Frontier Research Selection
// ============================================================================

const RESEARCH_PAPER_SIGNAL_REGEX = /\b(?:arxiv|doi|paper|preprint|study|researchers?|benchmark|evaluation|we (?:propose|present|introduce)|experiments?)\b|论文|预印本|研究提出|实验|基准/i;
const RESEARCH_TOPIC_PATTERNS: Record<string, RegExp> = {
  llm: /\b(?:llms?|large language models?|language models?|foundation models?|reasoning models?|transformers?)\b/i,
  agent: /\b(?:ai agents?|llm agents?|agentic|autonomous agents?|multi[ -]agents?|tool[- ]using agents?|computer use)\b/i,
};

export function isResearchPaperCandidate(
  article: Pick<Article, 'title' | 'description' | 'link' | 'sourceName' | 'sourceTier' | 'sourceTags'>,
  topics: string[]
): boolean {
  if (article.sourceTier !== 'research' && article.sourceTier !== 'first-party') return false;
  const text = `${article.sourceName} ${article.title} ${article.description}`;
  const isArxiv = /(?:^|\.)arxiv\.org$/i.test(getHostname(article.link)) || /arxiv/i.test(article.sourceName);
  const hasPaperEvidence = isArxiv
    || article.sourceTags?.includes('research') && RESEARCH_PAPER_SIGNAL_REGEX.test(text)
    || RESEARCH_PAPER_SIGNAL_REGEX.test(text) && /research|paper|arxiv/i.test(article.sourceName);
  if (!hasPaperEvidence) return false;

  return topics.some(topic => {
    const normalizedTopic = topic.trim().toLowerCase();
    const pattern = RESEARCH_TOPIC_PATTERNS[normalizedTopic];
    return pattern ? pattern.test(text) : containsConfiguredSignal(text, topic);
  });
}

function buildResearchScoringPrompt(
  articles: Array<{ index: number; title: string; description: string; sourceName: string }>,
  topics: string[]
): string {
  const articleList = articles.map(article =>
    `Index ${article.index}: [${article.sourceName}] ${article.title}\n${stripHtml(article.description).slice(0, 700)}`
  ).join('\n\n---\n\n');

  return `你是大模型与 AI Agent 研究编辑。请只依据标题和摘要，评估下列论文或研究内容。

关注主题：${topics.join(', ')}

每项返回 1-10 的整数分：
- frontierScore：方法、架构、训练、推理、Agent 机制或评测方面的新颖程度；常规应用论文不得高分。
- evidenceScore：摘要中实验、基线、指标、消融或明确方法证据的充分程度。
- impactScore：对大模型能力、Agent 架构、安全或工程实践的潜在影响。
- reproducibilityScore：摘要明确提供代码、模型、数据、详细方法或可复现线索的程度；没有说明时不得推断为开源。

要求：
1. 不得把机构名气、营销措辞或“首次”等自述直接当作突破证据。
2. 不得补充摘要未提供的实验结果、代码地址、许可证或引用热度。
3. whyImportant 用中文说明真正的新意和潜在价值，最多 160 字。
4. limitations 用中文说明摘要中可见的证据限制；没有明确限制时写“摘要未提供足够的局限性信息”，最多 160 字。
5. index 必须原样返回，不能按批次重新编号。

待评分内容：

${articleList}

严格返回 JSON，不要包含 markdown：
{"results":[{"index":0,"frontierScore":8,"evidenceScore":7,"impactScore":8,"reproducibilityScore":6,"whyImportant":"...","limitations":"..."}]}`;
}

function validateResearchAssessment(
  value: unknown,
  allowedIndices: Set<number>
): { index: number; assessment: ResearchAssessment } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const index = typeof record.index === 'number'
    ? record.index
    : typeof record.index === 'string' && /^\d+$/.test(record.index.trim())
      ? Number(record.index)
      : NaN;
  if (!Number.isInteger(index) || !allowedIndices.has(index)) return null;
  const whyImportant = truncateText(record.whyImportant);
  if (!whyImportant) return null;

  return {
    index,
    assessment: {
      frontierScore: clampScore(record.frontierScore),
      evidenceScore: clampScore(record.evidenceScore),
      impactScore: clampScore(record.impactScore),
      reproducibilityScore: clampScore(record.reproducibilityScore),
      whyImportant,
      limitations: truncateText(record.limitations) || '摘要未提供足够的局限性信息。',
    },
  };
}

async function scoreResearchCandidates<T extends RankableArticle>(
  articles: T[],
  allArticles: T[],
  aiClient: AIClient,
  policy: ResearchPolicy
): Promise<Map<T, ResearchAssessment>> {
  const indexByArticle = new Map(allArticles.map((article, index) => [article, index]));
  const indexed = articles.map(article => ({
    index: indexByArticle.get(article)!,
    title: article.title,
    description: article.description,
    sourceName: article.sourceName,
  }));
  const assessments = new Map<T, ResearchAssessment>();
  const articleByIndex = new Map(indexed.map((item, index) => [item.index, articles[index]!]));
  const batches: typeof indexed[] = [];
  for (let i = 0; i < indexed.length; i += SCORING_BATCH_SIZE) {
    batches.push(indexed.slice(i, i + SCORING_BATCH_SIZE));
  }
  console.log(`[digest] Research AI scoring: ${indexed.length} candidates in ${batches.length} batches`);

  for (let i = 0; i < batches.length; i += MAX_CONCURRENT_GEMINI) {
    const batchGroup = batches.slice(i, i + MAX_CONCURRENT_GEMINI);
    await Promise.all(batchGroup.map(async batch => {
      const allowedIndices = new Set(batch.map(item => item.index));
      const prompt = buildResearchScoringPrompt(batch, policy.topics);
      let lastError: unknown;
      for (let attempt = 1; attempt <= SCORING_MAX_ATTEMPTS; attempt++) {
        try {
          const responseText = await aiClient.call(prompt, 'research-scoring');
          const parsed = parseJsonResponse<GeminiScoringResult>(responseText);
          if (!Array.isArray(parsed.results)) throw new Error('Research response does not contain a results array');
          const batchResults = new Map<number, ResearchAssessment>();
          for (const raw of parsed.results) {
            const result = validateResearchAssessment(raw, allowedIndices);
            if (result) batchResults.set(result.index, result.assessment);
          }
          if (batchResults.size !== batch.length) {
            throw new Error(`Research response returned ${batchResults.size}/${batch.length} valid result(s)`);
          }
          for (const [index, assessment] of batchResults) {
            const article = articleByIndex.get(index);
            if (article) assessments.set(article, assessment);
          }
          return;
        } catch (error) {
          lastError = error;
          if (attempt < SCORING_MAX_ATTEMPTS) {
            console.warn(`[digest] Research scoring attempt ${attempt}/${SCORING_MAX_ATTEMPTS} failed (${error instanceof Error ? error.message : String(error)}); retrying once`);
          }
        }
      }
      console.warn(`[digest] Research scoring batch omitted after ${SCORING_MAX_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    }));
    console.log(`[digest] Research scoring progress: ${Math.min(i + MAX_CONCURRENT_GEMINI, batches.length)}/${batches.length} batches`);
  }
  return assessments;
}

interface ResearchCandidate<T> {
  article: T;
  assessment: ResearchAssessment;
  attentionScore: number;
  attentionSignals: string[];
}

export function getResearchAttention<T extends RankableArticle>(
  article: T,
  allArticles: T[],
  trendingRepos: TrendingRepo[]
): { score: number; signals: string[] } {
  const sourceMentions = new Set(
    allArticles.filter(candidate => isSameDigestEvent(article, candidate)).map(getSourceChannelIdentity)
  ).size;
  const normalizeEntity = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const researchEntities = new Set(
    (article.title.match(/\b(?=[A-Za-z0-9-]{4,}\b)(?=[A-Za-z0-9-]*(?:[A-Z]{2}|\d|-[A-Za-z0-9]))[A-Za-z][A-Za-z0-9-]*\b/g) || [])
      .map(normalizeEntity)
      .filter(entity => entity.length >= 4 && !EVENT_GENERIC_TOKENS.has(entity))
  );
  const trendingMatch = trendingRepos.some(repo => {
    const repoName = repo.name.split('/').pop() || repo.name;
    const repoEntity = normalizeEntity(repoName);
    return repoEntity.length >= 4 && researchEntities.has(repoEntity);
  });
  const codeAvailable = /\b(?:github\.com|code (?:is )?(?:available|released)|open[- ]source implementation|source code)\b|代码(?:已)?(?:开源|发布|可用)|开源实现/i
    .test(`${article.title} ${article.description}`);
  let score = 1;
  const signals: string[] = ['研究论文源'];
  if (sourceMentions >= 2) {
    score += Math.min(4, (sourceMentions - 1) * 2);
    signals.push(`${sourceMentions} 个独立来源提及`);
  }
  if (trendingMatch) {
    score += 3;
    signals.push('论文实体关联 GitHub Trending');
  }
  if (codeAvailable) {
    score += 1;
    signals.push('摘要明确提供代码线索');
  }
  if (article.genericScore >= 24) {
    score += 2;
    signals.push('通用评分高');
  } else if (article.genericScore >= 21) {
    score += 1;
  }
  return { score: Math.min(10, score), signals };
}

export async function selectResearchIntelligenceCandidates<T extends RankableArticle>(
  articles: T[],
  aiClient: AIClient,
  policy: ResearchPolicy,
  trendingRepos: TrendingRepo[],
  recentHistory: DigestHistoryEntry[] = []
): Promise<Array<ResearchCandidate<T>>> {
  if (!policy.enabled || policy.maxItems <= 0) return [];
  const prefiltered = deduplicateRankedEvents(articles)
    .filter(article => isResearchPaperCandidate(article, policy.topics))
    .sort(compareGenericRank)
    .slice(0, policy.candidateLimit);
  console.log(`[digest] Research candidates: ${prefiltered.length}/${articles.length} after paper/topic prefilter (limit ${policy.candidateLimit})`);
  if (prefiltered.length === 0) return [];

  const attentionByArticle = new Map(prefiltered.map(article => [
    article,
    getResearchAttention(article, articles, trendingRepos),
  ] as const));
  const attentionQualified = prefiltered.filter(article =>
    attentionByArticle.get(article)!.score >= policy.minAttentionScore
  );
  console.log(`[digest] Research attention prefilter: ${attentionQualified.length}/${prefiltered.length} meet score >= ${policy.minAttentionScore}`);
  if (attentionQualified.length === 0) return [];

  const assessments = await scoreResearchCandidates(attentionQualified, articles, aiClient, policy);
  const evaluated = attentionQualified.flatMap(article => {
    const assessment = assessments.get(article);
    if (!assessment) return [];
    const attention = attentionByArticle.get(article)!;
    return [{ article, assessment, attentionScore: attention.score, attentionSignals: attention.signals }];
  });
  const qualified = evaluated.filter(candidate =>
    candidate.assessment.frontierScore >= policy.minFrontierScore
    && candidate.assessment.evidenceScore >= policy.minEvidenceScore
  );
  const fresh = qualified.filter(candidate => !appearedInRecentDigest(candidate.article, recentHistory));
  const ordered = fresh.sort((a, b) =>
    b.assessment.frontierScore * 2 + b.assessment.evidenceScore + b.assessment.impactScore + b.assessment.reproducibilityScore + b.attentionScore
    - (a.assessment.frontierScore * 2 + a.assessment.evidenceScore + a.assessment.impactScore + a.assessment.reproducibilityScore + a.attentionScore)
    || b.article.pubDate.getTime() - a.article.pubDate.getTime()
  );
  const selectedArticles = applySoftSourceDiversity(ordered.map(candidate => candidate.article), policy.maxItems, RESEARCH_SOURCE_SOFT_LIMIT);
  const selectedSet = new Set(selectedArticles);
  const selected = ordered.filter(candidate => selectedSet.has(candidate.article));
  console.log(
    `[digest] Research intelligence: evaluated=${evaluated.length}, qualified=${qualified.length}, `
    + `cooldown=${qualified.length - fresh.length}, selected=${selected.length}`
  );
  return selected;
}

// ============================================================================
// AI Summarization
// ============================================================================

function buildSummaryPrompt(
  articles: Array<{ index: number; title: string; description: string; sourceName: string; link: string }>,
  lang: 'zh' | 'en'
): string {
  const articlesList = articles.map(a =>
    `Index ${a.index}: [${a.sourceName}] ${a.title}\nURL: ${a.link}\n${a.description.slice(0, 800)}`
  ).join('\n\n---\n\n');

  const langInstruction = lang === 'zh'
    ? '请用中文撰写摘要和推荐理由。如果原文是英文，请翻译为中文。标题翻译也用中文。'
    : 'Write summaries, reasons, and title translations in English.';

  return `你是一个技术内容摘要专家。请为以下文章完成三件事：

1. **中文标题** (titleZh): 将英文标题翻译成自然的中文。如果原标题已经是中文则保持不变。
2. **摘要** (summary): 4-6 句话的结构化摘要，让读者不点进原文也能了解核心内容。包含：
   - 文章讨论的核心问题或主题（1 句）
   - 关键论点、技术方案或发现（2-3 句）
   - 结论或作者的核心观点（1 句）
3. **推荐理由** (reason): 1 句话说明"为什么值得读"，区别于摘要（摘要说"是什么"，推荐理由说"为什么"）。

${langInstruction}

摘要要求：
- 直接说重点，不要用"本文讨论了..."、"这篇文章介绍了..."这种开头
- 包含具体的技术名词、数据、方案名称或观点
- 保留关键数字和指标（如性能提升百分比、用户数、版本号等）
- 如果文章涉及对比或选型，要点出比较对象和结论
- 只使用标题、来源和摘要明确提供的信息，不得补充看似合理但原文摘要没有支持的事实
- 不得从模型品牌、系列名称或公司背景推断开源、开放权重、专有、许可证、免费范围或可用性；只有输入明确说明时才能写入
- 数字、排名和实验结论必须保留原始范围与归因；单一榜单第一不能扩写为全面领先，来源自述不能写成独立验证结论
- 输入未说明数据方法、样本构成或独立验证时，不得自行声称实验可靠、结论普遍成立或具有统计代表性
- 保留“据报道”“该公司称”“该榜单显示”等不确定性和归因措辞，不得把主张改写成已确认事实
- 如果输入不足以支持至少两条具体事实，不要猜测文章可能讨论什么；请在 summary 末尾明确添加“[信息不足]”
- 目标：读者花 30 秒读完摘要，就能决定是否值得花 10 分钟读原文

## 待摘要文章

${articlesList}

请严格按 JSON 格式返回。必须为上方每个 Index 返回且只返回一个完整结果，index 必须原样保留；不能省略任何文章：
{
  "results": [
    {
      "index": 0,
      "titleZh": "中文翻译的标题",
      "summary": "摘要内容...",
      "reason": "推荐理由..."
    }
  ]
}`;
}

const LOW_INFORMATION_SUMMARY_REGEX = /\[信息不足\]|(?:文章|本文|该文|作者)(?:可能|或许|似乎|大概)(?:会|将|还会|进一步|主要)?(?:涉及|讨论|分析|探讨|介绍|包括|聚焦)|(?:文章|本文|该文).{0,30}(?:可能|或许|似乎|大概)(?:会|将|还会|进一步|主要)?(?:涉及|讨论|分析|探讨|介绍|包括|聚焦)|(?:具体)?(?:内容|信息|细节|原文)(?:不足|有限|未(?:在摘要中)?(?:提供|说明|详细说明))|(?:may|might|could) (?:discuss|cover|analy[sz]e|explore|include)|insufficient (?:information|detail)|details? (?:are|were) not (?:provided|available)/i;

export function isLowInformationGeneratedSummary(summary: Pick<ArticleSummary, 'summary' | 'reason'>): boolean {
  return !summary.reason.trim() || LOW_INFORMATION_SUMMARY_REGEX.test(`${summary.summary} ${summary.reason}`);
}

function validateSummaryResult(raw: unknown, allowedIndices: Set<number>): { index: number; summary: ArticleSummary } | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const index = typeof record.index === 'number'
    ? record.index
    : typeof record.index === 'string' && /^\d+$/.test(record.index.trim())
      ? Number(record.index)
      : NaN;
  if (!Number.isInteger(index) || !allowedIndices.has(index)) return null;

  const titleZh = typeof record.titleZh === 'string' ? record.titleZh.trim() : '';
  const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
  if (!titleZh || summary.length < 20 || !reason) return null;
  const validated = { titleZh, summary, reason };
  if (isLowInformationGeneratedSummary(validated)) return null;
  return { index, summary: validated };
}

function buildSummaryFallback(article: { title: string; description: string }): ArticleSummary {
  const cleaned = stripHtml(stripHtml(article.description)).replace(/\s+/g, ' ').trim();
  return {
    titleZh: article.title,
    summary: (cleaned || article.title).slice(0, 500),
    reason: '',
  };
}

export async function summarizeArticles(
  articles: Array<Article & { index: number }>,
  aiClient: AIClient,
  lang: 'zh' | 'en'
): Promise<Map<number, ArticleSummary>> {
  const summaries = new Map<number, ArticleSummary>();
  
  const indexed = articles.map(a => ({
    index: a.index,
    title: a.title,
    description: a.description,
    sourceName: a.sourceName,
    link: a.link,
  }));
  
  const batches: typeof indexed[] = [];
  for (let i = 0; i < indexed.length; i += GEMINI_BATCH_SIZE) {
    batches.push(indexed.slice(i, i + GEMINI_BATCH_SIZE));
  }
  
  console.log(`[digest] Generating summaries for ${articles.length} articles in ${batches.length} batches`);
  
  for (let i = 0; i < batches.length; i += MAX_CONCURRENT_GEMINI) {
    const batchGroup = batches.slice(i, i + MAX_CONCURRENT_GEMINI);
    const promises = batchGroup.map(async (batch) => {
      let remaining = [...batch];
      let lastError: unknown;
      for (let attempt = 1; attempt <= SUMMARY_MAX_ATTEMPTS && remaining.length > 0; attempt++) {
        try {
          const prompt = buildSummaryPrompt(remaining, lang);
          const responseText = await aiClient.call(prompt, 'summary');
          const parsed = parseJsonResponse<GeminiSummaryResult>(responseText);
          if (!Array.isArray(parsed.results)) {
            throw new Error('Summary response does not contain a results array');
          }

          const allowedIndices = new Set(remaining.map(item => item.index));
          for (const rawResult of parsed.results) {
            const result = validateSummaryResult(rawResult, allowedIndices);
            if (result) summaries.set(result.index, result.summary);
          }
          remaining = remaining.filter(item => !summaries.has(item.index));
          if (remaining.length === 0) return;
          throw new Error(`Summary response omitted or invalidated ${remaining.length} result(s)`);
        } catch (error) {
          lastError = error;
          if (attempt < SUMMARY_MAX_ATTEMPTS) {
            console.warn(
              `[digest] Summary batch attempt ${attempt}/${SUMMARY_MAX_ATTEMPTS} incomplete `
              + `(${error instanceof Error ? error.message : String(error)}); retrying ${remaining.length} missing article(s)`
            );
          }
        }
      }

      if (remaining.length > 0) {
        console.warn(
          `[digest] Summary batch incomplete after ${SUMMARY_MAX_ATTEMPTS} attempts `
          + `(${lastError instanceof Error ? lastError.message : String(lastError)}); using clean fallback for ${remaining.length} article(s)`
        );
        for (const item of remaining) summaries.set(item.index, buildSummaryFallback(item));
      }
    });
    
    await Promise.all(promises);
    console.log(`[digest] Summary progress: ${Math.min(i + MAX_CONCURRENT_GEMINI, batches.length)}/${batches.length} batches`);
  }
  
  return summaries;
}

// ============================================================================
// AI Highlights (Today's Trends)
// ============================================================================

async function generateHighlights(
  articles: ScoredArticle[],
  aiClient: AIClient,
  lang: 'zh' | 'en'
): Promise<string> {
  const articleList = articles.slice(0, 10).map((a, i) =>
    `${i + 1}. [${a.category}] ${a.titleZh || a.title} — ${a.summary.slice(0, 100)}`
  ).join('\n');

  const langNote = lang === 'zh' ? '用中文回答。' : 'Write in English.';

  const prompt = `根据以下今日精选技术文章列表，写一段 3-5 句话的"今日看点"总结。
要求：
- 提炼出今天技术圈的 2-3 个主要趋势或话题
- 不要逐篇列举，要做宏观归纳
- 风格简洁有力，像新闻导语
${langNote}

文章列表：
${articleList}

直接返回纯文本总结，不要 JSON，不要 markdown 格式。`;

  try {
    const text = await aiClient.call(prompt, 'highlights');
    return text.trim();
  } catch (error) {
    console.warn(`[digest] Highlights generation failed: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
}

// ============================================================================
// Visualization Helpers
// ============================================================================

function humanizeTime(pubDate: Date): string {
  const diffMs = Date.now() - pubDate.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;
  return pubDate.toISOString().slice(0, 10);
}

function generateKeywordBarChart(articles: ScoredArticle[]): string {
  const kwCount = new Map<string, number>();
  for (const a of articles) {
    for (const kw of a.keywords) {
      const normalized = kw.toLowerCase();
      kwCount.set(normalized, (kwCount.get(normalized) || 0) + 1);
    }
  }

  const sorted = Array.from(kwCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  if (sorted.length === 0) return '';

  const labels = sorted.map(([k]) => `"${k}"`).join(', ');
  const values = sorted.map(([, v]) => v).join(', ');
  const maxVal = sorted[0][1];

  let chart = '```mermaid\n';
  chart += `xychart-beta horizontal\n`;
  chart += `    title "高频关键词"\n`;
  chart += `    x-axis [${labels}]\n`;
  chart += `    y-axis "出现次数" 0 --> ${maxVal + 2}\n`;
  chart += `    bar [${values}]\n`;
  chart += '```\n';

  return chart;
}

function generateCategoryPieChart(articles: ScoredArticle[]): string {
  const catCount = new Map<CategoryId, number>();
  for (const a of articles) {
    catCount.set(a.category, (catCount.get(a.category) || 0) + 1);
  }

  if (catCount.size === 0) return '';

  const sorted = Array.from(catCount.entries()).sort((a, b) => b[1] - a[1]);

  let chart = '```mermaid\n';
  chart += `pie showData\n`;
  chart += `    title "文章分类分布"\n`;
  for (const [cat, count] of sorted) {
    const meta = CATEGORY_META[cat];
    chart += `    "${meta.emoji} ${meta.label}" : ${count}\n`;
  }
  chart += '```\n';

  return chart;
}

function generateAsciiBarChart(articles: ScoredArticle[]): string {
  const kwCount = new Map<string, number>();
  for (const a of articles) {
    for (const kw of a.keywords) {
      const normalized = kw.toLowerCase();
      kwCount.set(normalized, (kwCount.get(normalized) || 0) + 1);
    }
  }

  const sorted = Array.from(kwCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (sorted.length === 0) return '';

  const maxVal = sorted[0][1];
  const maxBarWidth = 20;
  const maxLabelLen = Math.max(...sorted.map(([k]) => k.length));

  let chart = '```\n';
  for (const [label, value] of sorted) {
    const barLen = Math.max(1, Math.round((value / maxVal) * maxBarWidth));
    const bar = '█'.repeat(barLen) + '░'.repeat(maxBarWidth - barLen);
    chart += `${label.padEnd(maxLabelLen)} │ ${bar} ${value}\n`;
  }
  chart += '```\n';

  return chart;
}

function generateTagCloud(articles: ScoredArticle[]): string {
  const kwCount = new Map<string, number>();
  for (const a of articles) {
    for (const kw of a.keywords) {
      const normalized = kw.toLowerCase();
      kwCount.set(normalized, (kwCount.get(normalized) || 0) + 1);
    }
  }

  const sorted = Array.from(kwCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  if (sorted.length === 0) return '';

  return sorted
    .map(([word, count], i) => i < 3 ? `**${word}**(${count})` : `${word}(${count})`)
    .join(' · ');
}

function renderDesignSection(designArticles: DesignArticle[]): string {
  if (designArticles.length === 0) return '';

  let section = `## 🎨 Design & Generative AI\n\n`;

  const subCatOrder: DesignSubCategory[] = ['generative-ui', 'generative-image', 'world-model', 'generative-video'];
  const grouped = new Map<DesignSubCategory, DesignArticle[]>();
  for (const a of designArticles) {
    const list = grouped.get(a.subCategory) || [];
    list.push(a);
    grouped.set(a.subCategory, list);
  }

  for (const sub of subCatOrder) {
    const items = grouped.get(sub);
    if (!items || items.length === 0) continue;
    const meta = DESIGN_SUB_CATEGORY_META[sub];
    section += `### ${meta.emoji} ${meta.label}\n\n`;
    for (const a of items) {
      const time = humanizeTime(a.pubDate);
      section += `- **[${a.titleZh}](${a.link})** — ${a.sourceName} · ${time}\n`;
      section += `  > ${a.oneLiner}\n\n`;
    }
  }

  section += `---\n\n`;
  return section;
}

function getGenericScore(score: ArticleScore): number {
  return score.relevance + score.quality + score.timeliness;
}

function getProjectAwareScore(score: ArticleScore): number {
  const bestMatch = score.projectMatches[0];
  if (!bestMatch) return getGenericScore(score);
  return score.quality + score.timeliness + bestMatch.projectRelevance * 2 + bestMatch.actionability;
}

const UNCERTAINTY_SIGNAL_REGEX = /\b(?:rumou?red?|reportedly|allegedly|unconfirmed|speculation|unclear|possibly|might|could)\b|据报道|据传|传闻|疑似|可能|或许|尚未证实|未经证实|据称|似乎|不确定/i;
const TRACEABLE_ATTRIBUTION_REGEX = /\b(?:according to|reported by|citing|cites|based on (?:data|a report|research)|analysis (?:by|from)|data (?:from|by)|study (?:by|from)|research (?:by|from))\b|(?:据|根据|援引|引用).{0,40}(?:报道|报告|分析|数据|研究|论文|公告)|\b(?:Bloomberg|Reuters|Financial Times|Associated Press|Artificial Analysis)\b/i;
const WEAK_EVIDENCE_REGEX = /\b(?:eyewitness|attendee notes?|social media posts?|anonymous sources?)\b|现场纪要|听会纪要|社交媒体|匿名消息|未核到官方|尚无官方/i;

export function assessVerificationStatus(article: { title: string; description: string; sourceTier?: SourceTier }): VerificationStatus | undefined {
  if (article.sourceTier === 'first-party' || article.sourceTier === 'research') return 'first-party';

  const text = `${article.title} ${article.description}`;
  const uncertain = UNCERTAINTY_SIGNAL_REGEX.test(text);
  const traceable = TRACEABLE_ATTRIBUTION_REGEX.test(text);
  const weakEvidence = WEAK_EVIDENCE_REGEX.test(text);

  if (uncertain && (weakEvidence || !traceable)) return 'unverified';
  if ((article.sourceTier === 'secondary' || uncertain) && traceable) return 'traceable-secondary';
  if (article.sourceTier === 'secondary') return 'secondary';
  return undefined;
}

function getVerificationLabel(article: { title: string; description: string; sourceTier?: SourceTier }): string {
  const status = assessVerificationStatus(article);
  if (status === 'first-party') return '一手来源';
  if (status === 'secondary') return '二手来源';
  if (status === 'traceable-secondary') return '可追溯二手';
  if (status === 'unverified') return '待核实';
  return '';
}

function getLowInformationPenalty(article: { title: string; description: string; sourceTier?: SourceTier }): number {
  const title = stripHtml(article.title).replace(/\s+/g, ' ').trim();
  const description = stripHtml(article.description).replace(/\s+/g, ' ').trim();
  const normalizedTitle = normalizeSignalText(title).trim();
  const normalizedDescription = normalizeSignalText(description).trim();
  let penalty = 0;

  if (description.length < 40) penalty += 2;
  else if (description.length < 100) penalty += 1;

  if (!description
    || normalizedDescription === normalizedTitle
    || (normalizedDescription.startsWith(normalizedTitle) && normalizedDescription.length - normalizedTitle.length < 40)
    || /^(read more|continue reading|click here|learn more|no (?:summary|description)|暂无摘要|阅读全文|点击查看)/i.test(description)) {
    penalty += 1;
  }

  const verificationStatus = assessVerificationStatus(article);
  if (verificationStatus === 'unverified') penalty += 2;
  else if (verificationStatus === 'traceable-secondary' && UNCERTAINTY_SIGNAL_REGEX.test(`${title} ${description}`)) penalty += 1;

  return Math.min(MAX_LOW_INFORMATION_PENALTY, penalty);
}

export function getGenericRankingAdjustment(article: { title: string; description: string; sourceTier?: SourceTier }): number {
  const sourceBonus = article.sourceTier === 'first-party' ? FIRST_PARTY_RANKING_BONUS : 0;
  return sourceBonus - getLowInformationPenalty(article);
}

function getAdjustedGenericScore(article: { title: string; description: string; sourceTier?: SourceTier; genericScore: number }): number {
  return article.genericScore + getGenericRankingAdjustment(article);
}

function compareGenericRank(
  a: { title: string; description: string; sourceTier?: SourceTier; genericScore: number; pubDate: Date },
  b: { title: string; description: string; sourceTier?: SourceTier; genericScore: number; pubDate: Date }
): number {
  return getAdjustedGenericScore(b) - getAdjustedGenericScore(a)
    || b.genericScore - a.genericScore
    || b.pubDate.getTime() - a.pubDate.getTime();
}

interface DigestHistoryEntry {
  title: string;
  link: string;
}

type RankableArticle = {
  title: string;
  description: string;
  link: string;
  sourceName: string;
  sourceUrl: string;
  sourceTier?: SourceTier;
  sourceMaxTopItems?: number;
  breakdown: ArticleScore;
  genericScore: number;
  projectAwareScore: number;
  pubDate: Date;
};

function compareEventRepresentatives<T extends RankableArticle>(a: T, b: T): number {
  return getSourceAuthorityScore(b) - getSourceAuthorityScore(a)
    || b.breakdown.quality - a.breakdown.quality
    || getAdjustedGenericScore(b) - getAdjustedGenericScore(a)
    || b.genericScore - a.genericScore
    || b.pubDate.getTime() - a.pubDate.getTime();
}

function titlesDescribeSameEvent(titleAValue: string, titleBValue: string): boolean {
  const titleA = tokenizeEventText(titleAValue);
  const titleB = tokenizeEventText(titleBValue);
  const sharedTitleTokens = intersectionSize(titleA, titleB);
  if (sharedTitleTokens >= 4 && overlapCoefficient(titleA, titleB) >= 0.65) return true;

  const normalizedA = normalizeSignalText(titleAValue);
  const normalizedB = normalizeSignalText(titleBValue);
  const sharedDistinctiveTokens = [...titleA]
    .filter(token => titleB.has(token) && !EVENT_GENERIC_TOKENS.has(token));
  if (sharedDistinctiveTokens.length >= 3 && sharedDistinctiveTokens.some(token => token.length >= 8)) {
    return true;
  }

  const sameAction = EVENT_ACTION_GROUPS.some(group =>
    group.some(action => normalizedA.includes(` ${action} `))
    && group.some(action => normalizedB.includes(` ${action} `))
  );
  if (!sameAction) return false;

  return sharedDistinctiveTokens.length >= 2 && overlapCoefficient(titleA, titleB) >= 0.5;
}

export function isSameDigestEvent<T extends RankableArticle>(a: T, b: T): boolean {
  if (normalizeArticleUrl(a.link) === normalizeArticleUrl(b.link)) return true;

  const titleA = tokenizeEventText(a.title);
  const titleB = tokenizeEventText(b.title);
  const sharedTitleTokens = intersectionSize(titleA, titleB);
  if (titlesDescribeSameEvent(a.title, b.title)) return true;

  const keywordsA = tokenizeEventText(a.breakdown.keywords.join(' '));
  const keywordsB = tokenizeEventText(b.breakdown.keywords.join(' '));
  const sharedDistinctiveKeywords = [...keywordsA]
    .filter(token => keywordsB.has(token) && !EVENT_GENERIC_TOKENS.has(token));
  return sharedTitleTokens >= 3
    && sharedDistinctiveKeywords.length >= 2
    && overlapCoefficient(titleA, titleB) >= 0.5;
}

function deduplicateRankedEvents<T extends RankableArticle>(articles: T[]): T[] {
  const clusters: T[][] = [];
  for (const article of articles) {
    const cluster = clusters.find(items => items.some(item => isSameDigestEvent(item, article)));
    if (cluster) cluster.push(article);
    else clusters.push([article]);
  }
  return clusters.map(cluster => [...cluster].sort(compareEventRepresentatives)[0]!);
}

function normalizeArticleUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|campaign$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim().replace(/\/$/, '');
  }
}

function appearedInRecentDigest(article: RankableArticle, history: DigestHistoryEntry[]): boolean {
  const normalizedLink = normalizeArticleUrl(article.link);
  return history.some(entry => {
    if (normalizeArticleUrl(entry.link) === normalizedLink) return true;
    return titlesDescribeSameEvent(article.title, entry.title);
  });
}

function getSourceChannelIdentity(article: Pick<RankableArticle, 'sourceName' | 'sourceUrl'>): string {
  try {
    return new URL(article.sourceUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return article.sourceName.toLowerCase().trim();
  }
}

function getArticlePublisherIdentity(article: Pick<RankableArticle, 'link'>): string {
  try {
    return new URL(article.link).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return article.link.toLowerCase().trim();
  }
}

function getDefaultSourceTopLimit(sourceTier?: SourceTier): number {
  if (sourceTier === 'secondary') return SECONDARY_SOURCE_TOP_LIMIT;
  if (sourceTier === 'aggregator') return AGGREGATOR_SOURCE_TOP_LIMIT;
  if (sourceTier === 'community') return COMMUNITY_SOURCE_TOP_LIMIT;
  return Infinity;
}

function getSourceTopLimit(article: Pick<RankableArticle, 'sourceMaxTopItems' | 'sourceTier'>): number {
  return article.sourceMaxTopItems ?? getDefaultSourceTopLimit(article.sourceTier);
}

function formatIdentityDistribution(identities: string[]): string {
  const counts = new Map<string, number>();
  for (const identity of identities) counts.set(identity, (counts.get(identity) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([identity, count]) => `${identity}:${count}`)
    .join(', ') || 'none';
}

function logTopSourceDistribution(articles: RankableArticle[]): void {
  console.log(
    `[digest] Top source distribution: channels=${formatIdentityDistribution(articles.map(getSourceChannelIdentity))}; `
    + `publishers=${formatIdentityDistribution(articles.map(getArticlePublisherIdentity))}`
  );
}

function applySourceTopLimits<T extends RankableArticle>(articles: T[], topN: number): T[] {
  if (topN <= 0) return [];
  const selected: T[] = [];
  const deferred: T[] = [];
  const sourceCounts = new Map<string, number>();
  for (const article of articles) {
    const sourceIdentity = getSourceChannelIdentity(article);
    const count = sourceCounts.get(sourceIdentity) || 0;
    const sourceLimit = getSourceTopLimit(article);
    if (article.sourceMaxTopItems !== undefined && count >= article.sourceMaxTopItems) continue;
    if (article.sourceMaxTopItems === undefined && count >= sourceLimit) {
      deferred.push(article);
      continue;
    }
    selected.push(article);
    sourceCounts.set(sourceIdentity, count + 1);
    if (selected.length >= topN) break;
  }
  if (selected.length < topN) selected.push(...deferred.slice(0, topN - selected.length));
  return selected.length > 0 ? selected : articles.slice(0, Math.min(1, topN));
}

function applySoftSourceDiversity<T extends RankableArticle>(articles: T[], limit: number, softLimit: number): T[] {
  if (limit <= 0) return [];
  const selected: T[] = [];
  const deferred: T[] = [];
  const sourceCounts = new Map<string, number>();
  for (const article of articles) {
    const identity = getSourceChannelIdentity(article);
    const count = sourceCounts.get(identity) || 0;
    if (count >= softLimit) {
      deferred.push(article);
      continue;
    }
    selected.push(article);
    sourceCounts.set(identity, count + 1);
    if (selected.length >= limit) return selected;
  }
  return [...selected, ...deferred].slice(0, limit);
}

interface RankArticlesOptions<T extends RankableArticle> {
  prioritizedProjectArticles?: T[];
  prioritizedResearchArticles?: T[];
  qualifiedProjectMatches?: Map<T, ProjectMatch[]>;
  includeGeneric?: boolean;
  genericMaxItems?: number;
}

export function rankArticles<T extends RankableArticle>(
  articles: T[],
  topN: number,
  recentHistory: DigestHistoryEntry[] = [],
  options: RankArticlesOptions<T> = {}
): T[] {
  if (topN <= 0) return [];

  const orderedProjectArticles = deduplicateRankedEvents(options.prioritizedProjectArticles || [])
    .sort((a, b) => {
      const matchesA = options.qualifiedProjectMatches?.get(a) || [];
      const matchesB = options.qualifiedProjectMatches?.get(b) || [];
      const bestA = [...matchesA].sort((x, y) =>
        y.projectRelevance - x.projectRelevance || y.actionability - x.actionability
      )[0];
      const bestB = [...matchesB].sort((x, y) =>
        y.projectRelevance - x.projectRelevance || y.actionability - x.actionability
      )[0];
      const typeRank = (match?: ProjectMatch): number => !match ? 0 : getProjectMatchType(match) === 'direct' ? 2 : getProjectMatchType(match) === 'transferable' ? 1 : 0;
      return typeRank(bestB) - typeRank(bestA)
        || (bestB?.projectRelevance || 0) - (bestA?.projectRelevance || 0)
        || (bestB?.actionability || 0) - (bestA?.actionability || 0)
        || getAdjustedGenericScore(b) - getAdjustedGenericScore(a)
        || b.genericScore - a.genericScore
        || b.pubDate.getTime() - a.pubDate.getTime();
    });
  const prioritizedProjectArticles = applySoftSourceDiversity(orderedProjectArticles, topN, PROJECT_SOURCE_SOFT_LIMIT);
  const prioritizedResearchArticles = applySoftSourceDiversity(
    deduplicateRankedEvents(options.prioritizedResearchArticles || [])
    .filter(article => !prioritizedProjectArticles.some(priority => isSameDigestEvent(article, priority)))
    .sort(compareGenericRank),
    Math.max(0, topN - prioritizedProjectArticles.length),
    RESEARCH_SOURCE_SOFT_LIMIT
  );
  const genericQuota = Math.max(0, (options.genericMaxItems ?? topN) - prioritizedResearchArticles.length);
  const genericLimit = options.includeGeneric === false
    ? 0
    : Math.min(genericQuota, topN - prioritizedProjectArticles.length - prioritizedResearchArticles.length);
  const genericPool = articles
    .filter(article => !prioritizedProjectArticles.some(priority => isSameDigestEvent(article, priority)))
    .filter(article => !prioritizedResearchArticles.some(priority => isSameDigestEvent(article, priority)));
  const uniqueArticles = deduplicateRankedEvents(genericPool);
  const sourceGroups = new Map<string, T[]>();
  for (const article of uniqueArticles) {
    const identity = getSourceChannelIdentity(article);
    const group = sourceGroups.get(identity);
    if (group) group.push(article);
    else sourceGroups.set(identity, [article]);
  }
  const sourceLimitedNames = new Set([...sourceGroups.entries()]
    .filter(([, sourceArticles]) => sourceArticles.length > getSourceTopLimit(sourceArticles[0]!))
    .map(([identity]) => identity));
  const ordered = [...uniqueArticles].sort(compareGenericRank);

  const fresh = ordered.filter(article => !appearedInRecentDigest(article, recentHistory));
  const coolingDown = ordered.filter(article => appearedInRecentDigest(article, recentHistory));
  const firstPartyBoosted = uniqueArticles.filter(article => article.sourceTier === 'first-party').length;
  const lowInformationPenalized = uniqueArticles.filter(article => getLowInformationPenalty(article) > 0).length;
  const secondary = uniqueArticles.filter(article => assessVerificationStatus(article) === 'secondary').length;
  const traceableSecondary = uniqueArticles.filter(article => assessVerificationStatus(article) === 'traceable-secondary').length;
  const unverified = uniqueArticles.filter(article => assessVerificationStatus(article) === 'unverified').length;
  console.log(
    `[digest] Top ranking controls: projectPriority=${prioritizedProjectArticles.length}, researchPriority=${prioritizedResearchArticles.length}, `
    + `genericUniqueEvents=${uniqueArticles.length}/${genericPool.length}, `
    + `duplicates=${genericPool.length - uniqueArticles.length}, cooldownCandidates=${coolingDown.length}, `
    + `firstPartyBoosted=${firstPartyBoosted}, lowInformationPenalized=${lowInformationPenalized}, `
    + `secondary=${secondary}, traceableSecondary=${traceableSecondary}, unverified=${unverified}, `
    + `sourceCaps=${[...sourceLimitedNames].join(', ') || 'none'}`
  );
  const selectedGeneric = applySourceTopLimits(fresh, genericLimit);
  if (selectedGeneric.length >= genericLimit || coolingDown.length === 0) {
    const selected = [...prioritizedProjectArticles, ...prioritizedResearchArticles, ...selectedGeneric].slice(0, topN);
    logTopSourceDistribution(selected);
    return selected;
  }

  const selectedSet = new Set(selectedGeneric);
  const genericWithBackfill = applySourceTopLimits(
    [...selectedGeneric, ...coolingDown.filter(article => !selectedSet.has(article))],
    genericLimit
  );
  const withBackfill = [...prioritizedProjectArticles, ...prioritizedResearchArticles, ...genericWithBackfill].slice(0, topN);
  logTopSourceDistribution(withBackfill);
  return withBackfill;
}

export function selectSupplementalViewCandidates<T extends RankableArticle>(
  articles: T[],
  topArticles: T[],
  recentHistory: DigestHistoryEntry[] = [],
  excludedArticles: T[] = topArticles,
  limit = MAX_SUPPLEMENTAL_VIEWS
): T[] {
  if (limit <= 0) return [];

  const topSourceIdentities = new Set(topArticles.map(getSourceChannelIdentity));
  const topPublisherIdentities = new Set(topArticles.map(getArticlePublisherIdentity));
  const selectedSourceIdentities = new Set<string>();
  const selectedPublisherIdentities = new Set<string>();
  const candidates = deduplicateRankedEvents(articles)
    .filter(article => !excludedArticles.some(existing => isSameDigestEvent(article, existing)))
    .filter(article => !appearedInRecentDigest(article, recentHistory))
    .filter(article => !topSourceIdentities.has(getSourceChannelIdentity(article)))
    .filter(article => !topPublisherIdentities.has(getArticlePublisherIdentity(article)))
    .filter(article => article.breakdown.quality >= MIN_SUPPLEMENTAL_QUALITY)
    .filter(article => article.breakdown.relevance >= MIN_SUPPLEMENTAL_RELEVANCE)
    .filter(article => getAdjustedGenericScore(article) >= MIN_SUPPLEMENTAL_ADJUSTED_SCORE)
    .filter(article => assessVerificationStatus(article) !== 'unverified')
    .sort(compareGenericRank);

  const selected: T[] = [];
  for (const article of candidates) {
    const sourceIdentity = getSourceChannelIdentity(article);
    const publisherIdentity = getArticlePublisherIdentity(article);
    if (selectedSourceIdentities.has(sourceIdentity) || selectedPublisherIdentities.has(publisherIdentity)) continue;
    selected.push(article);
    selectedSourceIdentities.add(sourceIdentity);
    selectedPublisherIdentities.add(publisherIdentity);
    if (selected.length >= limit) break;
  }

  console.log(
    `[digest] Supplemental views: qualified=${candidates.length}, selected=${selected.length}, `
    + `sources=${selected.map(article => article.sourceName).join(', ') || 'none'}`
  );
  return selected;
}

export function extractTopDigestHistory(markdown: string): DigestHistoryEntry[] {
  const section = markdown.match(/## 🏆 今日必读\s*\n([\s\S]*?)(?:\n---\s*\n|\n## )/)?.[1] || '';
  const matches = [
    ...section.matchAll(/^\[([^\]]+)]\((https?:\/\/[^)\s]+)\)\s+—/gm),
    ...markdown.matchAll(/^### \d+\. .+\n\n\[([^\]]+)]\((https?:\/\/[^)\s]+)\)\s+—/gm),
  ];
  const entries = new Map<string, DigestHistoryEntry>();
  for (const match of matches) {
    const entry = { title: match[1]!.trim(), link: match[2]!.trim() };
    entries.set(normalizeArticleUrl(entry.link), entry);
  }
  return [...entries.values()];
}

export function extractProjectDigestHistory(markdown: string): DigestHistoryEntry[] {
  const section = markdown.match(/## 🎯 项目相关情报\s*\n([\s\S]*?)(?:\n---\s*\n|$)/)?.[1] || '';
  const entries = new Map<string, DigestHistoryEntry>();
  for (const match of section.matchAll(/^#### \[([^\]]+)]\((https?:\/\/[^)\s]+)\)/gm)) {
    const entry = { title: match[1]!.trim(), link: match[2]!.trim() };
    entries.set(normalizeArticleUrl(entry.link), entry);
  }
  return [...entries.values()];
}

export function extractResearchDigestHistory(markdown: string): DigestHistoryEntry[] {
  const section = markdown.match(/## 📚 前沿论文与研究\s*\n([\s\S]*?)(?:\n---\s*\n|$)/)?.[1] || '';
  const entries = new Map<string, DigestHistoryEntry>();
  for (const match of section.matchAll(/^### \[([^\]]+)]\((https?:\/\/[^)\s]+)\)/gm)) {
    const entry = { title: match[1]!.trim(), link: match[2]!.trim() };
    entries.set(normalizeArticleUrl(entry.link), entry);
  }
  return [...entries.values()];
}

async function loadRecentHistory(
  outputPath: string,
  extractor: (markdown: string) => DigestHistoryEntry[],
  historyLabel: string,
  now: Date,
  ignoreCurrentOutput: boolean
): Promise<DigestHistoryEntry[]> {
  const directory = dirname(outputPath);
  const currentOutputName = basename(outputPath);
  const cutoff = now.getTime() - DIGEST_COOLDOWN_HOURS * 60 * 60 * 1000;
  try {
    const files = await readdir(directory);
    const recentFiles = files.filter(name => {
      if (ignoreCurrentOutput && name === currentOutputName) return false;
      const match = name.match(/^digest-(\d{4})(\d{2})(\d{2})\.md$/);
      if (!match) return false;
      const fileDate = new Date(`${match[1]}-${match[2]}-${match[3]}T23:59:59Z`).getTime();
      return fileDate >= cutoff && fileDate <= now.getTime() + 24 * 60 * 60 * 1000;
    });
    const reports = await Promise.all(recentFiles.map(name => readFile(`${directory}/${name}`, 'utf8')));
    const entries = new Map<string, DigestHistoryEntry>();
    for (const entry of reports.flatMap(extractor)) {
      entries.set(normalizeArticleUrl(entry.link), entry);
    }
    return [...entries.values()];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[digest] Recent ${historyLabel} history unavailable (${message}); skipping ${DIGEST_COOLDOWN_HOURS}h cooldown`);
    return [];
  }
}

export async function loadRecentDigestHistory(outputPath: string, now = new Date(), ignoreCurrentOutput = false): Promise<DigestHistoryEntry[]> {
  return loadRecentHistory(outputPath, extractTopDigestHistory, 'generic digest', now, ignoreCurrentOutput);
}

export async function loadRecentProjectDigestHistory(outputPath: string, now = new Date(), ignoreCurrentOutput = false): Promise<DigestHistoryEntry[]> {
  return loadRecentHistory(outputPath, extractProjectDigestHistory, 'project digest', now, ignoreCurrentOutput);
}

export async function loadRecentResearchDigestHistory(outputPath: string, now = new Date(), ignoreCurrentOutput = false): Promise<DigestHistoryEntry[]> {
  return loadRecentHistory(outputPath, extractResearchDigestHistory, 'research digest', now, ignoreCurrentOutput);
}

interface ProjectIntelligenceCandidate<T> {
  article: T;
  matches: ProjectMatch[];
  cooldownProjectIds: string[];
}

interface ProjectEventCandidate<T> {
  article: T;
  match: ProjectMatch;
}

function tokenizeEventText(value: string): Set<string> {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/hugging\s*face/g, 'hugging face')
    .replace(/[^a-z0-9]+/g, ' ');

  return new Set(normalized
    .split(/\s+/)
    .map(token => {
      if (token === 'agents') return 'agent';
      if (token === 'models') return 'model';
      if (token === 'systems') return 'system';
      if (token.length > 4 && token.endsWith('s') && !/(ss|is|us)$/.test(token)) return token.slice(0, -1);
      return token;
    })
    .filter(token => token.length >= 3 && !EVENT_STOP_WORDS.has(token)));
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const value of a) {
    if (b.has(value)) count++;
  }
  return count;
}

function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  const denominator = Math.min(a.size, b.size);
  return denominator === 0 ? 0 : intersectionSize(a, b) / denominator;
}

function getHostname(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function getDomainIdentity(hostname: string): string {
  const parts = hostname.replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  return parts[parts.length - 2] || '';
}

export function getSourceAuthorityScore(
  article: { title: string; description: string; link: string; sourceUrl: string; sourceTier?: SourceTier; breakdown?: ArticleScore },
  eventContext = ''
): number {
  const linkHostname = getHostname(article.link);
  if (!linkHostname || AGGREGATOR_HOSTS.has(linkHostname)) return 0;

  let score = article.sourceTier === 'first-party'
    ? 5
    : article.sourceTier === 'research'
      ? 4
      : article.sourceTier === 'aggregator'
        ? 1
        : 2;
  const sourceHostname = getHostname(article.sourceUrl);
  if (sourceHostname && (sourceHostname === linkHostname || linkHostname.endsWith(`.${sourceHostname}`))) {
    score += 1;
  }

  const domainIdentity = getDomainIdentity(linkHostname).replace(/[^a-z0-9]/g, '');
  const articleText = `${article.title} ${article.description} ${article.breakdown?.keywords.join(' ') || ''} ${eventContext}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (domainIdentity.length >= 4 && articleText.includes(domainIdentity)) {
    score += 2;
  }

  return score;
}

function getProjectSourcePreferenceScore(
  article: { sourceTier?: SourceTier; sourceTags?: string[] },
  project: ProjectConfig
): number {
  let score = article.sourceTier && project.sourcePreferences.preferredTiers.includes(article.sourceTier) ? 2 : 0;
  const preferredTags = new Set(project.sourcePreferences.preferredTags.map(tag => tag.toLowerCase()));
  score += (article.sourceTags || []).filter(tag => preferredTags.has(tag.toLowerCase())).length;
  return score;
}

function compareProjectEventCandidates<
  T extends { title: string; description: string; link: string; sourceUrl: string; sourceTier?: SourceTier; sourceTags?: string[]; breakdown: ArticleScore; genericScore: number; projectAwareScore: number; pubDate: Date }
>(a: ProjectEventCandidate<T>, b: ProjectEventCandidate<T>, project: ProjectConfig, eventContext = ''): number {
  const matchTypeRank = (match: ProjectMatch): number => getProjectMatchType(match) === 'direct' ? 2 : getProjectMatchType(match) === 'transferable' ? 1 : 0;
  return matchTypeRank(b.match) - matchTypeRank(a.match)
    || getProjectSourcePreferenceScore(b.article, project) - getProjectSourcePreferenceScore(a.article, project)
    || getSourceAuthorityScore(b.article, eventContext) - getSourceAuthorityScore(a.article, eventContext)
    || b.article.breakdown.quality - a.article.breakdown.quality
    || b.match.projectRelevance - a.match.projectRelevance
    || b.match.actionability - a.match.actionability
    || b.article.projectAwareScore - a.article.projectAwareScore
    || b.article.genericScore - a.article.genericScore
    || b.article.pubDate.getTime() - a.article.pubDate.getTime();
}

export function selectProjectIntelligenceCandidates<
  T extends { title: string; description: string; link: string; sourceUrl: string; sourceTier?: SourceTier; sourceTags?: string[]; breakdown: ArticleScore; genericScore: number; projectAwareScore: number; pubDate: Date }
>(articles: T[], projects: ProjectConfig[], recentHistory: DigestHistoryEntry[] = []): Array<ProjectIntelligenceCandidate<T>> {
  const selectedByArticle = new Map<T, { matches: ProjectMatch[]; cooldownProjectIds: string[] }>();

  for (const project of projects) {
    const modelMatches = articles.flatMap(article => {
      const match = article.breakdown.projectMatches.find(item => item.projectId === project.id);
      return match ? [{ article, match }] : [];
    });
    const relevanceQualified = modelMatches.filter(({ match }) =>
      match.projectRelevance >= project.selection.minSectionRelevance
    );
    const eligible = relevanceQualified.filter(({ article, match }) =>
      getProjectMatchType(match) !== 'adjacent'
      && article.breakdown.quality >= project.selection.minArticleQuality
      && match.actionability >= project.selection.minActionability
    );
    const eventClusters: Array<Array<ProjectEventCandidate<T>>> = [];
    for (const candidate of eligible) {
      const cluster = eventClusters.find(items =>
        items.some(item => isSameDigestEvent(item.article, candidate.article))
      );
      if (cluster) cluster.push(candidate);
      else eventClusters.push([candidate]);
    }
    const eventRepresentatives = eventClusters
      .map(cluster => {
        const eventContext = cluster
          .map(({ article }) => `${article.title} ${article.description} ${article.breakdown.keywords.join(' ')}`)
          .join(' ');
        return [...cluster].sort((a, b) => compareProjectEventCandidates(a, b, project, eventContext))[0]!;
      })
      .sort((a, b) => {
        const typeRank = (match: ProjectMatch): number => getProjectMatchType(match) === 'direct' ? 2 : getProjectMatchType(match) === 'transferable' ? 1 : 0;
        return typeRank(b.match) - typeRank(a.match)
        || b.match.projectRelevance - a.match.projectRelevance
        || b.match.actionability - a.match.actionability
        || getProjectSourcePreferenceScore(b.article, project) - getProjectSourcePreferenceScore(a.article, project)
        || b.article.projectAwareScore - a.article.projectAwareScore
        || getSourceAuthorityScore(b.article) - getSourceAuthorityScore(a.article)
        || b.article.genericScore - a.article.genericScore
        || b.article.pubDate.getTime() - a.article.pubDate.getTime();
      });
    const direct = eventRepresentatives.filter(({ match }) => getProjectMatchType(match) === 'direct');
    const transferable = eventRepresentatives.filter(({ match }) => getProjectMatchType(match) === 'transferable');
    const fresh = [
      ...direct.filter(({ article }) => !appearedInRecentDigest(article, recentHistory)),
      ...transferable.filter(({ article }) => !appearedInRecentDigest(article, recentHistory)),
    ];
    const coolingDown = [
      ...direct.filter(({ article }) => appearedInRecentDigest(article, recentHistory)),
      ...transferable.filter(({ article }) => appearedInRecentDigest(article, recentHistory)),
    ];
    const selectedFresh = fresh.slice(0, project.selection.maxItems);
    const backfilled = coolingDown.slice(0, project.selection.maxItems - selectedFresh.length);
    const selected = [...selectedFresh, ...backfilled];
    const backfilledArticles = new Set(backfilled.map(({ article }) => article));

    console.log(
      `[digest] Project ${project.id} (${project.selection.preset}): matched=${modelMatches.length}, relevance>=${project.selection.minSectionRelevance}=${relevanceQualified.length}, quality>=${project.selection.minArticleQuality} and actionability>=${project.selection.minActionability}=${eligible.length}, direct=${direct.length}, transferable=${transferable.length}, adjacentExcluded=${relevanceQualified.filter(({ match }) => getProjectMatchType(match) === 'adjacent').length}, uniqueEvents=${eventClusters.length}, duplicates=${eligible.length - eventClusters.length}, cooldownCandidates=${coolingDown.length}, backfilled=${backfilled.length}, selected=${selected.length}`
    );

    for (const { article, match } of selected) {
      const selection = selectedByArticle.get(article) || { matches: [], cooldownProjectIds: [] };
      selection.matches.push(match);
      if (backfilledArticles.has(article)) selection.cooldownProjectIds.push(project.id);
      selectedByArticle.set(article, selection);
    }
  }

  return Array.from(selectedByArticle, ([article, selection]) => ({ article, ...selection }));
}

export function renderProjectIntelligenceSection(articles: ScoredArticle[], projects: ProjectConfig[], topArticles: ScoredArticle[]): string {
  if (projects.length === 0) return '';

  const projectById = new Map(projects.map(project => [project.id, project]));
  const topArticleUrls = new Set(topArticles.map(article => normalizeArticleUrl(article.link)));
  const grouped = new Map<string, Array<{ article: ScoredArticle; match: ProjectMatch }>>();

  for (const article of articles) {
    for (const match of article.projectMatches) {
      if (!projectById.has(match.projectId)) continue;
      const list = grouped.get(match.projectId) || [];
      list.push({ article, match });
      grouped.set(match.projectId, list);
    }
  }

  let section = `## 🎯 项目相关情报\n\n`;

  for (const project of projects) {
    const items = grouped.get(project.id);
    section += `### ${project.name}\n\n`;
    if (!items || items.length === 0) {
      section += `> 暂无达到质量门槛的项目相关情报。\n\n`;
      continue;
    }

    items.sort((a, b) =>
      (getProjectMatchType(b.match) === 'direct' ? 2 : 1) - (getProjectMatchType(a.match) === 'direct' ? 2 : 1)
      || b.match.projectRelevance - a.match.projectRelevance
      || b.match.actionability - a.match.actionability
      || b.article.score - a.article.score
    );

    for (const { article, match } of items) {
      const includedInTop = topArticleUrls.has(normalizeArticleUrl(article.link));
      const isCooldownBackfill = article.projectCooldownIds?.includes(match.projectId) || false;
      const statusLabels = [
        includedInTop ? `本期 Top ${topArticles.length} 已收录` : '',
        isCooldownBackfill ? '48h 回填' : '',
      ].filter(Boolean);
      const verificationLabel = getVerificationLabel(article);

      section += `#### [${article.titleZh || article.title}](${article.link})\n\n`;
      if (statusLabels.length > 0) section += `> **状态**：${statusLabels.join(' · ')}\n\n`;
      if (!includedInTop) section += `${article.summary}\n\n`;
      section += `- **匹配类型**：${getProjectMatchType(match) === 'direct' ? '直接相关' : '可迁移参考'}\n`;
      section += `- **项目相关性**：${match.projectRelevance}/10\n`;
      section += `- **可落地性**：${match.actionability}/10\n`;
      section += `- **为什么相关**：${match.whyRelevant || '模型未提供具体说明。'}\n`;
      section += `- **建议动作**：${match.recommendedAction || '加入后续人工评估清单。'}\n`;
      section += `- **来源**：${article.sourceName}${verificationLabel ? ` · ${verificationLabel}` : ''}\n\n`;
      if (verificationLabel === '待核实') section += `> **核实提示**：当前摘要未提供可追溯的一手来源，请核实后再采取行动。\n\n`;
    }
  }

  section += `---\n\n`;
  return section;
}

export function renderResearchIntelligenceSection(
  articles: ResearchIntelligenceArticle[],
  topArticles: ScoredArticle[]
): string {
  if (articles.length === 0) return '';
  const topUrls = new Set(topArticles.map(article => normalizeArticleUrl(article.link)));
  let section = `## 📚 前沿论文与研究\n\n`;
  section += `> 聚焦大模型与 AI Agent，综合前沿性、实验证据、潜在影响和跨来源关注动量筛选。\n\n`;

  for (const article of articles) {
    const inTop = topUrls.has(normalizeArticleUrl(article.link));
    const assessment = article.researchAssessment;
    section += `### [${article.titleZh || article.title}](${article.link})\n\n`;
    if (inTop) section += `> **状态**：本期 Top ${topArticles.length} 已收录\n\n`;
    if (!inTop) section += `${article.summary}\n\n`;
    section += `- **前沿性**：${assessment.frontierScore}/10\n`;
    section += `- **证据质量**：${assessment.evidenceScore}/10\n`;
    section += `- **潜在影响**：${assessment.impactScore}/10\n`;
    section += `- **可复现性**：${assessment.reproducibilityScore}/10\n`;
    section += `- **关注动量**：${article.attentionScore}/10 · ${article.attentionSignals.join(' · ')}\n`;
    section += `- **研究价值**：${assessment.whyImportant}\n`;
    section += `- **证据限制**：${assessment.limitations}\n`;
    const verificationLabel = getVerificationLabel(article);
    section += `- **来源**：${article.sourceName}${verificationLabel ? ` · ${verificationLabel}` : ''}\n\n`;
    if (verificationLabel === '待核实') section += `> **核实提示**：当前摘要未提供可追溯的一手来源。\n\n`;
  }
  section += `---\n\n`;
  return section;
}

export function renderSupplementalViewsSection(articles: ScoredArticle[], topArticleCount: number): string {
  if (articles.length === 0) return '';

  let section = `## 🌍 补充视角\n\n`;
  section += `> Top ${topArticleCount} 未覆盖的高质量不同来源，最多 3 条。\n\n`;
  for (let index = 0; index < articles.length; index++) {
    const article = articles[index]!;
    const category = CATEGORY_META[article.category];
    const verificationLabel = getVerificationLabel(article);
    const scoreTotal = article.scoreBreakdown.relevance + article.scoreBreakdown.quality + article.scoreBreakdown.timeliness;
    section += `### ${index + 1}. ${article.titleZh || article.title}\n\n`;
    section += `[${article.title}](${article.link}) — **${article.sourceName}** · ${humanizeTime(article.pubDate)} · ${category.emoji} ${category.label} · ⭐ ${scoreTotal}/30${verificationLabel ? ` · **${verificationLabel}**` : ''}\n\n`;
    section += `> ${article.summary}\n\n`;
    if (article.reason) section += `💡 **补充价值**：${article.reason}\n\n`;
  }
  section += `---\n\n`;
  return section;
}

// ============================================================================
// Report Generation
// ============================================================================

function generateDigestReport(articles: ScoredArticle[], highlights: string, stats: {
  totalFeeds: number;
  successFeeds: number;
  totalArticles: number;
  filteredArticles: number;
  hours: number;
  lang: string;
}, clawfeedContent: string, trendingRepos: TrendingRepo[], designArticles: DesignArticle[], projects: ProjectConfig[], projectArticles: ScoredArticle[], researchArticles: ResearchIntelligenceArticle[], supplementalArticles: ScoredArticle[]): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const hasProjectProfiles = projects.length > 0;
  const hasDesignIntelligence = designArticles.length > 0;
  const hasSupplementalViews = supplementalArticles.length > 0;
  const hasResearchIntelligence = researchArticles.length > 0;

  let report = `# 📰 AI 资讯每日精选 — ${dateStr}\n\n`;
  report += `> 汇聚 ${stats.totalFeeds}+ 技术博客、X/Twitter、Hacker News、Reddit、Product Hunt、\n`;
  report += `> Lobste.rs、ClawFeed 日报及 GitHub Trending，经 AI 评分筛选。\n`;
  report += `>\n`;
  report += `> **本期内容**：🏆 今日必读 · 🌐 ClawFeed 日报 · 🔥 GitHub Trending · 📂 分类精选${hasDesignIntelligence ? ' · 🎨 设计与生成式 AI' : ''} · 📊 数据概览${hasProjectProfiles ? ' · 🎯 项目相关情报' : ''}${hasResearchIntelligence ? ' · 📚 前沿论文与研究' : ''}${hasSupplementalViews ? ' · 🌍 补充视角' : ''}\n\n`;

  // ── Today's Highlights ──
  if (highlights) {
    report += `## 📝 今日看点\n\n`;
    report += `${highlights}\n\n`;
    report += `---\n\n`;
  }

  // ── Top 5 Deep Showcase ──
  if (articles.length >= 3) {
    report += `## 🏆 今日必读\n\n`;
    for (let i = 0; i < Math.min(5, articles.length); i++) {
      const a = articles[i];
      const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i];
      const catMeta = CATEGORY_META[a.category];
      const verificationLabel = getVerificationLabel(a);

      report += `${medal} **${a.titleZh || a.title}**\n\n`;
      report += `[${a.title}](${a.link}) — ${a.sourceName} · ${humanizeTime(a.pubDate)} · ${catMeta.emoji} ${catMeta.label}${verificationLabel ? ` · **${verificationLabel}**` : ''}\n\n`;
      report += `> ${a.summary}\n\n`;
      if (a.reason) {
        report += `💡 **为什么值得读**: ${a.reason}\n\n`;
      }
      if (a.keywords.length > 0) {
        report += `🏷️ ${a.keywords.join(', ')}\n\n`;
      }
    }
    report += `---\n\n`;
  }

  // ── ClawFeed Daily Digest ──
  if (clawfeedContent) {
    report += `## 🌐 ClawFeed 日报精选\n\n`;
    report += `> 来源：[ClawFeed](https://clawfeed.kevinhe.io) — AI 驱动的多源新闻聚合\n\n`;
    report += extractClawFeedSections(clawfeedContent);
    report += `---\n\n`;
  }

  // ── GitHub Trending ──
  if (trendingRepos.length > 0) {
    const AI_KEYWORDS = /\b(ai|llm|gpt|claude|gemini|openai|anthropic|ml|machine.?learning|deep.?learning|neural|transformer|diffusion|agent|rag|langchain|embedding|fine.?tun|lora|qlora|stable.?diffusion|whisper|llama|mistral|copilot|chatbot|nlp|computer.?vision|generative)\b/i;

    report += `## 🔥 GitHub Trending\n\n`;
    report += `> 今日热门开源项目（全语言 + Python）\n\n`;
    report += `| # | 项目 | 描述 | ⭐ 总星 | 📈 今日 | 语言 |\n`;
    report += `|---|------|------|---------|---------|------|\n`;

    for (let i = 0; i < trendingRepos.length; i++) {
      const r = trendingRepos[i];
      const isAI = AI_KEYWORDS.test(r.description) || AI_KEYWORDS.test(r.name);
      const aiTag = isAI ? ' 🤖' : '';
      const desc = r.description.length > 60 ? r.description.slice(0, 57) + '...' : r.description;
      report += `| ${i + 1} | [${r.name}](${r.url})${aiTag} | ${desc} | ${formatStarCount(r.stars)} | +${r.todayStars} | ${r.language || '-'} |\n`;
    }

    report += `\n---\n\n`;
  }

  // ── Category-Grouped Articles ──
  const categoryGroups = new Map<CategoryId, ScoredArticle[]>();
  for (const a of articles) {
    const list = categoryGroups.get(a.category) || [];
    list.push(a);
    categoryGroups.set(a.category, list);
  }

  const sortedCategories = Array.from(categoryGroups.entries())
    .sort((a, b) => b[1].length - a[1].length);

  let globalIndex = 0;
  for (const [catId, catArticles] of sortedCategories) {
    const catMeta = CATEGORY_META[catId];
    report += `## ${catMeta.emoji} ${catMeta.label}\n\n`;

    for (const a of catArticles) {
      globalIndex++;
      const scoreTotal = a.scoreBreakdown.relevance + a.scoreBreakdown.quality + a.scoreBreakdown.timeliness;
      const verificationLabel = getVerificationLabel(a);

      report += `### ${globalIndex}. ${a.titleZh || a.title}\n\n`;
      report += `[${a.title}](${a.link}) — **${a.sourceName}** · ${humanizeTime(a.pubDate)} · ⭐ ${scoreTotal}/30${verificationLabel ? ` · **${verificationLabel}**` : ''}\n\n`;
      report += `> ${a.summary}\n\n`;
      if (a.keywords.length > 0) {
        report += `🏷️ ${a.keywords.join(', ')}\n\n`;
      }
      report += `---\n\n`;
    }
  }

  // ── Design & Generative AI ──
  report += renderDesignSection(designArticles);

  // ── Visual Statistics ──
  report += `## 📊 数据概览\n\n`;

  report += `| 扫描源 | 抓取文章 | 时间范围 | 精选 |\n`;
  report += `|:---:|:---:|:---:|:---:|\n`;
  report += `| ${stats.successFeeds}/${stats.totalFeeds} | ${stats.totalArticles} 篇 → ${stats.filteredArticles} 篇 | ${stats.hours}h | **${articles.length} 篇** |\n\n`;

  const pieChart = generateCategoryPieChart(articles);
  if (pieChart) {
    report += `### 分类分布\n\n${pieChart}\n`;
  }

  const barChart = generateKeywordBarChart(articles);
  if (barChart) {
    report += `### 高频关键词\n\n${barChart}\n`;
  }

  const asciiChart = generateAsciiBarChart(articles);
  if (asciiChart) {
    report += `<details>\n<summary>📈 纯文本关键词图（终端友好）</summary>\n\n${asciiChart}\n</details>\n\n`;
  }

  const tagCloud = generateTagCloud(articles);
  if (tagCloud) {
    report += `### 🏷️ 话题标签\n\n${tagCloud}\n\n`;
  }

  report += `---\n\n`;

  report += renderProjectIntelligenceSection(projectArticles, projects, articles);

  report += renderResearchIntelligenceSection(researchArticles, articles);

  report += renderSupplementalViewsSection(supplementalArticles, articles.length);

  // ── Footer ──
  report += `*生成于 ${dateStr} ${now.toISOString().split('T')[1]?.slice(0, 5) || ''} | 汇聚 ${stats.totalFeeds} 个技术博客、X/Twitter、Hacker News、Reddit、Product Hunt、Lobste.rs、ClawFeed 日报及 GitHub Trending，经 AI 评分筛选出 Top ${articles.length} 精华内容${supplementalArticles.length > 0 ? `，另附 ${supplementalArticles.length} 条不同来源补充视角` : ''}*\n`;

  return report;
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): never {
  console.log(`AI Daily Digest - AI-powered digest from 110+ tech and research sources

Usage:
  bun scripts/digest.ts [options]

Options:
  --hours <n>     Time range in hours (default: 48)
  --top-n <n>     Number of top articles to include (default: 15)
  --lang <lang>   Summary language: zh or en (default: zh)
  --output <path> Output file path (default: ./digest-YYYYMMDD.md)
  --help          Show this help

Environment:
  GEMINI_API_KEY   Optional Gemini provider key. Get one at https://aistudio.google.com/apikey
  OPENAI_API_KEY   Optional OpenAI-compatible provider key
  OPENAI_API_BASE  Optional OpenAI-compatible base URL (default: https://api.openai.com/v1)
  OPENAI_MODEL     Optional OpenAI-compatible model (default: deepseek-v4-flash for DeepSeek base, else gpt-4o-mini)
  AI_PRIMARY_PROVIDER Preferred provider: gemini, openai, or deepseek (default: gemini)
  AI_REQUEST_TIMEOUT_MS Per-request timeout in milliseconds (default: 180000)
  DEEPSEEK_THINKING_TASKS Comma-separated tasks: project-scoring,research-scoring,summary,highlights,design; all or none (default: project-scoring,highlights)
  DESIGN_SECTION_ENABLED Enable the legacy Design & Generative AI section and its AI request (default: false)
  DIGEST_IGNORE_SAME_DAY_COOLDOWN Ignore the current output file when loading 48h history (default: false)
  DIGEST_GENERIC_MODE Generic ranking mode: config, include, or project-only (default: config)
  RSSHUB_BASE_URL  RSSHub instance URL for X/Twitter feeds (default: https://rsshub.app)
  X_ACCOUNTS       Comma-separated X/Twitter accounts to follow (e.g. karpathy,sama,ylecun)
  PROJECTS_CONFIG_PATH Optional project profile JSON path (default: config/projects.json)
  SOURCES_CONFIG_PATH Optional additional RSS/Atom source JSON path (default: config/sources.json)
  SOURCE_HEALTH_PATH Optional persistent feed health JSON path (default: source-health.json beside output)

Examples:
  bun scripts/digest.ts --hours 24 --top-n 10 --lang zh
  bun scripts/digest.ts --hours 72 --top-n 20 --lang en --output ./my-digest.md
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) printUsage();
  
  let hours = 48;
  let topN = 15;
  let lang: 'zh' | 'en' = 'zh';
  let outputPath = '';
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--hours' && args[i + 1]) {
      hours = parseInt(args[++i]!, 10);
    } else if (arg === '--top-n' && args[i + 1]) {
      topN = parseInt(args[++i]!, 10);
    } else if (arg === '--lang' && args[i + 1]) {
      lang = args[++i] as 'zh' | 'en';
    } else if (arg === '--output' && args[i + 1]) {
      outputPath = args[++i]!;
    }
  }
  
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const openaiApiBase = process.env.OPENAI_API_BASE;
  const openaiModel = process.env.OPENAI_MODEL;
  const deepseekThinkingTasks = parseDeepSeekThinkingTasks(process.env.DEEPSEEK_THINKING_TASKS);
  const primaryProvider = parseAIPrimaryProvider(process.env.AI_PRIMARY_PROVIDER);
  const requestTimeoutMs = parseAIRequestTimeout(process.env.AI_REQUEST_TIMEOUT_MS);
  const providerOrder = resolveAIProviderOrder(primaryProvider, Boolean(geminiApiKey), Boolean(openaiApiKey));

  if (!geminiApiKey && !openaiApiKey) {
    console.error('[digest] Error: Missing API key. Set GEMINI_API_KEY and/or OPENAI_API_KEY.');
    console.error('[digest] Gemini key: https://aistudio.google.com/apikey');
    process.exit(1);
  }

  const aiClient = createAIClient({
    geminiApiKey,
    openaiApiKey,
    openaiApiBase,
    openaiModel,
    deepseekThinkingTasks,
    primaryProvider,
    requestTimeoutMs,
  });
  
  if (!outputPath) {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    outputPath = `./digest-${dateStr}.md`;
  }
  
  console.log(`[digest] === AI Daily Digest ===`);
  console.log(`[digest] Time range: ${hours} hours`);
  console.log(`[digest] Top N: ${topN}`);
  console.log(`[digest] Language: ${lang}`);
  console.log(`[digest] Output: ${outputPath}`);
  console.log(`[digest] AI provider: ${providerOrder[0] === 'openai' ? 'OpenAI-compatible' : 'Gemini'} (primary)`);
  if (providerOrder[1]) {
    console.log(`[digest] AI fallback: ${providerOrder[1] === 'openai' ? 'OpenAI-compatible' : 'Gemini'}`);
  }
  console.log(`[digest] AI request timeout: ${Math.round(requestTimeoutMs / 1000)}s`);
  if (openaiApiKey) {
    const resolvedBase = (openaiApiBase?.trim() || OPENAI_DEFAULT_API_BASE).replace(/\/+$/, '');
    const resolvedModel = openaiModel?.trim() || inferOpenAIModel(resolvedBase);
    const openaiRole = providerOrder[0] === 'openai' ? 'primary' : 'fallback';
    console.log(`[digest] OpenAI-compatible ${openaiRole}: ${resolvedBase} (model=${resolvedModel})`);
    if (resolvedBase.toLowerCase().includes('api.deepseek.com') && resolvedModel.toLowerCase().startsWith('deepseek-v4-')) {
      const taskList = [...deepseekThinkingTasks].join(', ') || 'none';
      console.log(`[digest] DeepSeek thinking tasks: ${taskList}`);
    }
  }
  console.log('');

  const [projectConfig, configuredSources] = await Promise.all([
    loadProjects(),
    loadConfiguredSources(),
  ]);
  const { projects, researchPolicy } = projectConfig;
  const digestPolicy = resolveDigestPolicy(projectConfig.digestPolicy);
  console.log(
    `[digest] Ranking policy: project-first; generic=${digestPolicy.includeGeneric ? 'enabled' : 'disabled'}`
    + `${digestPolicy.includeGeneric ? ` (max ${digestPolicy.genericMaxItems})` : ''}`
  );
  console.log(
    `[digest] Research policy: ${researchPolicy.enabled ? researchPolicy.mode : 'disabled'}`
    + `${researchPolicy.enabled ? ` (max ${researchPolicy.maxItems}, candidates ${researchPolicy.candidateLimit})` : ''}`
  );

  const xFeeds = buildXFeeds();
  const allFeeds = mergeFeedSources(RSS_FEEDS, configuredSources, xFeeds);
  const sourceHealthPath = process.env.SOURCE_HEALTH_PATH?.trim() || `${dirname(outputPath)}/source-health.json`;
  if (xFeeds.length > 0) {
    console.log(`[digest] X/Twitter accounts: ${xFeeds.map(f => f.name).join(', ')} (via ${RSSHUB_BASE_URL})`);
  }

  console.log(`[digest] Step 1/5: Fetching ${allFeeds.length} feeds + ClawFeed + GitHub Trending (parallel)...`);
  const [allArticles, clawfeedContent, trendingRepos] = await Promise.all([
    fetchAllFeeds(allFeeds, sourceHealthPath),
    fetchClawFeedDigest(),
    fetchGitHubTrending(),
  ]);

  if (allArticles.length === 0) {
    console.error('[digest] Error: No articles fetched from any feed. Check network connection.');
    process.exit(1);
  }
  
  console.log(`[digest] Step 2/5: Filtering by time range (${hours} hours)...`);
  const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  const recentArticles = allArticles.filter(a => a.pubDate.getTime() > cutoffTime.getTime());
  
  console.log(`[digest] Found ${recentArticles.length} articles within last ${hours} hours`);
  
  if (recentArticles.length === 0) {
    console.error(`[digest] Error: No articles found within the last ${hours} hours.`);
    console.error(`[digest] Try increasing --hours (e.g., --hours 168 for one week)`);
    process.exit(1);
  }
  
  const scoringArticles = selectArticlesForAIScoring(recentArticles, projects, researchPolicy);
  console.log(`[digest] Step 3/5: AI scoring ${scoringArticles.length} articles...`);
  const scores = await scoreArticlesWithAI(scoringArticles, aiClient, projects);
  
  const scoredArticles = scoringArticles.map((article, index) => {
    const score = scores.get(index) || {
      aiRelevance: 1, aiRelation: 'none' as AIRelation, aiEvidence: '',
      relevance: 5, quality: 5, timeliness: 5, category: 'other' as CategoryId, keywords: [], projectMatches: [],
    };
    const genericScore = getGenericScore(score);
    const projectAwareScore = getProjectAwareScore(score);
    return {
      ...article,
      genericScore,
      projectAwareScore,
      totalScore: projectAwareScore,
      breakdown: score,
    };
  });
  
  const projectMatchedCount = scoredArticles.filter(article => article.breakdown.projectMatches.length > 0).length;
  const genericAIQualifiedArticles = scoredArticles.filter(article => isAIQualifiedForGeneric(article.breakdown, article));
  const genericAIRejectedCount = scoredArticles.length - genericAIQualifiedArticles.length;
  const aiRelationCounts = scoredArticles.reduce((counts, article) => {
    counts[article.breakdown.aiRelation]++;
    return counts;
  }, { direct: 0, enabling: 0, none: 0 } as Record<AIRelation, number>);
  console.log(
    `[digest] Generic AI gate: qualified=${genericAIQualifiedArticles.length}/${scoredArticles.length}, `
    + `rejected=${genericAIRejectedCount}, direct=${aiRelationCounts.direct}, `
    + `enabling=${aiRelationCounts.enabling}, none=${aiRelationCounts.none}, `
    + `threshold=${MIN_GENERIC_AI_RELEVANCE}`
  );
  const genericAIRejectedSamples = scoredArticles
    .filter(article => !isAIQualifiedForGeneric(article.breakdown, article))
    .sort((a, b) => b.genericScore - a.genericScore)
    .slice(0, 5)
    .map(article => `${article.breakdown.aiRelation}/${article.breakdown.aiRelevance}:${article.title.slice(0, 80)}`);
  if (genericAIRejectedSamples.length > 0) {
    console.log(`[digest] Generic AI gate rejected samples: ${genericAIRejectedSamples.join(' | ')}`);
  }
  if (projects.length > 0) {
    console.log(`[digest] Project-matched articles: ${projectMatchedCount}/${scoredArticles.length}`);
  }

  const [recentDigestHistory, recentProjectDigestHistory, recentResearchDigestHistory] = await Promise.all([
    loadRecentDigestHistory(outputPath, new Date(), IGNORE_SAME_DAY_COOLDOWN),
    loadRecentProjectDigestHistory(outputPath, new Date(), IGNORE_SAME_DAY_COOLDOWN),
    loadRecentResearchDigestHistory(outputPath, new Date(), IGNORE_SAME_DAY_COOLDOWN),
  ]);
  if (IGNORE_SAME_DAY_COOLDOWN) {
    console.log('[digest] Same-day cooldown: current output ignored for full manual regeneration');
  }
  if (recentDigestHistory.length > 0) {
    console.log(`[digest] Recent digest cooldown: ${recentDigestHistory.length} Top N article(s) loaded from the last ${DIGEST_COOLDOWN_HOURS}h`);
  }
  if (recentProjectDigestHistory.length > 0) {
    console.log(`[digest] Recent project cooldown: ${recentProjectDigestHistory.length} project article(s) loaded from the last ${DIGEST_COOLDOWN_HOURS}h`);
  }
  if (recentResearchDigestHistory.length > 0) {
    console.log(`[digest] Recent research cooldown: ${recentResearchDigestHistory.length} paper(s) loaded from the last ${DIGEST_COOLDOWN_HOURS}h`);
  }
  const projectCandidates = selectProjectIntelligenceCandidates(scoredArticles, projects, recentProjectDigestHistory);
  const effectiveResearchPolicy: ResearchPolicy = {
    ...researchPolicy,
    enabled: researchPolicy.enabled && digestPolicy.includeGeneric,
  };
  const researchCandidates = await selectResearchIntelligenceCandidates(
    scoredArticles,
    aiClient,
    effectiveResearchPolicy,
    trendingRepos,
    recentResearchDigestHistory
  );
  const prioritizedProjectArticles = projectCandidates.map(candidate => candidate.article);
  const prioritizedResearchArticles = researchPolicy.mode === 'hybrid' || researchPolicy.mode === 'replace-generic'
    ? researchCandidates.map(candidate => candidate.article)
    : [];
  const qualifiedMatchesByArticle = new Map(
    projectCandidates.map(({ article, matches }) => [article, matches] as const)
  );
  const rankingPool = researchPolicy.mode === 'section'
    ? genericAIQualifiedArticles.filter(article => !researchCandidates.some(candidate => isSameDigestEvent(article, candidate.article)))
    : genericAIQualifiedArticles;
  let topArticles = rankArticles(
    rankingPool,
    Math.min(scoredArticles.length, topN),
    recentDigestHistory,
    {
      prioritizedProjectArticles,
      prioritizedResearchArticles,
      qualifiedProjectMatches: qualifiedMatchesByArticle,
      includeGeneric: digestPolicy.includeGeneric,
      genericMaxItems: digestPolicy.genericMaxItems,
    }
  );
  const replacementPool = genericAIQualifiedArticles.filter(article =>
    !topArticles.some(selected => isSameDigestEvent(article, selected))
    && !prioritizedProjectArticles.some(selected => isSameDigestEvent(article, selected))
    && !researchCandidates.some(candidate => isSameDigestEvent(article, candidate.article))
  );
  const replacementCandidates = digestPolicy.includeGeneric
    ? rankArticles(
      replacementPool,
      Math.min(replacementPool.length, MAX_SUMMARY_REPLACEMENT_CANDIDATES),
      recentDigestHistory,
      { includeGeneric: true, genericMaxItems: MAX_SUMMARY_REPLACEMENT_CANDIDATES }
    )
    : [];
  
  console.log(`[digest] Step 4/5: Generating AI summaries...`);
  const summaryArticles = [...topArticles];
  const summaryArticleSet = new Set(summaryArticles);
  for (const { article } of projectCandidates) {
    if (summaryArticleSet.has(article)) continue;
    summaryArticleSet.add(article);
    summaryArticles.push(article);
  }
  for (const { article } of researchCandidates) {
    if (summaryArticleSet.has(article)) continue;
    summaryArticleSet.add(article);
    summaryArticles.push(article);
  }
  const additionalIntelligenceSummaries = summaryArticles.length - topArticles.length;
  console.log(`[digest] Project/research intelligence: ${projectCandidates.length}/${researchCandidates.length} unique articles, ${additionalIntelligenceSummaries} additional summaries outside Top ${topN}`);

  const summaryIndexByArticle = new Map(summaryArticles.map((article, index) => [article, index]));
  const indexedSummaryArticles = summaryArticles.map((article, index) => ({ ...article, index }));
  const summaries = await summarizeArticles(indexedSummaryArticles, aiClient, lang);

  const summarizeAdditionalArticles = async (articles: typeof scoredArticles): Promise<void> => {
    const unsummarized = articles.filter(article => !summaryIndexByArticle.has(article));
    const indexed = unsummarized.map(article => {
      const index = summaryIndexByArticle.size;
      summaryIndexByArticle.set(article, index);
      return { ...article, index };
    });
    if (indexed.length === 0) return;
    const additionalSummaries = await summarizeArticles(indexed, aiClient, lang);
    for (const [index, summary] of additionalSummaries) summaries.set(index, summary);
  };

  const hasUsableSummary = (article: (typeof scoredArticles)[number]): boolean => {
    const index = summaryIndexByArticle.get(article);
    const summary = index === undefined ? undefined : summaries.get(index);
    return summary !== undefined && !isLowInformationGeneratedSummary(summary);
  };

  const rejectedTopArticles = topArticles.filter(article => !hasUsableSummary(article));
  if (rejectedTopArticles.length > 0) {
    console.warn(`[digest] Post-summary quality gate: demoting ${rejectedTopArticles.length} low-information Top article(s)`);
    const rejectedSet = new Set(rejectedTopArticles);
    const retainedTopArticles = topArticles.filter(article => !rejectedSet.has(article));
    const retainedProjectCount = retainedTopArticles
      .filter(article => qualifiedMatchesByArticle.has(article)).length;
    const retainedResearchCount = retainedTopArticles
      .filter(article => researchCandidates.some(candidate => candidate.article === article)).length;
    const retainedGenericCount = retainedTopArticles.length - retainedProjectCount - retainedResearchCount;
    const maxGenericForFinal = Math.min(
      Math.max(0, digestPolicy.genericMaxItems - retainedResearchCount),
      Math.max(0, topN - retainedProjectCount - retainedResearchCount)
    );
    const genericReplacementCapacity = digestPolicy.includeGeneric
      ? Math.max(0, maxGenericForFinal - retainedGenericCount)
      : 0;
    const replacementTarget = Math.min(rejectedTopArticles.length, genericReplacementCapacity);
    const replacementAttempts = replacementCandidates.slice(
      0,
      Math.min(MAX_SUMMARY_REPLACEMENT_CANDIDATES, replacementTarget * 2)
    );
    await summarizeAdditionalArticles(replacementAttempts);
    const acceptedReplacements = replacementAttempts
      .filter(hasUsableSummary)
      .slice(0, replacementTarget);
    topArticles = [
      ...retainedTopArticles,
      ...acceptedReplacements,
    ];
    console.log(
      `[digest] Post-summary quality gate: replacements=${acceptedReplacements.length}, `
      + `finalTop=${topArticles.length}/${topN}`
    );
  }

  const qualityApprovedProjectCandidates = projectCandidates.filter(({ article }) => hasUsableSummary(article));
  if (qualityApprovedProjectCandidates.length < projectCandidates.length) {
    console.warn(
      `[digest] Post-summary quality gate: omitting ${projectCandidates.length - qualityApprovedProjectCandidates.length} `
      + `low-information project article(s)`
    );
  }
  const qualityApprovedResearchCandidates = researchCandidates.filter(({ article }) => hasUsableSummary(article));
  if (qualityApprovedResearchCandidates.length < researchCandidates.length) {
    console.warn(
      `[digest] Post-summary quality gate: omitting ${researchCandidates.length - qualityApprovedResearchCandidates.length} `
      + `low-information research article(s)`
    );
  }

  const supplementalCandidates = selectSupplementalViewCandidates(
    genericAIQualifiedArticles,
    topArticles,
    recentDigestHistory,
    [...topArticles, ...projectCandidates.map(candidate => candidate.article), ...researchCandidates.map(candidate => candidate.article), ...rejectedTopArticles]
  );
  await summarizeAdditionalArticles(supplementalCandidates);
  const finalSupplementalCandidates = supplementalCandidates.filter(hasUsableSummary);
  console.log(`[digest] Supplemental views: ${finalSupplementalCandidates.length} quality-approved summaries outside Top ${topN}`);
  console.log(`[digest] Top ${topArticles.length} articles selected (score range: ${topArticles[topArticles.length - 1]?.projectAwareScore || 0} - ${topArticles[0]?.projectAwareScore || 0})`);
  logTopSourceDistribution(topArticles);

  const toScoredArticle = (
    article: (typeof scoredArticles)[number],
    projectMatches: ProjectMatch[],
    projectCooldownIds: string[] = []
  ): ScoredArticle => {
    const summaryIndex = summaryIndexByArticle.get(article);
    const sm = summaryIndex === undefined
      ? { titleZh: article.title, summary: article.description.slice(0, 200), reason: '' }
      : summaries.get(summaryIndex) || { titleZh: article.title, summary: article.description.slice(0, 200), reason: '' };
    return {
      title: article.title,
      link: article.link,
      pubDate: article.pubDate,
      description: article.description,
      sourceName: article.sourceName,
      sourceUrl: article.sourceUrl,
      sourceTier: article.sourceTier,
      sourceTags: article.sourceTags,
      score: article.projectAwareScore,
      scoreBreakdown: {
        relevance: article.breakdown.relevance,
        quality: article.breakdown.quality,
        timeliness: article.breakdown.timeliness,
      },
      category: article.breakdown.category,
      keywords: article.breakdown.keywords,
      projectMatches,
      titleZh: sm.titleZh,
      summary: sm.summary,
      reason: sm.reason,
      projectCooldownIds,
    };
  };

  const finalArticles = topArticles.map(article =>
    toScoredArticle(article, qualifiedMatchesByArticle.get(article) || [])
  );
  const projectIntelligenceArticles = qualityApprovedProjectCandidates.map(({ article, matches, cooldownProjectIds }) =>
    toScoredArticle(article, matches, cooldownProjectIds)
  );
  const researchIntelligenceArticles: ResearchIntelligenceArticle[] = qualityApprovedResearchCandidates.map(candidate => ({
    ...toScoredArticle(candidate.article, qualifiedMatchesByArticle.get(candidate.article) || []),
    researchAssessment: candidate.assessment,
    attentionScore: candidate.attentionScore,
    attentionSignals: candidate.attentionSignals,
  }));
  const supplementalViewArticles = finalSupplementalCandidates.map(article =>
    toScoredArticle(article, qualifiedMatchesByArticle.get(article) || [])
  );
  
  console.log(`[digest] Step 5/5: Generating today's highlights...`);
  const highlights = await generateHighlights(finalArticles, aiClient, lang);

  let designArticles: DesignArticle[] = [];
  if (DESIGN_SECTION_ENABLED) {
    const seenDesignTitles = new Set<string>();
    const designCandidates = [...scoredArticles]
      .sort(compareGenericRank)
      .filter(a => matchesDesignKeywords({ title: a.title, keywords: a.breakdown.keywords }))
      .filter(a => {
        const key = a.title.toLowerCase().trim();
        if (seenDesignTitles.has(key)) return false;
        seenDesignTitles.add(key);
        return true;
      })
      .slice(0, MAX_DESIGN_CANDIDATES)
      .map((a, i) => ({ index: i, title: a.title, link: a.link, pubDate: a.pubDate, description: a.description, sourceName: a.sourceName, keywords: a.breakdown.keywords }));
    console.log(`[digest] Design & Generative AI candidates: ${designCandidates.length} keyword-matched articles`);
    designArticles = await categorizeDesignArticles(designCandidates, aiClient, lang);
  } else {
    console.log('[digest] Design & Generative AI section: disabled');
  }

  const successfulSources = new Set(allArticles.map(a => a.sourceName));

  const report = generateDigestReport(finalArticles, highlights, {
    totalFeeds: allFeeds.length,
    successFeeds: successfulSources.size,
    totalArticles: allArticles.length,
    filteredArticles: recentArticles.length,
    hours,
    lang,
  }, clawfeedContent, trendingRepos, designArticles, projects, projectIntelligenceArticles,
  researchPolicy.mode === 'hybrid' || researchPolicy.mode === 'section' ? researchIntelligenceArticles : [],
  supplementalViewArticles);

  console.log(
    `[digest] Selection funnel: recent=${recentArticles.length} -> AI-scored=${scoredArticles.length} `
    + `-> generic-AI-qualified=${genericAIQualifiedArticles.length} `
    + `-> model-project-matched=${projectMatchedCount} -> project-selected=${projectIntelligenceArticles.length} `
    + `-> research-selected=${researchIntelligenceArticles.length} -> Top=${finalArticles.length} `
    + `-> supplemental=${supplementalViewArticles.length}`
  );
  
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, report);
  
  console.log('');
  console.log(`[digest] ✅ Done!`);
  console.log(`[digest] 📁 Report: ${outputPath}`);
  console.log(`[digest] 📊 Stats: ${successfulSources.size} sources → ${allArticles.length} articles → ${recentArticles.length} recent → ${finalArticles.length} selected`);
  
  if (finalArticles.length > 0) {
    console.log('');
    console.log(`[digest] 🏆 Top 3 Preview:`);
    for (let i = 0; i < Math.min(3, finalArticles.length); i++) {
      const a = finalArticles[i];
      console.log(`  ${i + 1}. ${a.titleZh || a.title}`);
      console.log(`     ${a.summary.slice(0, 80)}...`);
    }
  }
}

if (import.meta.main) {
  await main().catch((err) => {
    console.error(`[digest] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
