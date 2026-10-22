import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
    expect(text).toMatch(/^(ok {3}|FAIL) LibreOffice/m);

    writeFileSync(join(cwd, 'data/master.json'), JSON.stringify({ name: 'X' }));
    out = [];
    err = [];
    expect(await jh('doctor', '--config-dir', 'nowhere')).toBe(1);
    const failed = out.join('\n');
    expect(failed).toMatch(/^FAIL config\/profile\.yaml\s+.*profile\.yaml: not found/m);
    expect(failed).toMatch(/^FAIL data\/master\.json\s+.*invalid\.\n {5} {2}- title: /m);
    expect(err.at(-1)).toBe('3 checks failed');

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
