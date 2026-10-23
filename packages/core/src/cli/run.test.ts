import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { openDb } from '../db/client.js';
import { getJob, listEvents, listSearches } from '../db/repo.js';
import { extractSkills } from './skills.js';
import { run, USAGE } from './run.js';

const repoRoot = join(import.meta.dirname, '../../../..');
const TODAY = '2026-10-22';

let cwd: string;
let out: string[];
let err: string[];

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'jh-cli-'));
  mkdirSync(join(cwd, 'config'));
  mkdirSync(join(cwd, 'data'));
  copyFileSync(join(repoRoot, 'config/profile.example.yaml'), join(cwd, 'config/profile.yaml'));
  copyFileSync(join(repoRoot, 'config/rules.example.yaml'), join(cwd, 'config/rules.yaml'));
  copyFileSync(join(repoRoot, 'data/examples/master.json'), join(cwd, 'data/master.json'));
  out = [];
  err = [];
});

const jh = (...argv: string[]) =>
  run(argv, { out: (l) => out.push(l), err: (l) => err.push(l), cwd, env: {}, today: TODAY });

const scoutRows = [
  {
    company: 'Acme',
    role: 'Full Stack Engineer',
    location: 'Remote - EU',
    remote: true,
    url: 'https://boards.greenhouse.io/acme/jobs/111',
    postedAt: '2026-10-20',
    minYears: 3,
    keyRequirements: ['TypeScript', 'React', 'PostgreSQL'],
    why: 'Stack matches.',
    gap: 'No NestJS in production.',
    source: 'ats',
  },
  {
    company: 'Globex',
    role: 'Senior Platform Engineer',
    location: 'Austin, US',
    remote: false,
    url: 'https://globex.example/jobs/2',
    minYears: 7,
    keyRequirements: ['Go'],
    source: 'bigTech',
  },
  {
    company: 'ACME Inc',
    role: 'Full-Stack Developer (Remote)',
    location: 'Remote (EU)',
    remote: true,
    url: 'https://acme.example/careers?gh_jid=111',
    source: 'remote',
  },
];

function writeScout(name = 'scout.json', rows: unknown = scoutRows) {
  const path = join(cwd, name);
  writeFileSync(path, JSON.stringify(rows));
  return path;
}

describe('usage and errors', () => {
  it('prints usage with no command and exits 2', async () => {
    expect(await jh()).toBe(2);
    expect(out.join('\n')).toBe(USAGE);
  });

  it('prints usage with --help and exits 0', async () => {
    expect(await jh('list', '--help')).toBe(0);
    expect(out[0]).toContain('Usage: jh <command>');
  });

  it('rejects unknown commands and options', async () => {
    expect(await jh('frobnicate')).toBe(2);
    expect(err[0]).toMatch(/Unknown command: frobnicate/);
    expect(await jh('list', '--bogus')).toBe(2);
  });
});

describe('add-jobs', () => {
  it('inserts, dedupes, scores and records a search run', async () => {
    const file = writeScout();
    expect(await jh('add-jobs', file, '--focus', 'full stack')).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('Inserted 2 of 3 (1 duplicates, 1 skipped by rules)');
    expect(text).toMatch(/acme-full-stack-engineer-eu\s+[45]\.\d\s+Shortlisted/);
    expect(text).toMatch(/globex-senior-platform-engineer-austin\s+0\.0\s+Skipped/);
    expect(text).toContain('Duplicates:');
    expect(text).toContain('= acme-full-stack-engineer-eu (ats-id)');
    expect(text).toMatch(/Skipped by rules:\n.*asks for 7\+ years/);

    const { db, close } = openDb({ path: join(cwd, 'data/jobhunt.db') });
    try {
      const acme = getJob(db, 'acme-full-stack-engineer-eu');
      expect(acme).toMatchObject({
        status: 'Shortlisted',
        why: 'Stack matches.',
        gaps: 'No NestJS in production.',
        batch: '2026-10-22-ats',
      });
      expect(acme!.visaNote).toBe('remote from an allowed location');
      const globex = getJob(db, 'globex-senior-platform-engineer-austin');
      expect(globex!.gaps).toMatch(/asks for 7\+ years/);
      expect(listSearches(db)).toMatchObject([
        { focus: 'full stack', found: 3, new: 1, skipped: 2 },
      ]);
    } finally {
      close();
    }
  });

  it('accepts the {jobs, rejected} scout shape and --json output', async () => {
    const file = writeScout('scout.json', {
      jobs: [scoutRows[0]],
      rejected: [{ title: 'Acme Staff Eng', reason: '8 years' }],
    });
    expect(await jh('add-jobs', file, '--json')).toBe(0);
    const summary = JSON.parse(out.join('\n'));
    expect(summary.inserted).toEqual([
      { id: 'acme-full-stack-engineer-eu', score: expect.any(Number), status: 'Shortlisted' },
    ]);
    expect(summary.rejectedByScout).toEqual([{ title: 'Acme Staff Eng', reason: '8 years' }]);
  });

  it('is idempotent: a second run finds only duplicates', async () => {
    const file = writeScout();
    await jh('add-jobs', file);
    out = [];
    expect(await jh('add-jobs', file)).toBe(0);
    expect(out[0]).toContain('Inserted 0 of 3 (3 duplicates');
  });

  it('--dry-run writes nothing', async () => {
    const file = writeScout();
    expect(await jh('add-jobs', file, '--dry-run')).toBe(0);
    expect(out[0]).toMatch(/^Would insert 2 of 3/);
    out = [];
    await jh('list');
    expect(out[0]).toBe('No jobs match.');
  });

  it('fails with a schema report on bad rows and exits 2', async () => {
    const file = writeScout('bad.json', [
      { company: 'Acme', role: 'X', location: 'Y', url: 'not a url' },
    ]);
    expect(await jh('add-jobs', file)).toBe(2);
    expect(err[0]).toMatch(/rows do not match the Job schema\.\n {2}- jobs\.0\.url/);
    expect(await jh('add-jobs', join(cwd, 'missing.json'))).toBe(2);
    expect(err[1]).toMatch(/File not found/);
  });

  it('fails clearly when config is missing', async () => {
    const file = writeScout();
    expect(await jh('add-jobs', file, '--config-dir', 'nowhere')).toBe(1);
    expect(err[0]).toMatch(/profile\.yaml: not found/);
  });

  it('warns when master.json is missing but still inserts', async () => {
    const file = writeScout('one.json', [scoutRows[0]]);
    expect(await jh('add-jobs', file, '--master', 'data/none.json')).toBe(0);
    expect(err[0]).toMatch(/warning: .*none\.json not found/);
    expect(out[0]).toContain('Inserted 1 of 1');
  });
});

describe('list, set-status, note, score', () => {
  beforeEach(async () => {
    await jh('add-jobs', writeScout());
    out = [];
    err = [];
  });

  it('lists as table, ids and json with filters', async () => {
    expect(await jh('list')).toBe(0);
    expect(out[0]).toMatch(/^id\s+score\s+status\s+company/);
    expect(out[0]!.split('\n')).toHaveLength(4);

    out = [];
    await jh('list', '--status', 'Shortlisted', '--min-score', '4', '--format', 'ids');
    const ids = JSON.parse(out.join('\n'));
    expect(ids).toEqual([
      {
        id: 'acme-full-stack-engineer-eu',
        company: 'Acme',
        role: 'Full Stack Engineer',
        location: 'Remote - EU',
        url: 'https://boards.greenhouse.io/acme/jobs/111',
      },
    ]);

    out = [];
    await jh('list', '--status', 'skipped', '--json');
    expect(JSON.parse(out.join('\n'))).toHaveLength(1);

    out = [];
    await jh('list', '--company', 'nobody');
    expect(out[0]).toBe('No jobs match.');

    expect(await jh('list', '--status', 'Ghosted')).toBe(2);
    expect(await jh('list', '--format', 'yaml')).toBe(2);
  });

  it('sets status with a computed follow-up and an event', async () => {
    expect(
      await jh('set-status', 'acme-full-stack-engineer-eu', 'applied', '--note', 'via Greenhouse'),
    ).toBe(0);
    expect(out[0]).toBe('acme-full-stack-engineer-eu: Applied, follow up on 2026-11-01');

    const { db, close } = openDb({ path: join(cwd, 'data/jobhunt.db') });
    try {
      const events = listEvents(db, 'acme-full-stack-engineer-eu');
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toEqual({
        from: 'Shortlisted',
        to: 'Applied',
        note: 'via Greenhouse',
      });
    } finally {
      close();
    }

    out = [];
    await jh('set-status', 'acme-full-stack-engineer-eu', 'Responded', '--follow-up', '2026-11-20');
    expect(out[0]).toBe('acme-full-stack-engineer-eu: Responded, follow up on 2026-11-20');

    expect(
      await jh('set-status', 'acme-full-stack-engineer-eu', 'Applied', '--follow-up', 'soon'),
    ).toBe(2);
    expect(await jh('set-status', 'missing', 'Applied')).toBe(1);
    expect(err.at(-1)).toMatch(/No job with id "missing"/);
  });

  it('lists due follow-ups', async () => {
    await jh('set-status', 'acme-full-stack-engineer-eu', 'Applied', '--follow-up', '2026-10-20');
    out = [];
    await jh('list', '--due');
    expect(out[0]).toContain('acme-full-stack-engineer-eu');
    expect(out[0]!.split('\n')).toHaveLength(3);
  });

  it('adds notes', async () => {
    expect(await jh('note', 'acme-full-stack-engineer-eu', 'Recruiter', 'replied')).toBe(0);
    expect(out[0]).toBe('acme-full-stack-engineer-eu: note added');
    out = [];
    await jh('list', '--json', '--company', 'Acme');
    expect(JSON.parse(out.join('\n'))[0].notes).toBe('2026-10-22: Recruiter replied');
    expect(await jh('note', 'acme-full-stack-engineer-eu')).toBe(2);
  });

  it('re-scores with LLM text and requirements', async () => {
    expect(
      await jh(
        'score',
        'acme-full-stack-engineer-eu',
        '--why',
        'Three years of React and Node.',
        '--gap',
        'No Rust.',
        '--requirements',
        'Rust, Kubernetes, TypeScript',
        '--min-years',
        '3',
      ),
    ).toBe(0);
    expect(out[0]).toMatch(/^acme-full-stack-engineer-eu: score \d\.\d, status New/);
    expect(out.join('\n')).toMatch(/skills\s+0\.33\s+1\/3 matched; missing: Rust, Kubernetes/);

    out = [];
    await jh('list', '--json', '--company', 'Acme');
    const [job] = JSON.parse(out.join('\n'));
    expect(job).toMatchObject({
      why: 'Three years of React and Node.',
      gaps: 'No Rust.',
      status: 'New',
    });
  });

  it('score reads a JSON file and lets flags override it', async () => {
    writeFileSync(
      join(cwd, 'score.json'),
      JSON.stringify({
        why: 'From file.',
        gap: 'File gap.',
        visaNote: 'Sponsorship available',
        minYears: 2,
        keyRequirements: ['TypeScript', 'React'],
        salaryText: 'USD 3,000-4,000/month',
        postedAt: '2026-10-21',
      }),
    );
    expect(
      await jh(
        'score',
        'acme-full-stack-engineer-eu',
        '--from',
        'score.json',
        '--gap',
        'Flag gap.',
        '--json',
      ),
    ).toBe(0);
    const { job, result } = JSON.parse(out.join('\n'));
    expect(job).toMatchObject({
      why: 'From file.',
      gaps: 'Flag gap.',
      visaNote: 'Sponsorship available',
      salaryText: 'USD 3,000-4,000/month',
      postedAt: '2026-10-21',
      status: 'Shortlisted',
    });
    expect(result.factors.skills.value).toBe(1);
    expect(result.factors.salary.value).toBe(1);

    writeFileSync(join(cwd, 'bad.json'), JSON.stringify({ minYears: 'three' }));
    expect(await jh('score', 'acme-full-stack-engineer-eu', '--from', 'bad.json')).toBe(2);
    expect(err.at(-1)).toMatch(/invalid score file\.\n {2}- minYears/);
    expect(await jh('score', 'acme-full-stack-engineer-eu', '--from', 'none.json')).toBe(2);
  });

  it('score keeps a status the user set by hand', async () => {
    await jh('set-status', 'acme-full-stack-engineer-eu', 'Applied');
    out = [];
    await jh('score', 'acme-full-stack-engineer-eu', '--requirements', 'Rust', '--json');
    expect(JSON.parse(out.join('\n')).job.status).toBe('Applied');
  });
});

describe('stats and export-csv', () => {
  it('reports the funnel and writes CSV', async () => {
    await jh('add-jobs', writeScout());
    await jh('set-status', 'acme-full-stack-engineer-eu', 'Applied', '--follow-up', '2026-10-01');
    out = [];

    expect(await jh('stats')).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('Tracked: 2 jobs at 2 companies');
    expect(text).toMatch(/Applied\s+1/);
    expect(text).toContain('Applied: 1  Responded: 0 (0% of applied)  Follow-ups due: 1');

    out = [];
    await jh('stats', '--json');
    expect(JSON.parse(out.join('\n')).byStatus.Skipped).toBe(1);

    out = [];
    expect(await jh('export-csv', 'out/jobs.csv')).toBe(0);
    const csv = readFileSync(join(cwd, 'out/jobs.csv'), 'utf8').split('\r\n');
    expect(csv[0]).toMatch(/^id,company,role,location/);
    expect(csv).toHaveLength(4);
    expect(csv[1]).toContain('acme-full-stack-engineer-eu');

    out = [];
    await jh('export-csv');
    expect(out[0]!.split('\n')).toHaveLength(3);
  });
});

describe('extractSkills', () => {
  it('reads the example master.json', () => {
    const master = JSON.parse(readFileSync(join(repoRoot, 'data/examples/master.json'), 'utf8'));
    const skills = extractSkills(master);
    expect(skills).toEqual(
      expect.arrayContaining(['TypeScript', 'React', 'PostgreSQL', 'Docker', 'TDD']),
    );
    expect(skills).not.toContain('Languages');
  });

  it('tolerates other shapes', () => {
    expect(extractSkills({ skills: ['Go', 'Rust and C'] })).toEqual(['Go', 'Rust', 'C']);
    expect(extractSkills({ skills: { Backend: ['Node.js'], Cloud: 'AWS, GCP' } })).toEqual([
      'Node.js',
      'AWS',
      'GCP',
    ]);
    expect(extractSkills({ skills: [{ group: 'X', items: ['Kafka'] }] })).toEqual(['Kafka']);
    expect(extractSkills(null)).toEqual([]);
  });
});

describe('show, import-cv, doctor', () => {
  it('shows one job with timeline and artifacts', async () => {
    await jh('add-jobs', writeScout('one.json', [scoutRows[0]]));
    await jh('set-status', 'acme-full-stack-engineer-eu', 'Applied', '--note', 'via form');
    await jh('note', 'acme-full-stack-engineer-eu', 'Recruiter replied');
    out = [];
    expect(await jh('show', 'acme-full-stack-engineer-eu')).toBe(0);
    const text = out.join('\n');
    expect(text.split('\n')[0]).toBe('Acme: Full Stack Engineer');
    expect(text).toMatch(/^status\s+Applied$/m);
    expect(text).toMatch(/^why\s+Stack matches\.$/m);
    expect(text).toContain('notes\n  2026-10-22: Recruiter replied');
    expect(text).toMatch(
      /timeline\n.*status_change\s+Shortlisted -> Applied: via form\n.*note\s+Recruiter replied/,
    );
    expect(text).not.toContain('artifacts');

    out = [];
    await jh('show', 'acme-full-stack-engineer-eu', '--json');
    const json = JSON.parse(out.join('\n'));
    expect(json.events).toHaveLength(2);
    expect(json.artifacts).toEqual([]);
    expect(await jh('show', 'missing')).toBe(1);
  });

  it('imports a CV to data/imports and prints the text', async () => {
    const src = join(cwd, 'my cv.txt');
    writeFileSync(src, 'Sam Rivera\nEngineer\n');
    expect(await jh('import-cv', src)).toBe(0);
    expect(out.join('\n')).toBe('Sam Rivera\nEngineer');
    expect(err[0]).toMatch(/Read TXT, 19 characters\. Wrote .*data[\\/]imports[\\/]my cv\.txt/);
    expect(readFileSync(join(cwd, 'data/imports/my cv.txt'), 'utf8')).toBe(
      'Sam Rivera\nEngineer\n',
    );

    out = [];
    expect(await jh('import-cv', src, '--out', 'cv.txt', '--json')).toBe(0);
    expect(JSON.parse(out.join('\n'))).toMatchObject({
      format: 'txt',
      text: 'Sam Rivera\nEngineer',
    });
    expect(readFileSync(join(cwd, 'cv.txt'), 'utf8')).toBe('Sam Rivera\nEngineer\n');

    expect(await jh('import-cv', join(cwd, 'nope.pdf'))).toBe(2);
    writeFileSync(join(cwd, 'cv.odt'), 'x');
    expect(await jh('import-cv', join(cwd, 'cv.odt'))).toBe(1);
    expect(err.at(-1)).toMatch(/Unsupported CV format/);
  });

  it('doctor passes with the example files and fails on a broken one', async () => {
    expect(await jh('doctor')).toBe(0);
    const text = out.join('\n');
    expect(text).toMatch(/^ok {3}config\/profile\.yaml\s+Sam Rivera, 3 years, 4 target titles$/m);
    expect(text).toMatch(/^ok {3}config\/rules\.yaml\s+years bar 4, 2 pages, 4 salary bands$/m);
    expect(text).toMatch(
      /^ok {3}data\/master\.json\s+Sam Rivera, 2 positions, 3 projects, 6 skill groups$/m,
    );
    expect(text).toMatch(/^ok {3}database\s+.*jobhunt\.db \(0 jobs\)$/m);
    expect(text).toMatch(/^(ok {2}|FAIL) LibreOffice/m);

    writeFileSync(join(cwd, 'data/master.json'), JSON.stringify({ name: 'X' }));
    out = [];
    err = [];
    expect(await jh('doctor', '--config-dir', 'nowhere')).toBe(1);
    const failed = out.join('\n');
    expect(failed).toMatch(/^FAIL config\/profile\.yaml\s+.*profile\.yaml: not found/m);
    expect(failed).toMatch(/^FAIL data\/master\.json\s+.*invalid\.\n {5} {2}- title: /m);
    expect(err.at(-1)).toBe('3 checks failed');
    expect(failed).toContain('Next: open Claude Code in this folder and run /setup.');
    expect(failed).toContain('pnpm demo starts the dashboard');

    out = [];
    await jh('doctor', '--json');
    const checks = JSON.parse(out.join('\n')) as Array<{ name: string; ok: boolean }>;
    expect(checks.map((c) => c.name)).toEqual([
      'config/profile.yaml',
      'config/rules.yaml',
      'data/master.json',
      'database',
      'LibreOffice',
    ]);
  });
});

describe('sources and scout-brief', () => {
  it('lists source groups from rules', async () => {
    expect(await jh('sources')).toBe(0);
    expect(out[0]).toMatch(/^group\s+enabled\s+label/);
    expect(out[0]).toMatch(
      /^ats\s+yes\s+Startups via public ATS boards\s+greenhouse, lever, ashby, workable$/m,
    );
    out = [];
    await jh('sources', '--json');
    expect(JSON.parse(out.join('\n'))).toHaveLength(5);
  });

  it('writes a brief with the tracked roles and reports the path', async () => {
    await jh('add-jobs', writeScout('one.json', [scoutRows[0]]));
    out = [];
    expect(await jh('scout-brief', 'ats', '--focus', 'fintech')).toBe(0);
    const path = out[0]!;
    expect(path).toMatch(/data[\\/]scout[\\/]ats\.md$/);
    const brief = readFileSync(path, 'utf8');
    expect(brief).toContain('# Job scout brief: Startups via public ATS boards');
    expect(brief).toContain('Focus for this run: fintech.');
    expect(brief).toContain(
      '- Acme | Full Stack Engineer | Remote - EU | https://boards.greenhouse.io/acme/jobs/111',
    );
    expect(brief).toContain('Date: 2026-10-22');

    out = [];
    expect(await jh('scout-brief', 'BigTech', '--out', 'brief.md', '--json')).toBe(0);
    expect(JSON.parse(out.join('\n'))).toMatchObject({ group: 'bigTech', tracked: 1 });
    expect(readFileSync(join(cwd, 'brief.md'), 'utf8')).toContain('careers.google.com');

    expect(await jh('scout-brief', 'linkedin')).toBe(2);
    expect(err.at(-1)).toMatch(/Groups: bigTech, ats, remote, research, custom/);
    expect(await jh('scout-brief')).toBe(2);
  });
});

describe('tailor', () => {
  beforeEach(async () => {
    await jh('add-jobs', writeScout('one.json', [scoutRows[0]]));
    out = [];
    err = [];
  });

  it('renders the master CV for a job, records artifacts and reports no claims', async () => {
    expect(await jh('tailor', 'acme-full-stack-engineer-eu', '--no-pdf')).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('acme-full-stack-engineer-eu: OK');
    expect(text).toContain('docx   output/acme/full-stack-engineer/cv.docx');
    expect(text).toContain('pdf    skipped (--no-pdf)');
    expect(text).toContain('lint   clean');
    expect(text).toContain('verify before sending: nothing');
    expect(existsSync(join(cwd, 'output/acme/full-stack-engineer/cv.docx'))).toBe(true);

    out = [];
    await jh('show', 'acme-full-stack-engineer-eu', '--json');
    const { artifacts } = JSON.parse(out.join('\n'));
    expect(artifacts).toMatchObject([
      { kind: 'cv_docx', path: 'output/acme/full-stack-engineer/cv.docx', verifyItems: [] },
    ]);
  });

  it('applies a variant spec and lists new claims as verify items', async () => {
    writeFileSync(
      join(cwd, 'spec.json'),
      JSON.stringify({
        title: 'Full Stack Engineer, Applied AI',
        skills: { order: ['AI / ML'] },
        experience: [{ company: 'Example Agency', bullets: ['Led a team of four engineers.'] }],
      }),
    );
    expect(
      await jh(
        'tailor',
        'acme-full-stack-engineer-eu',
        '--variant',
        'spec.json',
        '--no-pdf',
        '--json',
      ),
    ).toBe(0);
    const summary = JSON.parse(out.join('\n'));
    expect(summary.ok).toBe(true);
    expect(summary.newClaims).toEqual([
      { where: 'title', text: 'Full Stack Engineer, Applied AI' },
      { where: 'experience.Example Agency', text: 'Led a team of four engineers.' },
    ]);
    out = [];
    await jh('show', 'acme-full-stack-engineer-eu', '--json');
    const { artifacts } = JSON.parse(out.join('\n'));
    expect(artifacts[0].verifyItems).toEqual([
      'title: Full Stack Engineer, Applied AI',
      'experience.Example Agency: Led a team of four engineers.',
    ]);
  });

  it('fails the style lint on a banned character but still writes the file', async () => {
    writeFileSync(join(cwd, 'spec.json'), JSON.stringify({ summary: 'Builder — of things.' }));
    expect(
      await jh('tailor', 'acme-full-stack-engineer-eu', '--variant', 'spec.json', '--no-pdf'),
    ).toBe(1);
    expect(out.join('\n')).toMatch(/NEEDS WORK[\s\S]*lint {3}1 issue[\s\S]*em dash/);
    expect(err.at(-1)).toBe('style lint failed');
    expect(existsSync(join(cwd, 'output/acme/full-stack-engineer/cv.docx'))).toBe(true);
  });

  it('renders a generic CV without a job and rejects bad input', async () => {
    expect(await jh('tailor', 'generic', '--no-pdf')).toBe(0);
    expect(out[0]).toBe('generic: OK');
    expect(existsSync(join(cwd, 'output/generic/cv.docx'))).toBe(true);

    expect(await jh('tailor')).toBe(2);
    expect(await jh('tailor', 'missing', '--no-pdf')).toBe(1);
    expect(await jh('tailor', 'generic', '--variant', 'none.json', '--no-pdf')).toBe(2);
    writeFileSync(join(cwd, 'bad.json'), JSON.stringify({ projects: { max: -1 } }));
    expect(await jh('tailor', 'generic', '--variant', 'bad.json', '--no-pdf')).toBe(2);
    expect(err.at(-1)).toMatch(/Variant could not be built/);
  });

  it('converts to PDF and checks pages when LibreOffice is available', async () => {
    const code = await jh('tailor', 'acme-full-stack-engineer-eu', '--json');
    const summary = JSON.parse(out.join('\n'));
    if (summary.pdf) {
      expect(summary.pages.pages).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(cwd, summary.pdf))).toBe(true);
      expect(code).toBe(summary.pages.ok ? 0 : 1);
    } else {
      expect(code).toBe(0);
      expect(summary.pdfNote).toMatch(/soffice/);
    }
  }, 120_000);
});

describe('pack', () => {
  beforeEach(async () => {
    await jh('add-jobs', writeScout('one.json', [scoutRows[0]]));
    writeFileSync(
      join(cwd, 'spec.json'),
      JSON.stringify({
        experience: [{ company: 'Example Agency', bullets: ['Led a team of four engineers.'] }],
      }),
    );
    await jh('tailor', 'acme-full-stack-engineer-eu', '--variant', 'spec.json', '--no-pdf');
    writeFileSync(
      join(cwd, 'pack.json'),
      JSON.stringify({
        coverNote: [
          'I am applying for the Full Stack Engineer role at Acme.',
          'Thank you for your time.',
        ],
        whyThisRole: ['Next.js and NestJS match the posting.'],
        screening: [{ question: 'Notice period', answer: '2 weeks, negotiable' }],
        notes: ['The form asks for a cover letter.'],
        verify: [
          {
            text: 'used by 200 clinics',
            where: 'cover.para 1',
            reason: 'number differs from master',
          },
        ],
      }),
    );
    out = [];
    err = [];
  });

  it('writes pack.md and cover.docx, merges screening and verify, records artifacts', async () => {
    expect(await jh('pack', 'acme-full-stack-engineer-eu', '--from', 'pack.json')).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('acme-full-stack-engineer-eu: OK');
    expect(text).toContain('pack   output/acme/full-stack-engineer/pack.md');
    expect(text).toContain('cover  output/acme/full-stack-engineer/cover.docx');
    expect(text).toContain('cv     output/acme/full-stack-engineer/cv.docx');
    expect(text).toContain('- Years of professional experience: 3 (profile.yearsExperience)');
    expect(text).toContain(
      '- Salary expectation: USD 2,500-3,500/month, flexible (rules.salary.remote)',
    );
    expect(text).toContain('- Notice period: 2 weeks, negotiable');
    expect(text).not.toContain('Notice period: 1 month');
    expect(text).toContain('- Work authorisation: Can work remotely from EU without sponsorship');
    expect(text).toContain('verify before sending (2):');
    expect(text).toContain('- used by 200 clinics (cover.para 1)');
    expect(text).toContain('- Led a team of four engineers. (cv.experience.Example Agency)');

    const md = readFileSync(join(cwd, 'output/acme/full-stack-engineer/pack.md'), 'utf8');
    expect(md).toContain('# Acme: Full Stack Engineer');
    expect(md).toContain('- **Cover letter (DOCX):** output/acme/full-stack-engineer/cover.docx');
    expect(md).toContain('## Read before applying\n\n- The form asks for a cover letter.');
    expect(md).toContain(
      '- **Salary expectation:** USD 2,500-3,500/month, flexible (from rules.salary.remote)',
    );
    expect(existsSync(join(cwd, 'output/acme/full-stack-engineer/cover.docx'))).toBe(true);

    out = [];
    await jh('show', 'acme-full-stack-engineer-eu', '--json');
    const { artifacts } = JSON.parse(out.join('\n'));
    expect(artifacts.map((a: { kind: string }) => a.kind).sort()).toEqual([
      'cover',
      'cv_docx',
      'pack',
    ]);
    expect(artifacts.find((a: { kind: string }) => a.kind === 'pack').verifyItems).toEqual([
      'cover.para 1: used by 200 clinics',
      'cv.experience.Example Agency: Led a team of four engineers.',
    ]);
  });

  it('fails lint on an em dash in the cover note and reports bad input', async () => {
    writeFileSync(join(cwd, 'dash.json'), JSON.stringify({ coverNote: ['Fast — reliable.'] }));
    expect(await jh('pack', 'acme-full-stack-engineer-eu', '--from', 'dash.json')).toBe(1);
    expect(out.join('\n')).toMatch(/NEEDS WORK[\s\S]*em dash/);

    writeFileSync(join(cwd, 'empty.json'), JSON.stringify({ coverNote: [] }));
    expect(await jh('pack', 'acme-full-stack-engineer-eu', '--from', 'empty.json')).toBe(2);
    expect(err.at(-1)).toMatch(/invalid pack file\.\n {2}- coverNote/);
    expect(await jh('pack', 'acme-full-stack-engineer-eu')).toBe(2);
    expect(await jh('pack', 'missing', '--from', 'pack.json')).toBe(1);
  });
});

describe('apply-plan', () => {
  it('prints fields from profile, rules, pack and artifacts', async () => {
    await jh('add-jobs', writeScout('one.json', [scoutRows[0]]));
    await jh('tailor', 'acme-full-stack-engineer-eu', '--no-pdf');
    writeFileSync(
      join(cwd, 'pack.json'),
      JSON.stringify({
        coverNote: ['Hello Acme.'],
        screening: [{ question: 'Why Acme?', answer: 'Stack.' }],
      }),
    );
    out = [];
    expect(
      await jh('apply-plan', 'acme-full-stack-engineer-eu', '--from', 'pack.json', '--json'),
    ).toBe(0);
    const plan = JSON.parse(out.join('\n'));
    expect(plan.applyUrl).toBe('https://boards.greenhouse.io/acme/jobs/111');
    expect(plan.fields.map((f: { key: string }) => f.key)).toEqual(
      expect.arrayContaining([
        'firstName',
        'email',
        'years',
        'salary',
        'coverLetter',
        'screening:Why Acme?',
      ]),
    );
    expect(plan.uploads).toEqual([
      expect.objectContaining({ key: 'cv', path: 'output/acme/full-stack-engineer/cv.docx' }),
    ]);

    out = [];
    expect(await jh('apply-plan', 'acme-full-stack-engineer-eu')).toBe(0);
    expect(out.join('\n')).toMatch(/firstName\s+Sam\s+profile\.name/);
    expect(out.join('\n')).toContain('Review every filled field, then click Submit yourself.');
    expect(await jh('apply-plan', 'acme-full-stack-engineer-eu', '--from', 'none.json')).toBe(2);
  });
});

describe('followups', () => {
  beforeEach(async () => {
    await jh('add-jobs', writeScout());
    await jh('set-status', 'acme-full-stack-engineer-eu', 'Applied', '--follow-up', '2026-10-20');
    out = [];
    err = [];
  });

  it('lists due follow-ups with overdue days and sent count', async () => {
    expect(await jh('followups')).toBe(0);
    expect(out[0]).toMatch(
      /acme-full-stack-engineer-eu\s+Applied\s+Acme\s+Full Stack Engineer\s+2026-10-22\s+2026-10-20\s+2d\s+0/,
    );

    out = [];
    await jh('followups', '--json');
    const [row] = JSON.parse(out.join('\n'));
    expect(row).toMatchObject({
      id: 'acme-full-stack-engineer-eu',
      overdueDays: 2,
      daysSinceApplied: 0,
      followUpsSent: 0,
    });
    expect(row.lastEvent.type).toBe('status_change');
  });

  it('records a sent follow-up and pushes the date by rules.followUpDays', async () => {
    expect(
      await jh('followup-sent', 'acme-full-stack-engineer-eu', '--note', 'Emailed the recruiter'),
    ).toBe(0);
    expect(out[0]).toBe('acme-full-stack-engineer-eu: follow-up recorded, next on 2026-11-01');
    out = [];
    await jh('followups');
    expect(out[0]).toBe('No follow-ups due today.');
    out = [];
    await jh('followups', '--days', '14');
    expect(out[0]).toMatch(/in 10d\s+1$/m);
    out = [];
    await jh('show', 'acme-full-stack-engineer-eu', '--json');
    const { events } = JSON.parse(out.join('\n'));
    expect(events.at(-1)).toMatchObject({
      type: 'follow_up_sent',
      payload: { channel: 'email', note: 'Emailed the recruiter' },
    });
    expect(await jh('followup-sent', 'acme-full-stack-engineer-eu', '--follow-up', 'soon')).toBe(2);
    expect(await jh('followup-sent', 'missing')).toBe(1);
  });
});
