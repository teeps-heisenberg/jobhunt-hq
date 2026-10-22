import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ConfigError,
  loadConfig,
  loadConfigFile,
  loadProfile,
  loadRules,
  parseConfig,
} from './config.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const examples = join(repoRoot, 'config');

describe('example config files', () => {
  it('profile.example.yaml validates', () => {
    const profile = loadProfile(join(examples, 'profile.example.yaml'));
    expect(profile.name).toBe('Sam Rivera');
    expect(profile.citizenship).toEqual(['Portugal']);
    expect(profile.languages[1]).toEqual({ name: 'Portuguese', level: 'native' });
  });

  it('rules.example.yaml validates', () => {
    const rules = loadRules(join(examples, 'rules.example.yaml'));
    expect(rules.experience.maxYearsBar).toBe(4);
    expect(rules.salary['London']).toBe('GBP 45-55K');
    expect(rules.caps.perCompany['google']).toEqual({ applications: 3, perDays: 30 });
    expect(rules.sources.ats).toEqual(['greenhouse', 'lever', 'ashby', 'workable']);
  });

  it('loadConfig reads both files with explicit paths', () => {
    const config = loadConfig({
      profileFile: join(examples, 'profile.example.yaml'),
      rulesFile: join(examples, 'rules.example.yaml'),
    });
    expect(config.profile.yearsExperience).toBe(3);
    expect(config.rules.followUpDays).toBe(10);
  });
});

describe('parseConfig', () => {
  const schema = z.object({ a: z.number(), b: z.object({ c: z.string() }) });

  it('reports every invalid field with its path', () => {
    expect(() => parseConfig(schema, 'a: no\nb: {c: 1}\n', 'rules.yaml')).toThrowError(
      /rules\.yaml: invalid config\.\n {2}- a: .*\n {2}- b\.c: /,
    );
  });

  it('reports YAML syntax errors', () => {
    expect(() => parseConfig(schema, 'a: [1, 2\n', 'x.yaml')).toThrowError(/x\.yaml: invalid YAML/);
  });

  it('treats an empty file as an empty object', () => {
    expect(() => parseConfig(schema, '', 'x.yaml')).toThrowError(ConfigError);
    expect(parseConfig(z.object({ n: z.number().default(1) }), '')).toEqual({ n: 1 });
  });
});

describe('loadConfigFile', () => {
  it('points at the example file when the user copy is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jh-config-'));
    expect(() => loadProfile(join(dir, 'profile.yaml'))).toThrowError(
      /profile\.yaml: not found\. Copy config\/profile\.example\.yaml to profile\.yaml/,
    );
  });

  it('loads a user file that exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jh-config-'));
    const file = join(dir, 'x.yaml');
    writeFileSync(file, 'n: 5\n');
    expect(loadConfigFile(z.object({ n: z.number() }), file)).toEqual({ n: 5 });
  });

  it('throws ConfigError carrying the file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jh-config-'));
    const file = join(dir, 'rules.yaml');
    writeFileSync(file, 'locations: {}\n');
    try {
      loadRules(file);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).file).toBe(resolve(file));
    }
  });
});
