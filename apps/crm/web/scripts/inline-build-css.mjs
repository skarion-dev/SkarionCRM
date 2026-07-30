import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distributionDirectory = resolve(projectDirectory, 'dist');
const indexPath = resolve(distributionDirectory, 'index.html');

let html = await readFile(indexPath, 'utf8');
const stylesheetTags = html
  .match(/<link\b[^>]*>/giu)
  ?.filter((tag) => /\brel=(["'])stylesheet\1/iu.test(tag)) ?? [];

if (stylesheetTags.length === 0) {
  throw new Error('CRM build did not emit a stylesheet link to inline.');
}

for (const tag of stylesheetTags) {
  const href = tag.match(/\bhref=(["'])(?<href>[^"']+)\1/iu)?.groups?.href;
  if (!href || /^(?:data:|https?:)?\/\//iu.test(href)) {
    throw new Error(`Cannot inline CRM stylesheet without a local href: ${tag}`);
  }

  const stylesheetPath = resolve(distributionDirectory, href.replace(/^\/+/u, ''));
  if (!stylesheetPath.startsWith(`${distributionDirectory}${sep}`)) {
    throw new Error(`Refusing to inline stylesheet outside the CRM build: ${href}`);
  }

  const css = (await readFile(stylesheetPath, 'utf8')).replace(/<\/style/giu, '<\\/style');
  html = html.replace(
    tag,
    `<style data-inline-build-css="${href}">${css}</style>`,
  );
}

await writeFile(indexPath, html, 'utf8');
