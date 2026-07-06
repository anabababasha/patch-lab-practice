import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Design } from '../src/lib/types';
import { designToUrl } from '../src/lib/share';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corpusDir = path.join(__dirname, 'corpus');

type CorpusDesign = Design & { nodes: Design['nodes'] };

const fixtures = readdirSync(corpusDir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => {
    const file = path.join(corpusDir, name);
    return {
      name,
      design: JSON.parse(readFileSync(file, 'utf8')) as CorpusDesign,
    };
  });

test('normal boot renders without a shared fragment', async ({ page, baseURL }) => {
  await page.goto(baseURL!);
  await expect(page.locator('.pl-topbar')).toBeVisible();
  await expect(page.getByLabel('Design name')).toBeVisible();
});

for (const fixture of fixtures) {
  test(`opens corpus fixture: ${fixture.name}`, async ({ page, baseURL }) => {
    const consoleFailures: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
      const text = msg.text();
      if (/sanitizeDesign:|\[bind\]/.test(text)) consoleFailures.push(text);
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(designToUrl(fixture.design, baseURL!));

    await expect(page.getByLabel('Design name')).toHaveValue(fixture.design.name);
    await expect(page.locator('.react-flow__node')).toHaveCount(fixture.design.nodes.length);

    expect(consoleFailures).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}
