#!/usr/bin/env node
/**
 * `pnpm record:demo`: films a 1080p walkthrough of JobHunt HQ on fictional example data.
 *
 * - Seeds data/video/jobhunt.db from data/examples (never touches your tracker or config).
 * - Runs a real tailor and pack so the job page shows artifacts and a verify list.
 * - Starts the production dashboard on port 3100 and films it with Chrome's screencast.
 * - Fills the local Greenhouse-style fixture form with the same rules as tests/apply and
 *   stops before Submit. The take is discarded if the fixture reports any click on Submit.
 * - Encodes output/video/jobhunt-hq-demo.mp4 (1920x1080, H.264) and, with --gif,
 *   docs/images/demo.gif for the README. Needs ffmpeg on PATH or FFMPEG=<path>.
 *
 * Flags: --skip-build (reuse the existing dashboard build), --gif, --keep-frames.
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';
import { buildApplyPlan, isForbidden, loadProfile, loadRules, matchField } from '@jobhunt-hq/core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const workDir = join(root, 'data', 'video');
const configDir = join(workDir, 'config');
const db = join(workDir, 'jobhunt.db');
const framesDir = join(workDir, 'frames');
const outDir = join(root, 'output', 'video');
const mp4 = join(outDir, 'jobhunt-hq-demo.mp4');
const gif = join(root, 'docs', 'images', 'demo.gif');
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
/** CSS viewport; frames are captured at 1.5x density, so the video is 1920x1080. */
const W = 1280;
const H = 720;
const SCALE = 1.5;
const OUT_W = 1920;
const OUT_H = 1080;
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const isWin = process.platform === 'win32';

const log = (msg) => process.stdout.write(`${msg}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. Data
// ---------------------------------------------------------------------------

function jh(...cliArgs) {
  const result = spawnSync(
    'pnpm',
    [
      '--silent',
      '--filter',
      '@jobhunt-hq/core',
      'jh',
      ...cliArgs,
      '--db',
      db,
      '--config-dir',
      configDir,
      '--master',
      join(root, 'data/examples/master.json'),
    ],
    { cwd: root, encoding: 'utf8', shell: isWin },
  );
  return {
    code: result.status ?? 1,
    out: (result.stdout ?? '').trim(),
    err: (result.stderr ?? '').trim(),
  };
}

function seed() {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(configDir, { recursive: true });
  for (const name of ['profile', 'rules']) {
    copyFileSync(join(root, 'config', `${name}.example.yaml`), join(configDir, `${name}.yaml`));
  }
  const added = jh('add-jobs', 'data/examples/jobs.json', '--focus', 'demo');
  if (added.code !== 0) throw new Error(`add-jobs failed:\n${added.out}\n${added.err}`);

  jh('set-status', 'acme-health-full-stack-engineer-eu', 'Applied', '--follow-up', '2026-10-21');
  jh('note', 'acme-health-full-stack-engineer-eu', 'Applied through Greenhouse; CV v2.');
  jh('set-status', 'globex-robotics-ai-engineer-berlin', 'Applied');
  jh(
    'set-status',
    'globex-robotics-ai-engineer-berlin',
    'Responded',
    '--note',
    'Recruiter call booked',
  );
  jh('set-status', 'hooli-software-engineer-applied-ai-amsterdam', 'Interview');
  jh(
    'set-status',
    'vandelay-research-research-software-engineer-lisbon',
    'Rejected',
    '--note',
    'Position filled',
  );

  // A real tailor and pack, so the job page has artifacts and a verify list.
  const spec = join(workDir, 'acme.variant.json');
  writeFileSync(
    spec,
    JSON.stringify({
      title: 'Full Stack Engineer | TypeScript, React, Node.js, PostgreSQL',
      summary: 'Full stack engineer who builds scheduling software for clinics, end to end.',
      skills: { order: ['Frontend', 'Backend', 'Data & Cloud'] },
      projects: { order: ['ProjectA'], max: 2 },
    }),
  );
  const tailored = jh(
    'tailor',
    'acme-health-full-stack-engineer-eu',
    '--variant',
    spec,
    '--no-pdf',
  );
  if (tailored.code !== 0) throw new Error(`tailor failed:\n${tailored.out}\n${tailored.err}`);
  const pack = join(workDir, 'acme.pack.json');
  writeFileSync(
    pack,
    JSON.stringify({
      coverNote: [
        'I am applying for the Full Stack Engineer role at Acme Health.',
        'At Example SaaS Ltd I built a multi-tenant scheduling product on Next.js, NestJS and PostgreSQL used by 200 clinics.',
        'I would welcome a conversation about the role.',
      ],
      whyThisRole: ['Same stack as the scheduling product at Example SaaS Ltd.'],
    }),
  );
  const packed = jh('pack', 'acme-health-full-stack-engineer-eu', '--from', pack);
  if (packed.code !== 0) throw new Error(`pack failed:\n${packed.out}\n${packed.err}`);
  return added.out;
}

// ---------------------------------------------------------------------------
// 2. Dashboard
// ---------------------------------------------------------------------------

function build() {
  log('Building the dashboard...');
  const r = spawnSync('pnpm', ['build'], { cwd: root, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) throw new Error('dashboard build failed');
}

async function startServer() {
  const nextBin = join(root, 'apps/dashboard/node_modules/next/dist/bin/next');
  const child = spawn(process.execPath, [nextBin, 'start', '--port', String(PORT)], {
    cwd: join(root, 'apps/dashboard'),
    env: { ...process.env, JH_DB: db, NODE_ENV: 'production' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return child;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  child.kill();
  throw new Error(`dashboard did not start on ${BASE}`);
}

// ---------------------------------------------------------------------------
// 3. Cinematography helpers
// ---------------------------------------------------------------------------

const NAVY = '#0b1730';
const ACCENT = '#1f3864';

/** Injected into every document: a visible cursor, click ripples and a fade-in from navy. */
const INIT_SCRIPT = `
(() => {
  const install = () => {
    if (document.getElementById('__cur')) return;
    const style = document.createElement('style');
    style.textContent = \`
      #__cur { position: fixed; left: 0; top: 0; width: 20px; height: 20px; z-index: 2147483647;
        pointer-events: none; transform: translate(-200px, -200px); filter: drop-shadow(0 2px 4px rgba(0,0,0,.35)); }
      .__ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 12px; height: 12px;
        margin: -6px 0 0 -6px; border-radius: 50%; border: 2px solid ${ACCENT}; opacity: .9;
        animation: __rip .6s ease-out forwards; }
      @keyframes __rip { to { transform: scale(4); opacity: 0; } }
      #__fade { position: fixed; inset: 0; background: ${NAVY}; z-index: 2147483645; pointer-events: none;
        opacity: 1; transition: opacity .55s ease; }
      #__cap { position: fixed; left: 50%; bottom: 34px; transform: translate(-50%, 12px); z-index: 2147483644;
        max-width: 960px; padding: 12px 24px; border-radius: 12px; background: rgba(11,23,48,.93); color: #fff;
        font: 600 21px/1.3 'Segoe UI', system-ui, sans-serif; letter-spacing: -.01em; text-align: center;
        opacity: 0; transition: opacity .45s ease, transform .45s ease; pointer-events: none;
        box-shadow: 0 14px 40px rgba(11,23,48,.35); }
      #__cap.on { opacity: 1; transform: translate(-50%, 0); }
      #__cap.top { top: 22px; bottom: auto; }
      #__cap small { display: block; margin-top: 3px; font-weight: 400; font-size: 14.5px; color: #c7d2fe; }
    \`;
    document.documentElement.appendChild(style);
    const cur = document.createElement('div');
    cur.id = '__cur';
    cur.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 2 L4 20 L9 15.5 L12.5 22 L15.5 20.6 L12.1 14.2 L19 14 Z" fill="#fff" stroke="#0b1730" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(cur);
    const fade = document.createElement('div');
    fade.id = '__fade';
    document.documentElement.appendChild(fade);
    requestAnimationFrame(() => requestAnimationFrame(() => { fade.style.opacity = '0'; }));
    setTimeout(() => fade.remove(), 800);
    addEventListener('mousemove', (e) => { cur.style.transform = \`translate(\${e.clientX - 3}px, \${e.clientY - 2}px)\`; }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.className = '__ripple';
      r.style.left = e.clientX + 'px';
      r.style.top = e.clientY + 'px';
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 700);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
`;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

class Director {
  constructor(page) {
    this.page = page;
    this.x = W / 2;
    this.y = H / 2;
  }

  /** Eased cursor move. */
  async move(x, y, ms = 700) {
    const steps = Math.max(8, Math.round(ms / 16));
    const sx = this.x;
    const sy = this.y;
    for (let i = 1; i <= steps; i++) {
      const e = ease(i / steps);
      await this.page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
      await sleep(ms / steps);
    }
    this.x = x;
    this.y = y;
  }

  async center(locator) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('element not visible');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
  }

  async moveTo(locator, ms = 700, dx = 0, dy = 0) {
    const { x, y } = await this.center(locator);
    await this.move(x + dx, y + dy, ms);
  }

  async click(locator, ms = 650) {
    await this.moveTo(locator, ms);
    await sleep(110);
    await this.page.mouse.down();
    await sleep(70);
    await this.page.mouse.up();
  }

  /** Re-shows the cursor where it was after a navigation. */
  async park() {
    await this.page.mouse.move(this.x, this.y);
  }

  async goto(url) {
    await this.fadeOut();
    await this.page.goto(url, { waitUntil: 'networkidle' });
    await this.park();
    await sleep(600);
  }

  async fadeOut(ms = 420) {
    await this.page.evaluate((ms) => {
      const f = document.createElement('div');
      f.style.cssText = `position:fixed;inset:0;background:#0b1730;opacity:0;z-index:2147483645;transition:opacity ${ms}ms ease;pointer-events:none`;
      document.documentElement.appendChild(f);
      requestAnimationFrame(() => requestAnimationFrame(() => (f.style.opacity = '1')));
    }, ms);
    await sleep(ms + 60);
  }

  async caption(text, sub = '', top = false) {
    await this.page.evaluate(
      ({ text, sub, top }) => {
        let el = document.getElementById('__cap');
        if (!el) {
          el = document.createElement('div');
          el.id = '__cap';
          document.documentElement.appendChild(el);
        }
        el.classList.remove('on');
        setTimeout(
          () => {
            el.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
            el.classList.toggle('top', top);
            el.classList.add('on');
          },
          el.textContent ? 250 : 0,
        );
      },
      { text, sub, top },
    );
    await sleep(500);
  }

  async smoothScrollTo(y, ms = 1200) {
    await this.page.evaluate(
      ({ y, ms }) =>
        new Promise((done) => {
          const start = window.scrollY;
          const t0 = performance.now();
          const step = (now) => {
            const t = Math.min(1, (now - t0) / ms);
            const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            window.scrollTo(0, start + (y - start) * e);
            if (t < 1) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        }),
      { y, ms },
    );
  }

  /** A full-screen title card with a staggered entrance. */
  async card({ kicker = '', title, sub = '', foot = '', hold = 2600 }) {
    await this.fadeOut(340);
    await this.page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;height:100%;overflow:hidden}
      body{display:flex;align-items:center;justify-content:center;
        background:radial-gradient(900px 520px at 30% 20%, #23407a 0%, ${NAVY} 60%, #060d1d 100%);
        color:#fff;font-family:'Segoe UI',system-ui,sans-serif}
      .wrap{text-align:center;max-width:1040px;padding:0 60px;position:relative}
      .k{font-size:17px;letter-spacing:.32em;text-transform:uppercase;color:#93a8d8;opacity:0;animation:up .8s .1s ease forwards}
      h1{font-size:84px;line-height:1.02;margin:18px 0 0;font-weight:700;letter-spacing:-.035em;opacity:0;animation:up .9s .25s ease forwards}
      .s{font-size:27px;line-height:1.38;color:#dbe4fb;margin-top:22px;font-weight:400;opacity:0;animation:up .9s .55s ease forwards}
      .f{font-size:18px;color:#93a8d8;margin-top:40px;opacity:0;animation:up .9s .9s ease forwards}
      .bar{width:0;height:3px;background:#5b8def;margin:28px auto 0;border-radius:2px;animation:bar 1.1s .45s ease forwards}
      .glow{position:fixed;inset:-20%;background:radial-gradient(420px 280px at 70% 80%, rgba(91,141,239,.2), transparent 70%);animation:drift 9s ease-in-out infinite alternate}
      @keyframes up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
      @keyframes bar{to{width:120px}}
      @keyframes drift{to{transform:translate(-6%,-4%) scale(1.08)}}
    </style></head><body><div class="glow"></div><div class="wrap">
      ${kicker ? `<div class="k">${kicker}</div>` : ''}
      <h1>${title}</h1><div class="bar"></div>
      ${sub ? `<div class="s">${sub}</div>` : ''}
      ${foot ? `<div class="f">${foot}</div>` : ''}
    </div></body></html>`);
    await this.page.mouse.move(-50, -50);
    await sleep(hold);
  }

  /** A terminal window that types a command and prints real CLI output. */
  async terminal({ title, command, output, note = '', hold = 3000 }) {
    await this.fadeOut(340);
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await this.page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;height:100%;overflow:hidden}
      body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;
        background:radial-gradient(900px 520px at 70% 10%, #23407a 0%, ${NAVY} 60%, #060d1d 100%);font-family:'Segoe UI',system-ui,sans-serif}
      .h{color:#fff;font-size:29px;font-weight:700;letter-spacing:-.02em}
      .win{width:1200px;border-radius:12px;background:#0d1117;box-shadow:0 30px 90px rgba(0,0,0,.55);overflow:hidden;border:1px solid #30363d}
      .tb{height:30px;background:#161b22;display:flex;align-items:center;gap:7px;padding:0 12px}
      .d{width:10px;height:10px;border-radius:50%}
      .tt{color:#8b949e;font-size:12px;margin-left:10px}
      pre{margin:0;padding:18px 22px 24px;color:#c9d1d9;font:11.2px/1.55 'Cascadia Mono','Consolas',monospace;white-space:pre;min-height:300px}
      .p{color:#7ee787}.c{color:#fff}.o{color:#c9d1d9}.dim{color:#8b949e}
      .caret{display:inline-block;width:7px;height:14px;background:#c9d1d9;vertical-align:-3px;animation:b 1s steps(1) infinite}
      @keyframes b{50%{opacity:0}}
      .n{color:#c7d2fe;font-size:19px;opacity:0;transition:opacity .6s ease}
    </style></head><body>
      <div class="h">${esc(title)}</div>
      <div class="win"><div class="tb"><span class="d" style="background:#ff5f56"></span><span class="d" style="background:#ffbd2e"></span><span class="d" style="background:#27c93f"></span><span class="tt">jobhunt-hq</span></div>
      <pre id="t"><span class="p">$ </span><span class="c" id="cmd"></span><span class="caret" id="caret"></span></pre></div>
      <div class="n" id="note">${esc(note)}</div>
    </body></html>`);
    await this.page.mouse.move(-50, -50);
    await sleep(450);
    for (const ch of command) {
      await this.page.evaluate((ch) => (document.getElementById('cmd').textContent += ch), ch);
      await sleep(34);
    }
    await sleep(300);
    await this.page.evaluate(() => document.getElementById('caret').remove());
    for (const line of output.split('\n')) {
      await this.page.evaluate(
        ({ line, dim }) => {
          const pre = document.getElementById('t');
          const span = document.createElement('span');
          span.className = dim ? 'dim' : 'o';
          span.textContent = `\n${line}`;
          pre.appendChild(span);
        },
        { line, dim: /^-+(\s+-+)*$/.test(line.trim()) },
      );
      await sleep(45);
    }
    await this.page.evaluate(() => (document.getElementById('note').style.opacity = '1'));
    await sleep(hold);
  }
}

// ---------------------------------------------------------------------------
// 4. Recording (Chrome screencast frames -> H.264)
// ---------------------------------------------------------------------------

async function startScreencast(page) {
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = `f${String(frames.length).padStart(6, '0')}.jpg`;
    writeFileSync(join(framesDir, file), Buffer.from(data, 'base64'));
    frames.push({ file, ts: metadata.timestamp });
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId });
    } catch {
      // session closing
    }
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 95,
    maxWidth: OUT_W,
    maxHeight: OUT_H,
    everyNthFrame: 1,
  });
  return async () => {
    await cdp.send('Page.stopScreencast');
    return frames;
  };
}

function encode(frames) {
  if (frames.length < 2) throw new Error('no frames captured');
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const next = frames[i + 1];
    const duration = next ? Math.max(0.001, next.ts - frames[i].ts) : 1.2;
    lines.push(`file '${frames[i].file}'`, `duration ${duration.toFixed(4)}`);
  }
  lines.push(`file '${frames[frames.length - 1].file}'`);
  writeFileSync(join(framesDir, 'list.txt'), lines.join('\n'));
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    ffmpeg,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'list.txt',
      '-vf',
      `fps=30,scale=${OUT_W}:${OUT_H}:flags=lanczos,format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '17',
      '-profile:v',
      'high',
      '-movflags',
      '+faststart',
      mp4,
    ],
    { cwd: framesDir, stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error('ffmpeg failed (is ffmpeg on PATH, or FFMPEG set?)');
}

function makeGif() {
  mkdirSync(dirname(gif), { recursive: true });
  const filters =
    'fps=7,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle';
  const r = spawnSync(
    ffmpeg,
    ['-y', '-hide_banner', '-loglevel', 'error', '-i', mp4, '-vf', filters, '-loop', '0', gif],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error('gif encode failed');
}

// ---------------------------------------------------------------------------
// 5. The film
// ---------------------------------------------------------------------------

async function film(page, d, addJobsOutput) {
  // Intro
  await d.card({
    kicker: 'Open source  ·  Claude Code native',
    title: 'JobHunt HQ',
    sub: 'Find roles you can actually get. Tailor every CV truthfully.<br>Fill the form. <b>You</b> submit.',
    hold: 3300,
  });

  // Search and score
  await d.card({
    kicker: 'Step 1',
    title: 'Search, dedupe, score',
    sub: 'Parallel scouts on official careers pages and public ATS boards',
    hold: 1700,
  });
  await d.terminal({
    title: 'Scouted rows go through the CLI: validated, deduped, scored',
    command: 'pnpm jh add-jobs data/scout/results.json',
    output: addJobsOutput,
    note: 'Hard blockers mean Skipped, not a low score: here 7+ years asked, and citizenship plus clearance.',
    hold: 2800,
  });

  // Table
  await d.goto(`${BASE}/`);
  await d.caption(
    'Every role scored 0 to 5, with why it fits and the main gap',
    'One local SQLite tracker, shared by the CLI and the dashboard',
  );
  const rows = page.locator('tbody tr');
  await d.moveTo(rows.nth(0).locator('td').nth(7), 800);
  await sleep(700);
  await d.moveTo(rows.nth(6).locator('td').nth(7), 800);
  await sleep(800);
  const minScore = page.locator('input[name="minScore"]');
  await d.click(minScore);
  await minScore.pressSequentially('4.5', { delay: 140 });
  await sleep(250);
  await d.caption('Filter by score, status, region, remote, batch');
  await d.click(page.getByRole('button', { name: 'Filter' }));
  await page.waitForLoadState('networkidle');
  await d.park();
  await sleep(1600);

  // Board
  await d.goto(`${BASE}/board`);
  await d.caption('Drag a card to change its status', 'Every move is written to the job timeline');
  const card = page.locator('article', { hasText: 'Forward Deployed Engineer' });
  const target = page.locator('section', { hasText: /^Applied/ }).first();
  const from = await d.center(card);
  const to = await d.center(target);
  await d.move(from.x, from.y - 8, 850);
  await sleep(220);
  await page.mouse.down();
  await d.move(from.x + 30, from.y + 22, 280);
  await d.move(to.x, to.box.y + 170, 1200);
  await sleep(180);
  await page.mouse.up();
  // Hold until the server action has run and the board shows the card in its new column.
  await page
    .locator('section', { hasText: /^Applied/ })
    .first()
    .locator('article', { hasText: 'Forward Deployed Engineer' })
    .waitFor({ timeout: 15_000 });
  await d.move(to.x + 60, to.box.y + 250, 600);
  await sleep(1500);

  // Job page with verify list
  await d.goto(`${BASE}/jobs/acme-health-full-stack-engineer-eu`);
  await d.caption('Tailored CV, cover letter and pack, generated from your master CV');
  await d.moveTo(page.getByText('Why it fits', { exact: true }), 800, 90, 18);
  await sleep(900);
  const verify = page.getByText('Verify before sending', { exact: true });
  const vbox = await verify.boundingBox();
  if (vbox) await d.smoothScrollTo(Math.max(0, vbox.y - 220), 1300);
  await d.caption(
    'Anything not in your master CV is flagged for you to verify',
    'A claim-checker agent reviews every sentence too',
  );
  await d.moveTo(verify, 800, 40, 28);
  await sleep(2400);

  // Apply assist on the local fixture form
  await d.card({
    kicker: 'Step 2',
    title: 'Fill the form.<br>Never submit.',
    sub: 'Known fields from your profile, rules and pack.<br>Uploads, consent and Submit stay with you.',
    hold: 2400,
  });
  await fillFixture(page, d);

  // Stats
  await d.goto(`${BASE}/stats`);
  await d.caption('Your funnel, and which sources actually respond');
  await d.moveTo(page.getByRole('heading', { name: 'Funnel' }), 700, 150, 90);
  await sleep(900);
  await d.moveTo(page.getByRole('heading', { name: 'By source' }), 800, 100, 70);
  await sleep(1700);

  // Outro
  await d.card({
    kicker: 'v0.1.0  ·  MIT licensed',
    title: 'JobHunt HQ',
    sub: 'github.com/teeps-heisenberg/jobhunt-hq',
    foot: 'Local first. No auto-apply. No invented claims. Built with Claude Code.',
    hold: 4200,
  });
}

const FIXTURE_CSS = `
  body{margin:0;background:#f1f5f9;font-family:'Segoe UI',system-ui,sans-serif;color:#0f172a}
  .__hdr{background:#fff;border-bottom:1px solid #e2e8f0;padding:14px 0;text-align:center;font-size:13px;color:#64748b}
  .__hdr b{color:#0f172a}
  h1{max-width:640px;margin:26px auto 4px;font-size:30px;letter-spacing:-.02em}
  form{max-width:640px;margin:14px auto 220px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:26px 32px;box-shadow:0 10px 30px rgba(15,23,42,.06)}
  label{display:block;font-weight:600;font-size:13.5px;margin:14px 0 5px}
  input[type=text],input[type=email],input[type=tel],textarea{width:100%;box-sizing:border-box;font:13.5px 'Segoe UI',system-ui;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff}
  textarea{min-height:76px}
  input[type=file]{font-size:13px}
  input:focus,textarea:focus{outline:3px solid #bfdbfe;border-color:#3b82f6}
  button{margin-top:22px;font:600 16px 'Segoe UI',system-ui;padding:11px 22px;border-radius:9px;border:0;background:#16a34a;color:#fff}
  .__left{outline:3px dashed #f59e0b !important;outline-offset:4px;border-radius:6px}
  .__never{outline:4px solid #e11d48 !important;outline-offset:5px}
  .__tag{display:table;margin:7px 0 0;font:700 11px 'Segoe UI',system-ui;letter-spacing:.04em;text-transform:uppercase;padding:4px 9px;border-radius:999px;background:#fef3c7;color:#92400e}
  .__tag.__red{display:inline-block;background:#ffe4e6;color:#9f1239;font-size:13px;margin-left:14px;vertical-align:middle}
`;

async function fillFixture(page, d) {
  const profile = loadProfile(join(root, 'config/profile.example.yaml'));
  const rules = loadRules(join(root, 'config/rules.example.yaml'));
  const plan = buildApplyPlan({
    job: {
      id: 'acme-health-full-stack-engineer-eu',
      company: 'Acme Health',
      role: 'Full Stack Engineer',
      location: 'Remote - EU',
      region: 'EU',
      remote: true,
      url: 'https://boards.greenhouse.io/acmehealth/jobs/4001',
      applyUrl: null,
    },
    profile,
    rules,
    coverNote: [
      'I am applying for the Full Stack Engineer role at Acme Health.',
      'At Example SaaS Ltd I built a multi-tenant scheduling product used by 200 clinics.',
    ],
    cvPath: 'output/acme-health/full-stack-engineer/cv.pdf',
  });

  await d.fadeOut(340);
  await page.goto(pathToFileURL(join(root, 'tests/apply/fixtures/greenhouse.html')).href);
  await page.addStyleTag({ content: FIXTURE_CSS });
  await page.evaluate(() => {
    const h = document.createElement('div');
    h.className = '__hdr';
    h.innerHTML = '<b>Local test form</b> · Greenhouse-style fixture from tests/apply';
    document.body.prepend(h);
  });
  await d.park();
  await sleep(600);
  await d.caption(
    'Filling from your profile, rules and pack',
    'Same rules as the Playwright test in tests/apply',
    true,
  );

  const controls = page.locator('input, textarea, select, button');
  const infos = await controls.evaluateAll((nodes) =>
    nodes.map((el, index) => {
      const id = el.id;
      const labelFor = id
        ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent
        : '';
      const parts = [
        labelFor,
        el.closest('label')?.textContent,
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
          .filter(Boolean)
          .map((p) => p.replace(/\s+/g, ' ').trim())
          .join(' | '),
      };
    }),
  );
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
  const leftForYou = [];
  for (const info of infos) {
    const control = controls.nth(info.index);
    const forbidden =
      info.tag === 'button' ||
      NEVER_TYPES.has(info.type) ||
      isForbidden(`${info.descriptor} | type=${info.type}`, plan.never);
    const field = forbidden ? undefined : matchField(info.descriptor, plan.fields);
    if (!field) {
      leftForYou.push({ control, info });
      continue;
    }
    await control.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await sleep(380);
    await d.click(control, 420);
    const long = field.value.length > 60;
    await control.pressSequentially(field.value, { delay: long ? 4 : 28 });
    await sleep(120);
  }

  // Mark what the kit leaves alone.
  for (const { control, info } of leftForYou) {
    const isSubmit = info.tag === 'button' || info.type === 'submit';
    const text = isSubmit
      ? 'Never clicked by the kit'
      : info.type === 'file'
        ? 'You attach'
        : info.type === 'checkbox'
          ? 'You decide'
          : 'Never filled';
    await control.evaluate(
      (el, { text, isSubmit }) => {
        const target = el.type === 'checkbox' ? (el.closest('label') ?? el) : el;
        target.classList.add(isSubmit ? '__never' : '__left');
        const tag = document.createElement(isSubmit ? 'span' : 'div');
        tag.className = isSubmit ? '__tag __red' : '__tag';
        tag.textContent = text;
        target.insertAdjacentElement('afterend', tag);
      },
      { text, isSubmit },
    );
  }
  const submit = page.locator('button');
  await submit.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await sleep(700);
  await d.caption(
    'Uploads, consent and Submit stay with you',
    'A Playwright test asserts Submit is never clicked on Greenhouse, Lever and Ashby forms',
    true,
  );
  // Hover near Submit, below the tag, so both stay readable. Never click.
  await d.moveTo(submit, 1000, 40, 62);
  await sleep(3000);
  const clicked = await page.evaluate(() =>
    Boolean(window.__submitClicked || window.__submitted || window.__consentClicked),
  );
  if (clicked) {
    throw new Error('the fixture reports a click on Submit or consent: refusing to keep this take');
  }
}

// ---------------------------------------------------------------------------

async function main() {
  log('Seeding data/video from data/examples...');
  const addJobsOutput = seed();
  if (!args.has('--skip-build')) build();
  log(`Starting the dashboard on ${BASE}...`);
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: SCALE,
      colorScheme: 'light',
    });
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();
    const d = new Director(page);
    await page.setContent(`<html><body style="margin:0;background:${NAVY}"></body></html>`);
    await sleep(300);
    const stop = await startScreencast(page);
    log('Recording...');
    await film(page, d, addJobsOutput);
    const frames = await stop();
    const seconds = (frames.at(-1).ts - frames[0].ts).toFixed(1);
    log(`Captured ${frames.length} frames over ${seconds}s. Encoding...`);
    encode(frames);
    log(`Wrote ${mp4} (${(statSync(mp4).size / 1e6).toFixed(1)} MB)`);
    if (args.has('--gif')) {
      makeGif();
      log(`Wrote ${gif} (${(statSync(gif).size / 1e6).toFixed(1)} MB)`);
    }
  } finally {
    await browser.close();
    server.kill();
    if (!args.has('--keep-frames')) rmSync(framesDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
