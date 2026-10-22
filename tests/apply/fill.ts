/**
 * Fills an application form from an ApplyPlan with Playwright and stops.
 *
 * Shared by the fixture test and documented for the apply-assist skill (which drives the
 * Playwright MCP by hand along the same rules). It only ever calls `fill` or `selectOption`
 * on text-like inputs, textareas and selects whose label matches a plan field. It never clicks,
 * never touches file inputs, checkboxes, radios, buttons, or anything on the never list.
 */
import type { Page } from '@playwright/test';

import { type ApplyPlan, isForbidden, matchField } from '@jobhunt-hq/core';

export interface FillReport {
  filled: Array<{ key: string; label: string }>;
  /** Controls found on the page that the kit leaves to the human. */
  remaining: Array<{ label: string; reason: string }>;
}

interface ControlInfo {
  index: number;
  tag: string;
  type: string;
  descriptor: string;
  options: string[];
}

export async function fillForm(page: Page, plan: ApplyPlan): Promise<FillReport> {
  const controls = page.locator('input, textarea, select, button');
  const infos: ControlInfo[] = await controls.evaluateAll((nodes) =>
    nodes.map((node, index) => {
      const el = node as HTMLInputElement;
      const id = el.id;
      const labelFor = id
        ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent
        : '';
      const labelParent = el.closest('label')?.textContent ?? '';
      const sibling =
        el.parentElement?.querySelector('.application-label, .field-label')?.textContent ?? '';
      const parts = [
        labelFor,
        labelParent,
        sibling,
        el.getAttribute('aria-label'),
        el.getAttribute('placeholder'),
        el.name,
        id,
        el.tagName === 'BUTTON' ? el.textContent : '',
      ];
      return {
        index,
        tag: el.tagName.toLowerCase(),
        type: (el.getAttribute('type') ?? '').toLowerCase(),
        descriptor: parts
          .filter((p): p is string => Boolean(p))
          .map((p) => p.replace(/\s+/g, ' ').trim())
          .join(' | '),
        options:
          el.tagName === 'SELECT'
            ? Array.from((el as unknown as HTMLSelectElement).options).map((o) => o.value)
            : [],
      };
    }),
  );

  const report: FillReport = { filled: [], remaining: [] };
  const NEVER_TYPES = new Set([
    'file',
    'checkbox',
    'radio',
    'submit',
    'button',
    'reset',
    'password',
    'hidden',
  ]);

  for (const info of infos) {
    const label = info.descriptor.split(' | ')[0] ?? info.descriptor;
    const typeDescriptor = `${info.descriptor} | type=${info.type}`;

    if (
      info.tag === 'button' ||
      NEVER_TYPES.has(info.type) ||
      isForbidden(typeDescriptor, plan.never)
    ) {
      const reason =
        info.type === 'file'
          ? 'upload: attach yourself'
          : info.type === 'checkbox' || info.type === 'radio'
            ? 'choice: tick yourself'
            : info.tag === 'button' || info.type === 'submit'
              ? 'button: never clicked'
              : 'never filled by the kit';
      if (info.type !== 'hidden') report.remaining.push({ label, reason });
      continue;
    }

    const field = matchField(info.descriptor, plan.fields);
    if (!field) {
      report.remaining.push({ label, reason: 'no matching profile or pack field' });
      continue;
    }

    const control = controls.nth(info.index);
    if (info.tag === 'select') {
      const option =
        info.options.find((o) => o.toLowerCase() === field.value.toLowerCase()) ??
        info.options.find((o) => o && field.value.toLowerCase().startsWith(o.toLowerCase()));
      if (!option) {
        report.remaining.push({ label, reason: `select: no option matches "${field.value}"` });
        continue;
      }
      await control.selectOption(option);
    } else {
      await control.fill(field.value);
    }
    report.filled.push({ key: field.key, label });
  }

  return report;
}
