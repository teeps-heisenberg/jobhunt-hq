/**
 * Loads and validates the user's YAML config (`config/profile.yaml`, `config/rules.yaml`).
 * Personal config is git-ignored; the `*.example.yaml` files ship with the repo.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';
import type { ZodType } from 'zod';
import { z } from 'zod';

import { Profile, Rules } from './schema.js';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';

  constructor(
    message: string,
    readonly file: string,
  ) {
    super(message);
  }
}

/** Parses YAML text and validates it against `schema`. `file` is used in error messages only. */
export function parseConfig<T>(schema: ZodType<T>, text: string, file = '<inline>'): T {
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`${file}: invalid YAML. ${reason}`, file);
  }

  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;

  const issues = result.error.issues
    .map((issue) => `  - ${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('\n');
  throw new ConfigError(`${file}: invalid config.\n${issues}`, file);
}

/** Reads a YAML file and validates it. Points at the example file when the user copy is missing. */
export function loadConfigFile<T>(schema: ZodType<T>, path: string): T {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    const name = basename(absolute);
    const example = name.replace(/\.ya?ml$/, '.example.yaml');
    throw new ConfigError(
      `${absolute}: not found. Copy config/${example} to ${name} and fill it in, or run /setup.`,
      absolute,
    );
  }
  return parseConfig(schema, readFileSync(absolute, 'utf8'), absolute);
}

export interface LoadConfigOptions {
  /** Directory holding profile.yaml and rules.yaml. Defaults to `./config`. */
  dir?: string;
  /** Overrides `<dir>/profile.yaml`. */
  profileFile?: string;
  /** Overrides `<dir>/rules.yaml`. */
  rulesFile?: string;
}

export const AppConfig = z.object({ profile: Profile, rules: Rules });
export type AppConfig = z.infer<typeof AppConfig>;

export function loadProfile(path = join('config', 'profile.yaml')): Profile {
  return loadConfigFile(Profile, path);
}

export function loadRules(path = join('config', 'rules.yaml')): Rules {
  return loadConfigFile(Rules, path);
}

/** Loads both config files. Throws `ConfigError` naming the file and every invalid field. */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const dir = options.dir ?? 'config';
  return {
    profile: loadProfile(options.profileFile ?? join(dir, 'profile.yaml')),
    rules: loadRules(options.rulesFile ?? join(dir, 'rules.yaml')),
  };
}
