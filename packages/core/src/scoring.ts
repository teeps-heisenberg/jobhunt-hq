/**
 * Scoring engine (SPEC F3, principle 5). The engine supplies the number; the LLM supplies the
 * why and gap text. Hard blockers mean Skipped with a reason, never a low score.
 *
 * Factors are 0..1 and combined with `rules.scoring.weights` into a 0..5 score.
 */
import { normalizeLocation } from './dedupe.js';
import type { JobInput, JobStatus, Profile, Rules, ScoringWeights } from './schema.js';

export interface ScoreInput {
  job: Pick<
    JobInput,
    | 'company'
    | 'role'
    | 'location'
    | 'region'
    | 'remote'
    | 'visaNote'
    | 'postedAt'
    | 'minYears'
    | 'keyRequirements'
    | 'salaryText'
  >;
  profile: Profile;
  rules: Rules;
  /** Skills from data/master.json (names only). Used for the skills factor. */
  candidateSkills: readonly string[];
  /** ISO date for recency; defaults to today. */
  today?: string;
}

export type FactorName = keyof ScoringWeights;

export interface Factor {
  /** 0..1 */
  value: number;
  note: string;
}

export interface ScoreResult {
  /** 0..5, one decimal. 0 when skipped. */
  score: number;
  status: Extract<JobStatus, 'Skipped' | 'Shortlisted' | 'New'>;
  blockers: string[];
  factors: Record<FactorName, Factor>;
  /** Engine's view of the visa situation; the LLM may refine it. */
  visaNote: string;
  needsSponsorship: boolean;
}

// ---------------------------------------------------------------------------
// Geography helpers
// ---------------------------------------------------------------------------

const EU_COUNTRIES = [
  'austria',
  'belgium',
  'bulgaria',
  'croatia',
  'cyprus',
  'czechia',
  'czech republic',
  'denmark',
  'estonia',
  'finland',
  'france',
  'germany',
  'greece',
  'hungary',
  'ireland',
  'italy',
  'latvia',
  'lithuania',
  'luxembourg',
  'malta',
  'netherlands',
  'poland',
  'portugal',
  'romania',
  'slovakia',
  'slovenia',
  'spain',
  'sweden',
];

const BLOCS: Record<string, { aliases: string[]; members: string[] }> = {
  eu: { aliases: ['eu', 'europe', 'european union', 'eea'], members: EU_COUNTRIES },
  uk: { aliases: ['uk', 'united kingdom', 'england', 'scotland', 'wales', 'britain'], members: [] },
  us: { aliases: ['us', 'usa', 'united states', 'america'], members: [] },
};

const CITY_COUNTRY: Record<string, string> = {
  lisbon: 'portugal',
  porto: 'portugal',
  london: 'uk',
  manchester: 'uk',
  edinburgh: 'uk',
  dublin: 'ireland',
  amsterdam: 'netherlands',
  berlin: 'germany',
  munich: 'germany',
  hamburg: 'germany',
  paris: 'france',
  madrid: 'spain',
  barcelona: 'spain',
  milan: 'italy',
  stockholm: 'sweden',
  copenhagen: 'denmark',
  helsinki: 'finland',
  warsaw: 'poland',
  prague: 'czechia',
  vienna: 'austria',
  brussels: 'belgium',
  zurich: 'switzerland',
  toronto: 'canada',
  vancouver: 'canada',
  'new york': 'us',
  'san francisco': 'us',
  seattle: 'us',
  austin: 'us',
  dubai: 'uae',
  singapore: 'singapore',
  sydney: 'australia',
  bangalore: 'india',
  bengaluru: 'india',
  hyderabad: 'india',
};

const REMOTE_ANYWHERE = new Set(['remote', 'anywhere', 'worldwide', 'global']);

function tokensOf(s: string): string[] {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** True when every word of `phrase` appears in `text` as a whole word sequence. */
function mentions(text: string, phrase: string): boolean {
  const t = ` ${tokensOf(text).join(' ')} `;
  const p = tokensOf(phrase).join(' ');
  return p.length > 0 && t.includes(` ${p} `);
}

/** Place names a location implies: its own tokens, the city's country, and the blocs it is in. */
function placesOf(location: string): Set<string> {
  const places = new Set<string>();
  const normalized = normalizeLocation(location);
  const text = ` ${normalized} `;
  for (const [city, country] of Object.entries(CITY_COUNTRY)) {
    if (text.includes(` ${city} `)) places.add(country);
  }
  for (const token of normalized.split(' ')) places.add(token);
  for (const [bloc, def] of Object.entries(BLOCS)) {
    if (def.aliases.some((a) => mentions(normalized, a))) places.add(bloc);
    if (def.members.some((m) => mentions(normalized, m) || places.has(m))) places.add(bloc);
  }
  return places;
}

/** `Portugal` -> {portugal, eu}; `EU` -> {eu}. */
function expandRegion(name: string): Set<string> {
  const out = new Set<string>();
  const n = tokensOf(name).join(' ');
  out.add(n);
  for (const [bloc, def] of Object.entries(BLOCS)) {
    if (def.aliases.includes(n)) out.add(bloc);
    if (def.members.includes(n)) out.add(bloc);
  }
  return out;
}

function intersects(a: Set<string>, b: Iterable<string>): boolean {
  for (const x of b) if (a.has(x)) return true;
  return false;
}

export type LocationFit = 'remote' | 'relocate' | 'excluded' | 'unknown';

export interface LocationAssessment {
  fit: LocationFit;
  needsSponsorship: boolean;
  note: string;
}

export function assessLocation(
  job: Pick<JobInput, 'location' | 'region' | 'remote'>,
  profile: Profile,
  rules: Rules,
): LocationAssessment {
  const text = [job.location, job.region ?? ''].join(' ');
  const places = placesOf(text);
  const isAnywhere = [...places].some((p) => REMOTE_ANYWHERE.has(p)) && places.size <= 2;

  const matchesAny = (list: string[]) =>
    list.some((entry) => intersects(places, expandRegion(entry)) || mentions(text, entry));

  if (matchesAny(rules.locations.exclude)) {
    return {
      fit: 'excluded',
      needsSponsorship: false,
      note: `location excluded by rules: ${job.location}`,
    };
  }

  const citizenPlaces = new Set(profile.citizenship.flatMap((c) => [...expandRegion(c)]));
  const noSponsorshipBlocs = new Set(
    rules.visa.needsSponsorshipOutside.flatMap((b) => [...expandRegion(b)]),
  );
  const canWorkThere = intersects(places, citizenPlaces) || intersects(places, noSponsorshipBlocs);

  if (job.remote && (isAnywhere || matchesAny(rules.locations.remoteFrom))) {
    return { fit: 'remote', needsSponsorship: false, note: 'remote from an allowed location' };
  }

  if (matchesAny(rules.locations.relocate)) {
    return {
      fit: 'relocate',
      needsSponsorship: !canWorkThere,
      note: canWorkThere
        ? `relocation hub, no sponsorship needed: ${job.location}`
        : `relocation hub, needs visa sponsorship: ${job.location}`,
    };
  }

  if (job.remote) {
    return {
      fit: 'unknown',
      needsSponsorship: false,
      note: `remote, but restricted to ${job.location} which is not in rules.locations.remoteFrom`,
    };
  }

  return {
    fit: 'unknown',
    needsSponsorship: !canWorkThere,
    note: `on-site in ${job.location}, not in rules.locations.relocate`,
  };
}

// ---------------------------------------------------------------------------
// Hard blockers
// ---------------------------------------------------------------------------

const CLEARANCE_PATTERNS = [
  'security clearance',
  'clearance required',
  'active clearance',
  'top secret',
  'ts/sci',
  'secret clearance',
];

const CITIZENSHIP_PATTERNS = [
  'citizenship required',
  'citizens only',
  'us citizen',
  'citizen of',
  'must be a citizen',
  'must be citizen',
  'national of',
  'nationals only',
  'permanent resident',
  'green card',
  'no sponsorship',
  'not able to sponsor',
  'unable to sponsor',
  'cannot sponsor',
  'without sponsorship',
  'authorized to work in',
  'authorised to work in',
  'right to work in',
];

const FLUENCY_WORDS = [
  'fluent',
  'fluency',
  'native',
  'proficient',
  'proficiency',
  'business level',
  'c1',
  'c2',
  'required',
  'mandatory',
  'must',
];

const STRONG_LEVELS = new Set(['professional', 'fluent', 'native']);

function requirementTexts(job: ScoreInput['job']): string[] {
  return [...job.keyRequirements, job.visaNote].filter((t) => t.trim().length > 0);
}

/** Returns one reason per blocker found, or an empty list. */
export function findBlockers(input: ScoreInput): string[] {
  const { job, profile, rules } = input;
  const blockers: string[] = [];
  const texts = requirementTexts(job);
  const citizenPlaces = new Set(profile.citizenship.flatMap((c) => [...expandRegion(c)]));
  const location = assessLocation(job, profile, rules);

  // Years bar.
  if (job.minYears !== undefined && job.minYears > rules.experience.maxYearsBar) {
    blockers.push(
      `asks for ${job.minYears}+ years, rules.experience.maxYearsBar is ${rules.experience.maxYearsBar}`,
    );
  }

  // Location excluded.
  if (location.fit === 'excluded') blockers.push(location.note);

  for (const text of texts) {
    // Clearance.
    if (CLEARANCE_PATTERNS.some((p) => mentions(text, p))) {
      blockers.push(`security clearance: "${text}"`);
      continue;
    }

    // Citizenship / work authorisation, unless the text names a place the user can work in.
    const skipPhrases = [...rules.visa.skipIf, ...CITIZENSHIP_PATTERNS];
    if (skipPhrases.some((p) => mentions(text, p))) {
      const places = placesOf(text);
      const covered = intersects(places, citizenPlaces);
      const remoteOk = location.fit === 'remote' && !location.needsSponsorship && covered;
      if (!covered || (!remoteOk && location.needsSponsorship)) {
        blockers.push(`citizenship or work authorisation: "${text}"`);
        continue;
      }
    }

    // Language fluency the user lacks.
    for (const lang of rules.hardBlockers.languagesRequired) {
      if (!mentions(text, lang)) continue;
      if (!FLUENCY_WORDS.some((w) => mentions(text, w))) continue;
      const level = profile.languages.find(
        (l) => l.name.toLowerCase() === lang.toLowerCase(),
      )?.level;
      if (!level || !STRONG_LEVELS.has(level)) {
        blockers.push(`requires ${lang}: "${text}"`);
      }
    }
  }

  return [...new Set(blockers)];
}

// ---------------------------------------------------------------------------
// Factors
// ---------------------------------------------------------------------------

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function skillsFactor(requirements: string[], skills: readonly string[]): Factor {
  if (requirements.length === 0) return { value: 0.5, note: 'no key requirements listed' };
  const skillTokens = skills.map((s) => tokensOf(s).join(' ')).filter(Boolean);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const req of requirements) {
    const r = ` ${tokensOf(req).join(' ')} `;
    const hit = skillTokens.some((s) => r.includes(` ${s} `));
    (hit ? matched : missing).push(req);
  }
  const value = matched.length / requirements.length;
  const note =
    missing.length === 0
      ? `all ${requirements.length} requirements matched`
      : `${matched.length}/${requirements.length} matched; missing: ${missing.join(', ')}`;
  return { value, note };
}

function yearsFactor(minYears: number | undefined, have: number, bar: number): Factor {
  if (minYears === undefined) return { value: 0.7, note: 'no years requirement stated' };
  if (minYears <= have) return { value: 1, note: `asks ${minYears}, you have ${have}` };
  const gap = minYears - have;
  const value = clamp01(1 - gap / Math.max(1, bar));
  return { value, note: `asks ${minYears}, you have ${have} (${gap} short)` };
}

function locationFactor(a: LocationAssessment): Factor {
  switch (a.fit) {
    case 'remote':
      return { value: 1, note: a.note };
    case 'relocate':
      return { value: a.needsSponsorship ? 0.6 : 0.85, note: a.note };
    case 'excluded':
      return { value: 0, note: a.note };
    default:
      return { value: 0.3, note: a.note };
  }
}

function recencyFactor(postedAt: string | undefined, today: string, window: number): Factor {
  if (!postedAt) return { value: 0.5, note: 'posting date unknown' };
  const days = Math.round((Date.parse(today) - Date.parse(postedAt)) / 86_400_000);
  if (Number.isNaN(days)) return { value: 0.5, note: 'posting date unreadable' };
  if (days <= 7) return { value: 1, note: `posted ${Math.max(days, 0)} days ago` };
  if (days <= window) {
    const value = 1 - (0.6 * (days - 7)) / Math.max(1, window - 7);
    return { value, note: `posted ${days} days ago` };
  }
  return { value: 0.1, note: `posted ${days} days ago, older than rules.recencyDays (${window})` };
}

interface Money {
  currency: string;
  /** Yearly amount. */
  min: number;
  max: number;
}

const CURRENCIES: Record<string, string> = {
  usd: 'USD',
  $: 'USD',
  us$: 'USD',
  eur: 'EUR',
  '€': 'EUR',
  gbp: 'GBP',
  '£': 'GBP',
  chf: 'CHF',
  cad: 'CAD',
  aud: 'AUD',
  inr: 'INR',
  '₹': 'INR',
};

/** Parses `EUR 50-60K`, `$120,000 - $150,000 per year`, `USD 2,500-3,500/month`. */
export function parseMoney(text: string | undefined): Money | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  const currencyKey = Object.keys(CURRENCIES).find((k) => lower.includes(k));
  if (!currencyKey) return undefined;
  const currency = CURRENCIES[currencyKey]!;
  const monthly = /month|\/m\b|pcm|p\.m\./.test(lower);
  const hourly = /hour|\/h\b|p\.h\./.test(lower);

  const found = [...lower.matchAll(/(\d[\d,.]*)\s*(k)?/g)]
    .map((m) => ({ n: Number.parseFloat(m[1]!.replace(/,/g, '')), k: Boolean(m[2]) }))
    .filter((x) => Number.isFinite(x.n));
  if (found.length === 0) return undefined;
  // "50-60K" puts the K only on the last number: apply it to every small number in the range.
  const anyK = found.some((x) => x.k);
  const scaled = found
    .map((x) => (x.k || (anyK && x.n < 1000) ? x.n * 1000 : x.n))
    .filter((n) => n >= 100);
  if (scaled.length === 0) return undefined;
  const factor = monthly ? 12 : hourly ? 2080 : 1;
  const nums = scaled.map((n) => n * factor);
  return { currency, min: Math.min(...nums), max: Math.max(...nums) };
}

/** The rules.salary entry for this job: `remote` for remote roles, else any place the location implies. */
function salaryBand(
  a: LocationAssessment,
  job: ScoreInput['job'],
  rules: Rules,
): [string, string] | undefined {
  const keys = a.fit === 'remote' ? new Set(['remote']) : placesOf(job.location);
  return Object.entries(rules.salary).find(([k]) => keys.has(k.toLowerCase()));
}

function salaryFactor(job: ScoreInput['job'], rules: Rules, a: LocationAssessment): Factor {
  const offered = parseMoney(job.salaryText);
  if (!offered) return { value: 0.6, note: 'no salary stated' };

  const entry = salaryBand(a, job, rules);
  const band = parseMoney(entry?.[1]);
  if (!band) {
    return {
      value: 0.7,
      note: `salary stated (${job.salaryText}), no matching band in rules.salary`,
    };
  }
  if (band.currency !== offered.currency) {
    return { value: 0.6, note: `salary in ${offered.currency}, your band is in ${band.currency}` };
  }
  if (offered.max >= band.min) {
    const value = offered.min >= band.min ? 1 : 0.85;
    return {
      value,
      note: `offers up to ${offered.max} vs your minimum ${band.min} ${band.currency}`,
    };
  }
  if (offered.max >= band.min * 0.8)
    return { value: 0.5, note: `slightly under your band (${job.salaryText})` };
  return { value: 0.15, note: `well under your band (${job.salaryText})` };
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

export function computeFactors(input: ScoreInput): Record<FactorName, Factor> {
  const { job, profile, rules } = input;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const location = assessLocation(job, profile, rules);
  return {
    skills: skillsFactor(job.keyRequirements, input.candidateSkills),
    years: yearsFactor(job.minYears, profile.yearsExperience, rules.experience.maxYearsBar),
    location: locationFactor(location),
    recency: recencyFactor(job.postedAt, today, rules.recencyDays),
    salary: salaryFactor(job, rules, location),
  };
}

export function scoreJob(input: ScoreInput): ScoreResult {
  const { job, profile, rules } = input;
  const location = assessLocation(job, profile, rules);
  const visaNote = job.visaNote.trim() || location.note;
  const blockers = findBlockers(input);
  const factors = computeFactors(input);

  if (blockers.length > 0) {
    return {
      score: 0,
      status: 'Skipped',
      blockers,
      factors,
      visaNote,
      needsSponsorship: location.needsSponsorship,
    };
  }

  const w = rules.scoring.weights;
  const weighted = (Object.keys(w) as FactorName[]).reduce(
    (sum, k) => sum + w[k] * factors[k].value,
    0,
  );
  const score = Math.round(clamp01(weighted) * 50) / 10;
  const status = score >= rules.scoring.shortlistAt ? 'Shortlisted' : 'New';
  return {
    score,
    status,
    blockers,
    factors,
    visaNote,
    needsSponsorship: location.needsSponsorship,
  };
}
