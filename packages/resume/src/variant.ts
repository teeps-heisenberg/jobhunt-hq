/**
 * buildVariant(master, spec): a tailored CV that only reorders, selects and re-words what the
 * master contains. Every piece of text the spec introduces is returned in `newClaims` so the
 * tailor skill can put it under "Verify before sending".
 */
import { Master, Resume, VariantSpec } from './schema.js';

export interface NewClaim {
  /** Where the text appears: `title`, `summary`, `skills.<group>`, `experience.<company>`, ... */
  where: string;
  text: string;
}

export interface Variant {
  resume: Resume;
  newClaims: NewClaim[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Puts items named in `order` first (by exact or prefix match on `key`), then the rest. */
function reorder<T>(items: T[], order: string[], key: (item: T) => string): T[] {
  const remaining = [...items];
  const picked: T[] = [];
  for (const wanted of order) {
    const w = norm(wanted);
    const i = remaining.findIndex((it) => norm(key(it)) === w || norm(key(it)).startsWith(w));
    if (i >= 0) picked.push(...remaining.splice(i, 1));
  }
  return [...picked, ...remaining];
}

function matchesAny(value: string, names: string[]): boolean {
  const v = norm(value);
  return names.some((n) => v === norm(n) || v.startsWith(norm(n)));
}

export function buildVariant(masterInput: unknown, specInput: unknown = {}): Variant {
  const master = Master.parse(masterInput);
  const spec = VariantSpec.parse(specInput);
  const newClaims: NewClaim[] = [];
  const masterText = new Set<string>();
  const collect = (s: string) => masterText.add(norm(s));
  collect(master.title);
  collect(master.summary);
  Object.values(master.summaries).forEach(collect);
  master.skills.forEach(([, v]) => collect(v));
  master.experience.forEach((e) => e.bullets.forEach(collect));
  master.certifications.forEach(collect);
  master.additional.forEach(collect);
  const isNew = (s: string) => !masterText.has(norm(s));

  // Title and summary.
  const title = spec.title ?? master.title;
  if (spec.title && isNew(spec.title)) newClaims.push({ where: 'title', text: spec.title });

  let summary = master.summary;
  if (spec.summary) {
    const keyed = master.summaries[spec.summary];
    summary = keyed ?? spec.summary;
    if (!keyed && isNew(spec.summary)) newClaims.push({ where: 'summary', text: spec.summary });
  }

  // Skills: drop, override, reorder.
  const skills = reorder(
    master.skills.filter(([group]) => !matchesAny(group, spec.skills.drop)),
    spec.skills.order,
    ([group]) => group,
  ).map(([group, text]): [string, string] => {
    const override = Object.entries(spec.skills.overrides).find(
      ([g]) => norm(g) === norm(group),
    )?.[1];
    if (override === undefined) return [group, text];
    // Each skill in the override must exist somewhere in the master skills.
    const known = new Set(master.skills.flatMap(([, v]) => v.split(/[,;]/).map(norm)));
    for (const item of override
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (!known.has(norm(item))) newClaims.push({ where: `skills.${group}`, text: item });
    }
    return [group, override];
  });

  // Projects: drop, reorder, cap.
  let projects = reorder(
    master.projects.filter((p) => !matchesAny(p.name, spec.projects.drop)),
    spec.projects.order,
    (p) => p.name,
  );
  if (spec.projects.max !== undefined) projects = projects.slice(0, spec.projects.max);

  // Experience: bullets per position.
  const experience = master.experience.map((position) => {
    const override = spec.experience.find(
      (e) =>
        norm(e.company) === norm(position.company) &&
        (e.role === undefined || norm(e.role) === norm(position.role)),
    );
    if (!override) return position;
    for (const b of override.bullets) {
      if (isNew(b)) newClaims.push({ where: `experience.${position.company}`, text: b });
    }
    return { ...position, bullets: override.bullets };
  });

  const certifications = spec.certifications ?? master.certifications;
  for (const c of certifications)
    if (isNew(c)) newClaims.push({ where: 'certifications', text: c });
  const additional = spec.additional ?? master.additional;
  for (const a of additional) if (isNew(a)) newClaims.push({ where: 'additional', text: a });

  const resume = Resume.parse({
    name: master.name,
    title,
    contact: master.contact,
    summary,
    skills,
    experience,
    projects,
    education: master.education,
    certifications,
    additional,
  });
  return { resume, newClaims };
}

/** Plain text of a resume, one line per paragraph, for linting and claim checking. */
export function resumeToText(resume: Resume): string {
  const lines: string[] = [resume.name, resume.title, ...resume.contact, resume.summary];
  for (const [group, text] of resume.skills) lines.push(`${group}: ${text}`);
  for (const e of resume.experience) {
    lines.push(`${e.role} | ${e.company} | ${e.dates}`, e.location, ...e.bullets);
  }
  for (const p of resume.projects) lines.push(`${p.name}: ${p.desc} (${p.tech})`);
  for (const [deg, uni, note, year] of resume.education)
    lines.push(`${deg} | ${uni} | ${year}`, note);
  lines.push(...resume.certifications, ...resume.additional);
  return lines.filter((l) => l.trim().length > 0).join('\n');
}
