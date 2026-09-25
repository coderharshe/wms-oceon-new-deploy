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
    } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
      pages.push(full);
    }
  }
  return pages;
}

const allTsFiles = walkDir('./src');
console.log('Total TS/TSX source files:', allTsFiles.length);

const apiCalls = new Set<string>();
const internalLinks = new Set<string>();

for (const file of allTsFiles) {
  const content = fs.readFileSync(file, 'utf8');
  
  const apiMatches = content.matchAll(/["'`](\/api\/[^"'`$]+)["'`]/g);
  for (const m of apiMatches) {
    if (m[1]) {
      const part = m[1].split('?')[0];
      if (part) apiCalls.add(part);
    }
  }
  
  const linkMatches = content.matchAll(/href=["'`](\/[^"'`$]+)["'`]/g);
  for (const m of linkMatches) {
    if (m[1] && !m[1].startsWith('/api') && !m[1].startsWith('/fonts')) {
      const first = m[1].split('?')[0];
      const part = first ? first.split('#')[0] : undefined;
      if (part) internalLinks.add(part);
    }
  }
  const routerMatches = content.matchAll(/router\.push\(["'`](\/[^"'`$]+)["'`]\)/g);
  for (const m of routerMatches) {
    if (m[1] && !m[1].startsWith('/api') && !m[1].startsWith('/fonts')) {
      const first = m[1].split('?')[0];
      const part = first ? first.split('#')[0] : undefined;
      if (part) internalLinks.add(part);
    }
  }
}

function getApiRoutes(dir: string, base: string = '/api'): string[] {
  let routes: string[] = [];
  if (!fs.existsSync(dir)) return routes;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = `${base}/${entry.name}`;
    if (entry.isDirectory()) {
      routes = routes.concat(getApiRoutes(full, rel));
    } else if (entry.name === 'route.ts' || entry.name === 'route.js') {
      routes.push(base);
    }
  }
  return routes;
}

const registeredApiRoutes = getApiRoutes('./src/app/api');
const apiRouteSet = new Set(registeredApiRoutes);

console.log('\n--- Checking API Endpoints Called in UI ---');
const missingApis: string[] = [];
for (const api of Array.from(apiCalls)) {
  if (apiRouteSet.has(api)) continue;
  let matched = false;
  for (const ar of registeredApiRoutes) {
    if (ar.includes('[')) {
      const regexStr = '^' + ar.replace(/\[\.\.\.[^\]]+\]/g, '.*').replace(/\[[^\]]+\]/g, '[^/]+') + '$';
      if (new RegExp(regexStr).test(api)) {
        matched = true;
        break;
      }
    }
  }
  if (!matched) {
    missingApis.push(api);
  }
}
console.log('Potentially missing API endpoints:', missingApis);

function getPageRoutes(dir: string, base: string = ''): string[] {
  let routes: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = `${base}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== 'api' && entry.name !== 'fonts') {
        routes = routes.concat(getPageRoutes(full, rel));
      }
    } else if (entry.name.startsWith('page.')) {
      routes.push(base === '' ? '/' : base);
    }
  }
  return routes;
}

const registeredPages = getPageRoutes('./src/app');
const pageSet = new Set(registeredPages);

console.log('\n--- Checking UI Links in Codebase ---');
const missingPages: string[] = [];
for (const link of Array.from(internalLinks)) {
  if (pageSet.has(link)) continue;
  let matched = false;
  for (const pr of registeredPages) {
    if (pr.includes('[')) {
      const regexStr = '^' + pr.replace(/\[\.\.\.[^\]]+\]/g, '.*').replace(/\[[^\]]+\]/g, '[^/]+') + '$';
      if (new RegExp(regexStr).test(link)) {
        matched = true;
        break;
      }
    }
  }
  if (!matched) {
    missingPages.push(link);
  }
}
console.log('Potentially missing UI Pages for links:', missingPages);
