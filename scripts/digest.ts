import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
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
const MAX_PROJECT_MATCHES_PER_ARTICLE = 5;
const MAX_PROJECT_TEXT_LENGTH = 240;
const DIGEST_COOLDOWN_HOURS = 48;
const FIRST_PARTY_RANKING_BONUS = 2;
const MAX_LOW_INFORMATION_PENALTY = 3;
const SECONDARY_SOURCE_TOP_LIMIT = 2;
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
  { name: "Hacker News Best", xmlUrl: "https://hnrss.org/best", htmlUrl: "https://news.ycombinator.com" },
  { name: "r/programming", xmlUrl: "https://www.reddit.com/r/programming/top/.rss?t=day", htmlUrl: "https://www.reddit.com/r/programming" },
  { name: "r/MachineLearning", xmlUrl: "https://www.reddit.com/r/MachineLearning/top/.rss?t=day", htmlUrl: "https://www.reddit.com/r/MachineLearning" },
  { name: "r/LocalLLaMA", xmlUrl: "https://www.reddit.com/r/LocalLLaMA/top/.rss?t=day", htmlUrl: "https://www.reddit.com/r/LocalLLaMA" },
  { name: "r/StableDiffusion", xmlUrl: "https://www.reddit.com/r/StableDiffusion/top/.rss?t=day", htmlUrl: "https://www.reddit.com/r/StableDiffusion" },
  { name: "r/midjourney", xmlUrl: "https://www.reddit.com/r/midjourney/top/.rss?t=day", htmlUrl: "https://www.reddit.com/r/midjourney" },
  { name: "r/comfyui", xmlUrl: "https://www.reddit.com/r/comfyui/top/.rss?t=day", htmlUrl: "https://www.reddit.com/r/comfyui" },
  { name: "r/singularity", xmlUrl: "https://www.reddit.com/r/singularity/top/.rss?t=day", htmlUrl: "https://www.reddit.com/r/singularity" },
  { name: "Product Hunt", xmlUrl: "https://www.producthunt.com/feed", htmlUrl: "https://www.producthunt.com" },
  { name: "Lobste.rs", xmlUrl: "https://lobste.rs/rss", htmlUrl: "https://lobste.rs" },
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
type VerificationStatus = 'first-party' | 'traceable-secondary' | 'unverified';
type ProjectSelectionPreset = 'strict' | 'balanced' | 'broad';

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
  projectRelevance: number;
  actionability: number;
  whyRelevant: string;
  recommendedAction: string;
}

interface ArticleScore {
  relevance: number;
  quality: number;
  timeliness: number;
  category: CategoryId;
  keywords: string[];
  projectMatches: ProjectMatch[];
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

type AITask = 'scoring' | 'project-scoring' | 'summary' | 'highlights' | 'design';
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

async function fetchFeed(feed: FeedSource): Promise<Article[]> {
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
    
    return items.map(item => ({
      title: item.title,
      link: item.link,
      pubDate: parseDate(item.pubDate) || new Date(0),
      description: item.description,
      sourceName: feed.name,
      sourceUrl: feed.htmlUrl,
      sourceTier: feed.tier,
      sourceTags: feed.tags,
      sourceMaxTopItems: feed.maxTopItems,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Only log non-abort errors to reduce noise
    if (!msg.includes('abort')) {
      console.warn(`[digest] ✗ ${feed.name}: ${msg}`);
    } else {
      console.warn(`[digest] ✗ ${feed.name}: timeout`);
    }
    return [];
  }
}

async function fetchAllFeeds(feeds: FeedSource[]): Promise<Article[]> {
  const allArticles: Article[] = [];
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < feeds.length; i += FEED_CONCURRENCY) {
    const batch = feeds.slice(i, i + FEED_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(fetchFeed));
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        allArticles.push(...result.value);
        successCount++;
      } else {
        failCount++;
      }
    }
    
    const progress = Math.min(i + FEED_CONCURRENCY, feeds.length);
    console.log(`[digest] Progress: ${progress}/${feeds.length} feeds processed (${successCount} ok, ${failCount} failed)`);
  }
  
  console.log(`[digest] Fetched ${allArticles.length} articles from ${successCount} feeds (${failCount} failed)`);
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
    if (task === 'scoring' || task === 'project-scoring' || task === 'summary' || task === 'design') {
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
  const validTasks = new Set<AITask>(['project-scoring', 'summary', 'highlights', 'design']);
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

async function loadProjects(configPath = process.env.PROJECTS_CONFIG_PATH || DEFAULT_PROJECTS_CONFIG_PATH): Promise<ProjectConfig[]> {
  try {
    const text = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(text) as { projects?: unknown };

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.projects)) {
      console.warn(`[digest] Project config: ${configPath} does not contain a valid projects array; using generic digest`);
      return [];
    }

    const projects = validateProjectsConfig(parsed);

    console.log(`[digest] Loaded ${projects.length} projects from ${configPath}`);
    if (projects.length === 0) {
      console.warn(`[digest] Project config: no valid projects loaded; using generic digest`);
    }
    return projects;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[digest] Project config: could not load ${configPath} (${msg}); using generic digest`);
    return [];
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

    matches.push({
      projectId,
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
  articles: Array<{ index: number; title: string; description: string; sourceName: string }>,
  projects: ProjectConfig[]
): string {
  const articlesList = articles.map(a =>
    `Index ${a.index}: [${a.sourceName}] ${a.title}\n${a.description.slice(0, 300)}`
  ).join('\n\n---\n\n');

  const projectContext = projects.length === 0
    ? ''
    : `
## 项目方向匹配

请在保留通用评分字段的同时，判断文章是否与以下已配置项目方向相关。
这些项目资料是用户明确批准用于本次评分的非敏感项目画像。不要推断或补充未在文章标题/描述中出现的信息。

${projects.map(project => `### ${project.id}: ${project.name}
- 目标: ${project.goal}
- 必须同时满足的信号组: ${project.requiredSignalGroups.length > 0 ? project.requiredSignalGroups.map((group, index) => `组${index + 1}(${group.join(', ')})`).join('；') : '无'}
- 单组核心必要信号: ${project.requiredSignalGroups.length === 0 && project.requiredSignals.length > 0 ? project.requiredSignals.join(', ') : '无额外限制'}
- 辅助信号: ${project.supportingSignals.length > 0 ? project.supportingSignals.join(', ') : '无'}
- 负面信号: ${project.negativeSignals.length > 0 ? project.negativeSignals.join(', ') : '无'}
- 关键词: ${project.keywords.join(', ')}
- 相关实体: ${project.entities.length > 0 ? project.entities.join(', ') : '无'}
- 排除主题: ${project.exclude.length > 0 ? project.exclude.join(', ') : '无'}
- 匹配最低分: ${project.selection.minMatchRelevance}/10
- 筛选严格度: ${project.selection.preset}`).join('\n\n')}

项目匹配规则：
1. 一篇文章可以匹配 0 个、1 个或多个项目。
2. 必须逐个、独立评估每个项目，并返回所有达到对应项目“匹配最低分”的匹配；不能只返回最相关的一个项目。
3. projectId 必须来自上方项目 ID，不能编造。
4. 关键词重合本身不足以给高分，必须结合文章主题判断。
5. 配置了“必须同时满足的信号组”时，文章标题或描述必须对每一组都明确命中至少一个信号；辅助信号、关键词或实体不能代替任何缺失的组。
6. 未配置分组但配置了单组核心必要信号时，文章标题或描述必须明确支持至少一个核心必要信号。
7. 仅讨论 Agent 架构、能力或性能，却没有明确安全、隐私、授权、隔离或合规证据的文章，不得匹配 Agent 安全项目。
8. 出现负面信号或排除主题，且没有满足必要信号要求时，不得返回项目匹配。
9. 纯营销、融资或空泛观点内容不应获得高项目分。
10. 不要编造标题或描述没有支持的信息。
11. whyRelevant 必须用中文指出满足各必要信号组的具体证据，并说明它为何与项目相关。
12. recommendedAction 必须用中文给出具体下一步动作。
13. 具体动作可以包括：加入评测候选池、与当前架构对比、阅读技术文档、复现实验、增加安全检查、跟踪上游项目等。
14. 明确描述 multi-agent 系统的架构、构建、实现、编排、协作或生产部署时，应独立评估多 Agent 架构项目，即使同一文章也涉及安全或合规。
`;

  const projectJsonExample = projects.length === 0
    ? ''
    : `,
      "projectMatches": [
        {
          "projectId": "${projects[0]?.id || 'project-id'}",
          "projectRelevance": 8,
          "actionability": 7,
          "whyRelevant": "文章主题与该项目目标直接相关。",
          "recommendedAction": "加入后续技术评估清单，并对照当前方案检查可落地点。"
        }
      ]`;

  return `你是一个技术内容策展人，正在为一份面向技术爱好者的每日精选摘要筛选文章。

请对以下文章进行三个维度的评分（1-10 整数，10 分最高），并为每篇文章分配一个分类标签和提取 2-4 个关键词。

## 评分维度

### 1. 相关性 (relevance) - 对技术/编程/AI/互联网从业者的价值
- 10: 所有技术人都应该知道的重大事件/突破
- 7-9: 对大部分技术从业者有价值
- 4-6: 对特定技术领域有价值
- 1-3: 与技术行业关联不大

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

${projectContext}

## 待评分文章

${articlesList}

请严格按 JSON 格式返回，不要包含 markdown 代码块或其他文字。每个结果的 index 必须原样使用待评分文章中 Index 后的数字，不要按批次重新编号。${projects.length > 0 ? '如果文章没有匹配项目，请返回空数组 "projectMatches": []。' : ''}
{
  "results": [
    {
      "index": 0,
      "relevance": 8,
      "quality": 7,
      "timeliness": 9,
      "category": "engineering",
      "keywords": ["Rust", "compiler", "performance"]${projectJsonExample}
    }
  ]
}`;
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
      const prompt = buildScoringPrompt(batch, promptProjects);
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
        allScores.set(item.index, { relevance: 5, quality: 5, timeliness: 5, category: 'other', keywords: [], projectMatches: [] });
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

  const projectCandidates = indexed.flatMap(item => {
    const possibleProjectIds = projects
      .filter(project => articleMightMatchProject(articles[item.index]!, project))
      .map(project => project.id);
    return possibleProjectIds.length > 0 ? [{ ...item, possibleProjectIds }] : [];
  });
  const referencedProjectIds = new Set(projectCandidates.flatMap(item => item.possibleProjectIds));
  console.log(`[digest] Project scoring candidates: ${projectCandidates.length}/${articles.length}; relevant profiles=${referencedProjectIds.size}/${projects.length}`);
  if (projectCandidates.length === 0) return genericScores;

  const projectScores = await scoreArticlePass(
    projectCandidates,
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
  return { index, summary: { titleZh, summary, reason } };
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

function getBestProjectMatch(article: { breakdown: ArticleScore }): ProjectMatch | undefined {
  return article.breakdown.projectMatches[0];
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
  return undefined;
}

function getVerificationLabel(article: { title: string; description: string; sourceTier?: SourceTier }): string {
  const status = assessVerificationStatus(article);
  if (status === 'first-party') return '一手来源';
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

function getAdjustedProjectAwareScore(article: { title: string; description: string; sourceTier?: SourceTier; projectAwareScore: number }): number {
  return article.projectAwareScore + getGenericRankingAdjustment(article);
}

function compareGenericRank(
  a: { title: string; description: string; sourceTier?: SourceTier; genericScore: number; pubDate: Date },
  b: { title: string; description: string; sourceTier?: SourceTier; genericScore: number; pubDate: Date }
): number {
  return getAdjustedGenericScore(b) - getAdjustedGenericScore(a)
    || b.genericScore - a.genericScore
    || b.pubDate.getTime() - a.pubDate.getTime();
}

function compareProjectRank(
  a: { breakdown: ArticleScore; projectAwareScore: number; genericScore: number; pubDate: Date },
  b: { breakdown: ArticleScore; projectAwareScore: number; genericScore: number; pubDate: Date }
): number {
  const bestA = getBestProjectMatch(a);
  const bestB = getBestProjectMatch(b);
  return (bestB?.projectRelevance || 0) - (bestA?.projectRelevance || 0)
    || (bestB?.actionability || 0) - (bestA?.actionability || 0)
    || b.projectAwareScore - a.projectAwareScore
    || getAdjustedGenericScore(b) - getAdjustedGenericScore(a)
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
    || b.projectAwareScore - a.projectAwareScore
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
  const sameAction = EVENT_ACTION_GROUPS.some(group =>
    group.some(action => normalizedA.includes(` ${action} `))
    && group.some(action => normalizedB.includes(` ${action} `))
  );
  if (!sameAction) return false;

  const sharedDistinctiveTokens = [...titleA]
    .filter(token => titleB.has(token) && !EVENT_GENERIC_TOKENS.has(token));
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

function applySourceTopLimits<T extends RankableArticle>(articles: T[], topN: number): T[] {
  const selected: T[] = [];
  const deferred: T[] = [];
  const sourceCounts = new Map<string, number>();
  for (const article of articles) {
    const count = sourceCounts.get(article.sourceName) || 0;
    if (article.sourceMaxTopItems !== undefined && count >= article.sourceMaxTopItems) continue;
    if (article.sourceMaxTopItems === undefined
      && article.sourceTier === 'secondary'
      && count >= SECONDARY_SOURCE_TOP_LIMIT) {
      deferred.push(article);
      continue;
    }
    selected.push(article);
    sourceCounts.set(article.sourceName, count + 1);
    if (selected.length >= topN) break;
  }
  if (selected.length < topN) selected.push(...deferred.slice(0, topN - selected.length));
  return selected.length > 0 ? selected : articles.slice(0, Math.min(1, topN));
}

export function rankArticles<T extends RankableArticle>(
  articles: T[],
  topN: number,
  recentHistory: DigestHistoryEntry[] = []
): T[] {
  const uniqueArticles = deduplicateRankedEvents(articles);
  const sourceLimitedNames = new Set(uniqueArticles
    .filter(article => article.sourceMaxTopItems !== undefined || article.sourceTier === 'secondary')
    .map(article => article.sourceName)
    .filter(sourceName => {
      const sourceArticles = uniqueArticles.filter(article => article.sourceName === sourceName);
      const sourceLimit = sourceArticles[0]?.sourceMaxTopItems
        ?? (sourceArticles[0]?.sourceTier === 'secondary' ? SECONDARY_SOURCE_TOP_LIMIT : Infinity);
      return sourceArticles.length > sourceLimit;
    }));
  const matched = uniqueArticles.filter(article => article.breakdown.projectMatches.length > 0);
  let ordered: T[];

  if (matched.length >= 3) {
    const matchedFirst = [...matched].sort(compareProjectRank);
    const unmatched = uniqueArticles
      .filter(article => article.breakdown.projectMatches.length === 0)
      .sort(compareGenericRank);
    ordered = [...matchedFirst, ...unmatched];
  } else {
    ordered = [...uniqueArticles].sort((a, b) =>
      getAdjustedProjectAwareScore(b) - getAdjustedProjectAwareScore(a)
      || getAdjustedGenericScore(b) - getAdjustedGenericScore(a)
      || b.projectAwareScore - a.projectAwareScore
      || b.genericScore - a.genericScore
      || b.pubDate.getTime() - a.pubDate.getTime()
    );
  }

  const fresh = ordered.filter(article => !appearedInRecentDigest(article, recentHistory));
  const coolingDown = ordered.filter(article => appearedInRecentDigest(article, recentHistory));
  const firstPartyBoosted = uniqueArticles.filter(article => article.sourceTier === 'first-party').length;
  const lowInformationPenalized = uniqueArticles.filter(article => getLowInformationPenalty(article) > 0).length;
  const traceableSecondary = uniqueArticles.filter(article => assessVerificationStatus(article) === 'traceable-secondary').length;
  const unverified = uniqueArticles.filter(article => assessVerificationStatus(article) === 'unverified').length;
  console.log(
    `[digest] Top ranking controls: uniqueEvents=${uniqueArticles.length}/${articles.length}, `
    + `duplicates=${articles.length - uniqueArticles.length}, cooldownCandidates=${coolingDown.length}, `
    + `firstPartyBoosted=${firstPartyBoosted}, lowInformationPenalized=${lowInformationPenalized}, `
    + `traceableSecondary=${traceableSecondary}, unverified=${unverified}, `
    + `sourceCaps=${[...sourceLimitedNames].join(', ') || 'none'}`
  );
  const selected = applySourceTopLimits(fresh, topN);
  if (selected.length >= topN || coolingDown.length === 0) return selected;

  const selectedSet = new Set(selected);
  return applySourceTopLimits(
    [...selected, ...coolingDown.filter(article => !selectedSet.has(article))],
    topN
  );
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

async function loadRecentHistory(
  outputPath: string,
  extractor: (markdown: string) => DigestHistoryEntry[],
  historyLabel: string,
  now: Date
): Promise<DigestHistoryEntry[]> {
  const directory = dirname(outputPath);
  const cutoff = now.getTime() - DIGEST_COOLDOWN_HOURS * 60 * 60 * 1000;
  try {
    const files = await readdir(directory);
    const recentFiles = files.filter(name => {
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

export async function loadRecentDigestHistory(outputPath: string, now = new Date()): Promise<DigestHistoryEntry[]> {
  return loadRecentHistory(outputPath, extractTopDigestHistory, 'generic digest', now);
}

export async function loadRecentProjectDigestHistory(outputPath: string, now = new Date()): Promise<DigestHistoryEntry[]> {
  return loadRecentHistory(outputPath, extractProjectDigestHistory, 'project digest', now);
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
    .map(token => token === 'agents' ? 'agent' : token === 'models' ? 'model' : token === 'systems' ? 'system' : token)
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
  return getProjectSourcePreferenceScore(b.article, project) - getProjectSourcePreferenceScore(a.article, project)
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
      article.breakdown.quality >= project.selection.minArticleQuality
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
      .sort((a, b) =>
        b.match.projectRelevance - a.match.projectRelevance
        || b.match.actionability - a.match.actionability
        || getProjectSourcePreferenceScore(b.article, project) - getProjectSourcePreferenceScore(a.article, project)
        || b.article.projectAwareScore - a.article.projectAwareScore
        || getSourceAuthorityScore(b.article) - getSourceAuthorityScore(a.article)
        || b.article.genericScore - a.article.genericScore
        || b.article.pubDate.getTime() - a.article.pubDate.getTime()
      );
    const fresh = eventRepresentatives.filter(({ article }) => !appearedInRecentDigest(article, recentHistory));
    const coolingDown = eventRepresentatives.filter(({ article }) => appearedInRecentDigest(article, recentHistory));
    const selectedFresh = fresh.slice(0, project.selection.maxItems);
    const backfilled = coolingDown.slice(0, project.selection.maxItems - selectedFresh.length);
    const selected = [...selectedFresh, ...backfilled];
    const backfilledArticles = new Set(backfilled.map(({ article }) => article));

    console.log(
      `[digest] Project ${project.id} (${project.selection.preset}): matched=${modelMatches.length}, relevance>=${project.selection.minSectionRelevance}=${relevanceQualified.length}, quality>=${project.selection.minArticleQuality} and actionability>=${project.selection.minActionability}=${eligible.length}, uniqueEvents=${eventClusters.length}, duplicates=${eligible.length - eventClusters.length}, cooldownCandidates=${coolingDown.length}, backfilled=${backfilled.length}, selected=${selected.length}`
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

function renderProjectIntelligenceSection(articles: ScoredArticle[], projects: ProjectConfig[], topArticles: ScoredArticle[]): string {
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

  if (grouped.size === 0) return '';

  let section = `## 🎯 项目相关情报\n\n`;

  for (const project of projects) {
    const items = grouped.get(project.id);
    if (!items || items.length === 0) continue;

    items.sort((a, b) =>
      b.match.projectRelevance - a.match.projectRelevance
      || b.match.actionability - a.match.actionability
      || b.article.score - a.article.score
    );

    section += `### ${project.name}\n\n`;
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
      section += `- **项目相关性**：${match.projectRelevance}/10\n`;
      section += `- **可落地性**：${match.actionability}/10\n`;
      section += `- **为什么相关**：${match.whyRelevant || '模型未提供具体说明。'}\n`;
      section += `- **建议动作**：${match.recommendedAction || '加入后续人工评估清单。'}\n`;
      section += `- **来源**：${article.sourceName}${verificationLabel ? ` · ${verificationLabel}` : ''}\n\n`;
    }
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
}, clawfeedContent: string, trendingRepos: TrendingRepo[], designArticles: DesignArticle[], projects: ProjectConfig[], projectArticles: ScoredArticle[]): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const hasProjectIntelligence = projects.length > 0 && projectArticles.length > 0;
  const hasDesignIntelligence = designArticles.length > 0;

  let report = `# 📰 AI 资讯每日精选 — ${dateStr}\n\n`;
  report += `> 汇聚 ${stats.totalFeeds}+ 技术博客、X/Twitter、Hacker News、Reddit、Product Hunt、\n`;
  report += `> Lobste.rs、ClawFeed 日报及 GitHub Trending，经 AI 评分筛选。\n`;
  report += `>\n`;
  report += `> **本期内容**：🏆 今日必读 · 🌐 ClawFeed 日报 · 🔥 GitHub Trending · 📂 分类精选${hasDesignIntelligence ? ' · 🎨 设计与生成式 AI' : ''} · 📊 数据概览${hasProjectIntelligence ? ' · 🎯 项目相关情报' : ''}\n\n`;

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

  // ── Footer ──
  report += `*生成于 ${dateStr} ${now.toISOString().split('T')[1]?.slice(0, 5) || ''} | 汇聚 ${stats.totalFeeds} 个技术博客、X/Twitter、Hacker News、Reddit、Product Hunt、Lobste.rs、ClawFeed 日报及 GitHub Trending，经 AI 评分筛选出 Top ${articles.length} 精华内容*\n`;

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
  DEEPSEEK_THINKING_TASKS Comma-separated tasks: project-scoring,summary,highlights,design; all or none (default: project-scoring,highlights)
  DESIGN_SECTION_ENABLED Enable the legacy Design & Generative AI section and its AI request (default: false)
  RSSHUB_BASE_URL  RSSHub instance URL for X/Twitter feeds (default: https://rsshub.app)
  X_ACCOUNTS       Comma-separated X/Twitter accounts to follow (e.g. karpathy,sama,ylecun)
  PROJECTS_CONFIG_PATH Optional project profile JSON path (default: config/projects.json)
  SOURCES_CONFIG_PATH Optional additional RSS/Atom source JSON path (default: config/sources.json)

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

  const [projects, configuredSources] = await Promise.all([
    loadProjects(),
    loadConfiguredSources(),
  ]);

  const xFeeds = buildXFeeds();
  const allFeeds = mergeFeedSources(RSS_FEEDS, configuredSources, xFeeds);
  if (xFeeds.length > 0) {
    console.log(`[digest] X/Twitter accounts: ${xFeeds.map(f => f.name).join(', ')} (via ${RSSHUB_BASE_URL})`);
  }

  console.log(`[digest] Step 1/5: Fetching ${allFeeds.length} feeds + ClawFeed + GitHub Trending (parallel)...`);
  const [allArticles, clawfeedContent, trendingRepos] = await Promise.all([
    fetchAllFeeds(allFeeds),
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
  
  console.log(`[digest] Step 3/5: AI scoring ${recentArticles.length} articles...`);
  const scores = await scoreArticlesWithAI(recentArticles, aiClient, projects);
  
  const scoredArticles = recentArticles.map((article, index) => {
    const score = scores.get(index) || { relevance: 5, quality: 5, timeliness: 5, category: 'other' as CategoryId, keywords: [], projectMatches: [] };
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
  if (projects.length > 0) {
    console.log(`[digest] Project-matched articles: ${projectMatchedCount}/${scoredArticles.length}`);
  }

  const [recentDigestHistory, recentProjectDigestHistory] = await Promise.all([
    loadRecentDigestHistory(outputPath),
    loadRecentProjectDigestHistory(outputPath),
  ]);
  if (recentDigestHistory.length > 0) {
    console.log(`[digest] Recent digest cooldown: ${recentDigestHistory.length} Top N article(s) loaded from the last ${DIGEST_COOLDOWN_HOURS}h`);
  }
  if (recentProjectDigestHistory.length > 0) {
    console.log(`[digest] Recent project cooldown: ${recentProjectDigestHistory.length} project article(s) loaded from the last ${DIGEST_COOLDOWN_HOURS}h`);
  }
  const topArticles = rankArticles(scoredArticles, topN, recentDigestHistory);
  const projectCandidates = selectProjectIntelligenceCandidates(scoredArticles, projects, recentProjectDigestHistory);
  
  console.log(`[digest] Top ${topN} articles selected (score range: ${topArticles[topArticles.length - 1]?.projectAwareScore || 0} - ${topArticles[0]?.projectAwareScore || 0})`);
  
  console.log(`[digest] Step 4/5: Generating AI summaries...`);
  const summaryArticles = [...topArticles];
  const summaryArticleSet = new Set(summaryArticles);
  for (const { article } of projectCandidates) {
    if (summaryArticleSet.has(article)) continue;
    summaryArticleSet.add(article);
    summaryArticles.push(article);
  }
  const additionalProjectSummaries = summaryArticles.length - topArticles.length;
  console.log(`[digest] Project intelligence: ${projectCandidates.length} unique articles, ${additionalProjectSummaries} additional summaries outside Top ${topN}`);

  const summaryIndexByArticle = new Map(summaryArticles.map((article, index) => [article, index]));
  const indexedSummaryArticles = summaryArticles.map((article, index) => ({ ...article, index }));
  const summaries = await summarizeArticles(indexedSummaryArticles, aiClient, lang);

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

  const finalArticles = topArticles.map(article => toScoredArticle(article, article.breakdown.projectMatches));
  const projectIntelligenceArticles = projectCandidates.map(({ article, matches, cooldownProjectIds }) =>
    toScoredArticle(article, matches, cooldownProjectIds)
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
  }, clawfeedContent, trendingRepos, designArticles, projects, projectIntelligenceArticles);
  
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
