/**
 * Dedupe: decides whether a scouted posting is already tracked.
 *
 * Order of evidence, strongest first:
 *   1. same ATS job id (Greenhouse, Lever, Ashby, Workable, Workday, SmartRecruiters)
 *   2. same normalised URL
 *   3. same normalised company + title + location (exact after normalisation)
 *   4. same company + location and a fuzzy title match (reposts with small wording changes)
 *
 * Same company + same title in a different location is a regional variant: it is kept
 * (you may want to apply to one region only) but reported so the user can decide.
 */

export interface JobKey {
  id: string;
  company: string;
  role: string;
  location: string;
  url: string;
}

export interface Candidate {
  company: string;
  role: string;
  location: string;
  url: string;
  applyUrl?: string | undefined;
}

export type MatchReason = 'ats-id' | 'url' | 'exact' | 'fuzzy-title';

export interface DuplicateMatch {
  existingId: string;
  reason: MatchReason;
  /** Title similarity 0..1 (1 for id and URL matches). */
  similarity: number;
}

export interface RegionalVariant {
  existingId: string;
  existingLocation: string;
}

export interface DedupeOptions {
  /** Minimum title similarity for a fuzzy match. Default 0.85. */
  fuzzyThreshold?: number;
}

const DEFAULT_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const LEGAL_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'ltd',
  'limited',
  'llc',
  'llp',
  'plc',
  'gmbh',
  'ag',
  'se',
  'sa',
  'sas',
  'srl',
  'bv',
  'nv',
  'oy',
  'ab',
  'as',
  'pty',
  'co',
  'corp',
  'corporation',
  'company',
  'group',
  'holdings',
  'technologies',
  'technology',
  'labs',
]);

function stripDiacritics(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

function words(s: string): string[] {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** `Acme, Inc.` -> `acme`; `Globex GmbH` -> `globex`; `Initech Technologies Ltd` -> `initech`. */
export function normalizeCompany(name: string): string {
  const tokens = words(name.replace(/\(.*?\)/g, ' '));
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join(' ');
}

const TITLE_NOISE = [
  /\((?:[^()]*)\)/g, // (Remote), (m/f/d), (Job ID 123)
  /\[(?:[^[\]]*)\]/g, // [Remote]
  /\b[mfwdx]\s*\/\s*[mfwdx](?:\s*\/\s*[mfwdx])?\b/gi, // m/f/d, f/m/x, w/m/d
  /\b(?:job\s*)?(?:req(?:uisition)?|ref(?:erence)?|id|number|no)\s*[:#.-]?\s*[a-z]*-?\d[\w-]*/gi, // Job ID 123, REQ-456
  /#\s*\d+/g, // #12345
  /\b(?:jr|r|req)[-_]?\d{3,}\b/gi, // JR123456, R-1234
  /\b\d{4,}\b/g, // bare long numbers
];

const TITLE_REGIONS = new Set([
  'remote',
  'hybrid',
  'onsite',
  'emea',
  'apac',
  'amer',
  'americas',
  'latam',
  'europe',
  'eu',
  'uk',
  'us',
  'usa',
  'global',
  'worldwide',
]);

const TITLE_SYNONYMS: Record<string, string> = {
  sr: 'senior',
  jr: 'junior',
  eng: 'engineer',
  engineers: 'engineer',
  developer: 'engineer',
  developers: 'engineer',
  dev: 'engineer',
  programmer: 'engineer',
  swe: 'software engineer',
  fullstack: 'full stack',
  'full-stack': 'full stack',
  frontend: 'front end',
  backend: 'back end',
  ml: 'machine learning',
  ai: 'ai',
};

/**
 * `Sr. Backend Developer (Remote) - EMEA, Job ID 12345` -> `senior back end engineer`.
 * Seniority words are kept: Senior and Junior are different roles.
 */
export function normalizeTitle(title: string): string {
  let s = title;
  for (const re of TITLE_NOISE) s = s.replace(re, ' ');
  // Drop trailing segments after a dash/pipe/colon when they are only region or noise words.
  const segments = s.split(/\s+[-|–—:]\s+|\s*\|\s*/);
  const kept = segments.filter((seg, i) => {
    if (i === 0) return true;
    const w = words(seg);
    return w.length > 0 && !w.every((t) => TITLE_REGIONS.has(t));
  });
  const tokens = words(kept.join(' '))
    .flatMap((t) => (TITLE_SYNONYMS[t] ?? t).split(' '))
    .filter((t) => !TITLE_REGIONS.has(t));
  return tokens.join(' ');
}

const LOCATION_NOISE = new Set([
  'remote',
  'hybrid',
  'onsite',
  'on',
  'site',
  'office',
  'based',
  'in',
  'from',
  'or',
  'and',
  'area',
  'greater',
  'metro',
  'region',
  'anywhere',
]);

/** `Lisbon, Portugal (Remote)` -> `lisbon portugal`; `Remote - EU` -> `eu`; `Remote` -> `remote`. */
export function normalizeLocation(location: string): string {
  const tokens = words(location.replace(/\(.*?\)/g, ' ')).filter((t) => !LOCATION_NOISE.has(t));
  return tokens.length ? tokens.join(' ') : 'remote';
}

/** Two locations are the same place when one's token set contains the other's. */
export function sameLocation(a: string, b: string): boolean {
  const ta = new Set(normalizeLocation(a).split(' '));
  const tb = new Set(normalizeLocation(b).split(' '));
  if (ta.size === 0 || tb.size === 0) return false;
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!large.has(t)) return false;
  return true;
}

const TRACKING_PARAMS = /^(utm_|gh_src$|lever-|source$|src$|ref$|referrer$|fbclid$|gclid$)/i;

/** Lowercases host, drops www, tracking params, fragments and trailing slashes. */
export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return input.trim().toLowerCase();
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  const params = [...url.searchParams.keys()];
  for (const key of params) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/(?:apply|application)$/i, '');
  const query = url.searchParams.toString();
  return `${url.protocol}//${url.host}${path}${query ? `?${query}` : ''}`.toLowerCase();
}

export interface AtsRef {
  ats: 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'workday' | 'smartrecruiters';
  /** Board or tenant slug when the URL carries one. */
  board?: string | undefined;
  id: string;
}

/** Pulls the ATS and job id out of a URL, or undefined for careers pages we do not know. */
export function extractAtsRef(input: string): AtsRef | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  const lower = (s: string | undefined) => s?.toLowerCase();

  // Greenhouse: boards.greenhouse.io/<board>/jobs/<id>, job-boards.greenhouse.io/<board>/jobs/<id>,
  // or an embedded board anywhere with ?gh_jid=<id>.
  const ghJid = url.searchParams.get('gh_jid');
  if (ghJid) return { ats: 'greenhouse', id: ghJid };
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const i = parts.indexOf('jobs');
    if (i >= 0 && parts[i + 1]) {
      return { ats: 'greenhouse', board: lower(parts[i - 1]), id: parts[i + 1]! };
    }
  }

  // Lever: jobs.lever.co/<board>/<uuid>[/apply]
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    if (parts[0] && parts[1]) return { ats: 'lever', board: lower(parts[0]), id: parts[1] };
  }

  // Ashby: jobs.ashbyhq.com/<board>/<uuid>[/application]
  if (host === 'jobs.ashbyhq.com') {
    if (parts[0] && parts[1]) return { ats: 'ashby', board: lower(parts[0]), id: parts[1] };
  }

  // Workable: apply.workable.com/<board>/j/<ID>[/apply], or <board>.workable.com/j/<ID>
  if (host === 'apply.workable.com' || host.endsWith('.workable.com')) {
    const i = parts.indexOf('j');
    if (i >= 0 && parts[i + 1]) {
      const board = host === 'apply.workable.com' ? lower(parts[i - 1]) : host.split('.')[0];
      return { ats: 'workable', board, id: parts[i + 1]!.toUpperCase() };
    }
  }

  // Workday: <tenant>.wd<n>.myworkdayjobs.com/<lang>/<site>/job/<location>/<title>_<REQ-ID>
  if (host.endsWith('.myworkdayjobs.com')) {
    const last = parts[parts.length - 1] ?? '';
    const m = /_([A-Za-z]*-?\d[\w.-]*)$/.exec(decodeURIComponent(last));
    if (m) return { ats: 'workday', board: host.split('.')[0], id: m[1]!.toUpperCase() };
  }

  // SmartRecruiters: jobs.smartrecruiters.com/<company>/<id>-<slug>
  if (host === 'jobs.smartrecruiters.com') {
    const m = /^(\d{6,})/.exec(parts[1] ?? '');
    if (parts[0] && m) return { ats: 'smartrecruiters', board: lower(parts[0]), id: m[1]! };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

function diceTokens(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const sa = new Set(a);
  const sb = new Set(b);
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared++;
  return (2 * shared) / (sa.size + sb.size);
}

const SENIORITY = new Set([
  'intern',
  'graduate',
  'junior',
  'associate',
  'mid',
  'senior',
  'staff',
  'principal',
  'lead',
  'head',
  'director',
  'vp',
  'i',
  'ii',
  'iii',
  'iv',
]);

/** Seniority words in a title, e.g. `senior` or `staff`, so levels are never merged. */
export function seniorityOf(title: string): string {
  return normalizeTitle(title)
    .split(' ')
    .filter((t) => SENIORITY.has(t))
    .sort()
    .join(' ');
}

/** 0..1 similarity of two titles after normalisation. Different seniority levels score 0. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  if (seniorityOf(a) !== seniorityOf(b)) return 0;
  const ratio = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length, 1);
  const dice = diceTokens(na.split(' '), nb.split(' '));
  return Math.max(ratio, dice);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function atsKey(ref: AtsRef | undefined): string | undefined {
  return ref ? `${ref.ats}:${ref.id.toLowerCase()}` : undefined;
}

function candidateUrls(c: Candidate): string[] {
  return [c.url, c.applyUrl].filter((u): u is string => Boolean(u));
}

/** Finds the tracked job a candidate duplicates, if any. */
export function findDuplicate(
  candidate: Candidate,
  existing: readonly JobKey[],
  options: DedupeOptions = {},
): DuplicateMatch | undefined {
  const threshold = options.fuzzyThreshold ?? DEFAULT_THRESHOLD;
  const candAts = new Set(
    candidateUrls(candidate)
      .map((u) => atsKey(extractAtsRef(u)))
      .filter((k): k is string => Boolean(k)),
  );
  const candUrls = new Set(candidateUrls(candidate).map(normalizeUrl));
  const company = normalizeCompany(candidate.company);
  const title = normalizeTitle(candidate.role);

  let best: DuplicateMatch | undefined;
  for (const job of existing) {
    const jobAts = atsKey(extractAtsRef(job.url));
    if (jobAts && candAts.has(jobAts))
      return { existingId: job.id, reason: 'ats-id', similarity: 1 };
    if (candUrls.has(normalizeUrl(job.url)))
      return { existingId: job.id, reason: 'url', similarity: 1 };

    if (normalizeCompany(job.company) !== company) continue;
    if (!sameLocation(job.location, candidate.location)) continue;

    if (normalizeTitle(job.role) === title) {
      best = { existingId: job.id, reason: 'exact', similarity: 1 };
      continue;
    }
    const similarity = titleSimilarity(job.role, candidate.role);
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = { existingId: job.id, reason: 'fuzzy-title', similarity };
    }
  }
  return best;
}

/** Same company and title elsewhere: not a duplicate, but worth telling the user. */
export function findRegionalVariants(
  candidate: Candidate,
  existing: readonly JobKey[],
): RegionalVariant[] {
  const company = normalizeCompany(candidate.company);
  const title = normalizeTitle(candidate.role);
  return existing
    .filter(
      (job) =>
        normalizeCompany(job.company) === company &&
        normalizeTitle(job.role) === title &&
        !sameLocation(job.location, candidate.location),
    )
    .map((job) => ({ existingId: job.id, existingLocation: job.location }));
}

export interface DedupeResult<T extends Candidate> {
  unique: T[];
  duplicates: Array<{ candidate: T; match: DuplicateMatch }>;
  variants: Array<{ candidate: T; variants: RegionalVariant[] }>;
}

/**
 * Splits a batch into new rows and duplicates, checking against the tracker and against
 * earlier rows of the same batch. Batch rows get provisional ids `batch:<index>`.
 */
export function dedupeJobs<T extends Candidate>(
  candidates: readonly T[],
  existing: readonly JobKey[],
  options: DedupeOptions = {},
): DedupeResult<T> {
  const result: DedupeResult<T> = { unique: [], duplicates: [], variants: [] };
  const seen: JobKey[] = [...existing];

  candidates.forEach((candidate, index) => {
    const match = findDuplicate(candidate, seen, options);
    if (match) {
      result.duplicates.push({ candidate, match });
      return;
    }
    const variants = findRegionalVariants(candidate, seen);
    if (variants.length) result.variants.push({ candidate, variants });
    result.unique.push(candidate);
    seen.push({
      id: `batch:${index}`,
      company: candidate.company,
      role: candidate.role,
      location: candidate.location,
      url: candidate.url,
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

export function slugify(s: string, max = 60): string {
  return words(s).join('-').slice(0, max).replace(/-+$/, '');
}

/**
 * `acme-backend-engineer-lisbon`; appends `-2`, `-3`, ... when the slug is taken.
 * Location contributes its first token only (the city), so the id stays short.
 */
export function makeJobId(
  candidate: Pick<Candidate, 'company' | 'role' | 'location'>,
  taken: Iterable<string> = [],
): string {
  const city = normalizeLocation(candidate.location).split(' ')[0] ?? 'remote';
  const base =
    [
      slugify(normalizeCompany(candidate.company), 30),
      slugify(normalizeTitle(candidate.role), 50),
      slugify(city, 20),
    ]
      .filter(Boolean)
      .join('-') || 'job';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!used.has(id)) return id;
  }
}
