import fs from 'fs';
import path from 'path';

function walkDir(dir: string): string[] {
  let pages: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'api' && entry.name !== 'fonts' && entry.name !== 'node_modules') {
        pages = pages.concat(walkDir(full));
      }
    } else if (entry.name === 'page.tsx' || entry.name === 'page.jsx' || entry.name === 'page.js') {
      pages.push(full);
    }
  }
  return pages;
}

const allPages = walkDir('./src/app');
console.log('Found', allPages.length, 'pages.');

function extractLinks(dir: string): string[] {
  let links = new Set<string>();
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'api' && entry.name !== 'fonts' && entry.name !== 'node_modules') {
        extractLinks(full).forEach((l) => links.add(l));
      }
    } else if (/\.(tsx|jsx|ts|js)$/.test(entry.name)) {
      const content = fs.readFileSync(full, 'utf8');
      const hrefRegex = /href=["'`](\/[^"'`$]+)["'`]/g;
      let m: RegExpExecArray | null;
      while ((m = hrefRegex.exec(content)) !== null) {
        if (m[1]) {
          const first = m[1].split('?')[0];
          const part = first ? first.split('#')[0] : undefined;
          if (part) links.add(part);
        }
      }
      const routerRegex = /router\.push\(["'`](\/[^"'`$]+)["'`]\)/g;
      while ((m = routerRegex.exec(content)) !== null) {
        if (m[1]) {
          const first = m[1].split('?')[0];
          const part = first ? first.split('#')[0] : undefined;
          if (part) links.add(part);
        }
      }
    }
  }
  return Array.from(links);
}

const allHrefs = extractLinks('./src');
console.log('Total static internal hrefs extracted:', allHrefs.length);

const pageRouteSet = new Set(
  allPages.map((p) => {
    let r = p.replace(/^[\\\/]?src[\\\/]app/, '').replace(/[\\\/]page\.(tsx|jsx|js)$/, '').replace(/\\/g, '/');
    return r === '' ? '/' : r;
  })
);

console.log('\n--- Registered Page Routes ---');
Array.from(pageRouteSet)
  .sort()
  .forEach((r) => console.log('  ', r));

console.log('\n--- Checking Hrefs against Page Routes ---');
const missing: string[] = [];
for (const href of allHrefs) {
  if (href.startsWith('/api') || href.startsWith('/fonts') || href === '/') continue;
  if (!pageRouteSet.has(href)) {
    let matched = false;
    for (const pr of pageRouteSet) {
      if (pr.includes('[')) {
        const regexStr = '^' + pr.replace(/\[\.\.\.[^\]]+\]/g, '.*').replace(/\[[^\]]+\]/g, '[^/]+') + '$';
        if (new RegExp(regexStr).test(href)) {
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      missing.push(href);
    }
  }
}
console.log('Potentially missing page routes for linked hrefs:', missing);
