import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadProfile, loadRules } from './config.js';
import { Rules } from './schema.js';
import { scoutBrief, sourceGroups } from './search.js';

const dir = join(import.meta.dirname, '../../../config');
const profile = loadProfile(join(dir, 'profile.example.yaml'));
const rules = loadRules(join(dir, 'rules.example.yaml'));

describe('sourceGroups', () => {
  it('derives the five groups from the example rules', () => {
    const groups = sourceGroups(rules);
    expect(groups.map((g) => [g.key, g.enabled])).toEqual([
      ['bigTech', true],
      ['ats', true],
      ['remote', true],
      ['research', true],
      ['custom', true],
    ]);
    expect(groups.find((g) => g.key === 'ats')?.targets).toEqual([
      'greenhouse',
      'lever',
      'ashby',
      'workable',
    ]);
    expect(groups.find((g) => g.key === 'custom')?.targets).toEqual(['relocue.com']);
  });

  it('disables groups the rules turn off', () => {
    const minimal = Rules.parse({
      locations: {},
      experience: { maxYearsBar: 4 },
      style: {},
      sources: { bigTech: false, ats: [], remote: [], research: false, custom: [] },
    });
    expect(sourceGroups(minimal).every((g) => !g.enabled)).toBe(true);
  });
});

describe('scoutBrief', () => {
  const group = sourceGroups(rules).find((g) => g.key === 'ats')!;
  const tracked = [
    {
      id: 'acme-x',
      company: 'Acme',
      role: 'Backend Engineer',
      location: 'Lisbon',
      url: 'https://a.example/1',
    },
    {
      id: 'globex-y',
      company: 'Globex',
      role: 'AI Engineer',
      location: 'London',
      url: 'https://g.example/2',
    },
  ];
  const brief = scoutBrief({
    group,
    profile,
    rules,
    tracked,
    focus: 'fintech',
    today: '2026-10-22',
  });

  it('carries the candidate, the rules and the recency cut-off', () => {
    expect(brief).toContain('# Job scout brief: Startups via public ATS boards');
    expect(brief).toContain('Focus for this run: fintech.');
    expect(brief).toContain(
      '- Target titles: Full Stack Engineer, AI Engineer, Forward Deployed Engineer, Solutions Engineer',
    );
    expect(brief).toContain('- Can work without sponsorship in: Portugal');
    expect(brief).toContain('Posted on or after 2026-08-23 (rules.recencyDays = 60)');
    expect(brief).toContain(
      'remote from Portugal, EU, or on-site/hybrid in London, Dublin, Amsterdam, Berlin, Toronto. Never: India.',
    );
    expect(brief).toContain('skip if the posting asks for more than 4 years');
    expect(brief).toContain('fluency required in German, French, Arabic');
    expect(brief).toContain('"citizenship required", "security clearance", "national of"');
  });

  it('lists tracked roles sorted and the output contract with the group key', () => {
    expect(brief).toContain(
      '- Acme | Backend Engineer | Lisbon | https://a.example/1\n- Globex | AI Engineer | London | https://g.example/2',
    );
    expect(brief).toContain('"source": "ats"');
    expect(brief).toContain('"postedAt": "2026-10-22"');
    expect(brief).toContain('Return at most 15 rows');
    expect(brief).not.toContain('—');
  });

  it('handles an empty tracker and no focus', () => {
    const b = scoutBrief({ group, profile, rules, tracked: [], today: '2026-10-22', maxRows: 5 });
    expect(b).toContain('- nothing tracked yet');
    expect(b).not.toContain('Focus for this run');
    expect(b).toContain('Return at most 5 rows');
  });
});
