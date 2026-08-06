import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp, extractDocumentTitle, getAllowedPrefixes, getBrowseRoot, setDraftStatus } from '../src/server';
import fs from 'fs';
import path from 'path';

process.env.EDITOR_TOKEN = 'test-token-12345';
process.env.NOTION_ACCESS_TOKEN = 'fake-notion-token';

const testContentDir = '/tmp/markdown-content-editor-test-content';
const testFile = path.join(testContentDir, '__test-editor-roundtrip.md');
const testPublicDir = '/tmp/markdown-content-editor-public';
const testImageDir = path.join(testPublicDir, 'images', 'blog');
const testImage = path.join(testImageDir, 'preview.webp');
const testBrowseRoot = path.join(testContentDir, 'blog');
const testBrowsePostDir = path.join(testBrowseRoot, 'first-post');
process.env.EDITOR_ALLOWED_PREFIXES = testContentDir;
process.env.EDITOR_PUBLIC_DIR = testPublicDir;
process.env.EDITOR_BROWSE_ROOT = testBrowseRoot;
fs.mkdirSync(testContentDir, { recursive: true });
fs.mkdirSync(testImageDir, { recursive: true });
fs.mkdirSync(testBrowsePostDir, { recursive: true });
fs.writeFileSync(testImage, Buffer.from('fake-webp-image'));
fs.writeFileSync(path.join(testPublicDir, 'images', 'secret.txt'), 'not public through blog route');
fs.writeFileSync(path.join(testBrowsePostDir, 'index.md'), `---
title: "First Searchable Post"
draft: true
---

![Preview image](/images/blog/preview.webp)
`);
fs.writeFileSync(path.join(testBrowseRoot, 'second.md'), '# Second Searchable Post');
fs.writeFileSync(path.join(testBrowseRoot, 'ignored.txt'), 'not Markdown');

const app = createApp();

afterAll(() => {
  fs.rmSync(testContentDir, { recursive: true, force: true });
  fs.rmSync(testPublicDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Markdown Content Editor API', () => {
  it('serves a responsive wide desktop editor layout', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('width: min(96vw, 2200px);');
    expect(res.text).toContain('padding: 24px clamp(12px, 1.5vw, 32px) 32px;');
    expect(res.text).toContain('DOMPurify.sanitize');
    expect(res.text).toContain("sessionStorage.getItem('editor_token')");
    expect(res.text).toContain("localStorage.getItem('editor_token')");
    expect(res.text).toContain('id="remember-token"');
    expect(res.text).toContain('id="show-token"');
    expect(res.text).toContain('Show token');
    expect(res.text).toContain("input.type = show ? 'text' : 'password'");
    expect(res.text).toContain('Remember on this device');
    expect(res.text).toContain('Do not enable this on a shared device');
    expect(res.text).toContain('width: min(420px, calc(100vw - 32px));');
    expect(res.text).toContain('name="editor-token"');
    expect(res.text).toContain('autocomplete="current-password"');
    expect(res.text).toContain("font-size: 16px;");
    expect(res.text).toContain("localStorage.removeItem('editor_token')");
    expect(res.text).toContain('integrity="sha384-');
  });

  it('serves a mobile header and accessible SVG toolbar controls', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('@media (max-width: 700px)');
    expect(res.text).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(res.text).toContain('display: contents;');
    expect(res.text).toContain('min-width: 0;');
    expect(res.text).toContain('flex-wrap: wrap;');
    expect(res.text).toContain('overflow-x: visible;');
    expect(res.text).toContain('-webkit-overflow-scrolling: auto;');
    expect(res.text).toContain('display: none;');
    expect(res.text).toContain('min-width: 44px;');
    expect(res.text).toContain('--toolbar-icon: url("data:image/svg+xml,');
    expect(res.text).toContain('mask: var(--toolbar-icon) center / 18px 18px no-repeat;');
    expect(res.text.match(/--toolbar-icon: url/g)).toHaveLength(12);
    for (const oldGlyph of ['"B"', '"I"', '"H"', '"❞"', '"•"', '"1."', '"↗"', '"◉"', '"◫"', '"⛶"']) {
      expect(res.text).not.toContain(`content: ${oldGlyph}`);
    }
    expect(res.text).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(res.text).toContain('align-items: stretch;');
    expect(res.text).toContain('min-height: 48px;');
    expect(res.text).toContain("name: 'split-view'");
    expect(res.text).toContain("action: EasyMDE.toggleSideBySide");
    expect(res.text).toContain("className: 'side-by-side no-disable'");
    expect(res.text).toContain("name: 'editor-fullscreen'");
    expect(res.text).toContain("action: EasyMDE.toggleFullScreen");
    expect(res.text).toContain("className: 'fullscreen no-disable'");
    expect(res.text).toContain("easyMDE.toolbarElements['side-by-side'] = easyMDE.toolbarElements['split-view']");
    expect(res.text).toContain("easyMDE.toolbarElements.fullscreen = easyMDE.toolbarElements['editor-fullscreen']");
    expect(res.text).toContain("name: 'save-draft'");
    expect(res.text).toContain("className: 'save-draft no-disable'");
    expect(res.text).toContain("name: 'prepare-publication'");
    expect(res.text).toContain("className: 'prepare-publication no-disable'");
    expect(res.text).not.toContain('<button class="action-btn btn-save"');
    expect(res.text).not.toContain('<button class="action-btn btn-prepare"');
    expect(res.text).toContain("document.querySelector('.actions-bar').style.display = 'none'");
    expect(res.text).toContain("document.body.classList.toggle('has-review-bar', Boolean(notionId))");
    expect(res.text).toContain('padding: 16px 12px 24px;');
  });

  it('serves an accessible authenticated post picker', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('id="post-search"');
    expect(res.text).toContain('role="combobox"');
    expect(res.text).toContain('id="post-results"');
    expect(res.text).toContain('role="listbox"');
    expect(res.text).toContain("fetch(`/api/posts?q=${encodeURIComponent(query)}`");
    expect(res.text).toContain("'Authorization': `Bearer ${token}`");
    expect(res.text).toContain('setTimeout(() => searchPosts');
    expect(res.text).toContain('postSearchRequest += 1;');
    expect(res.text).toContain('if (requestId !== postSearchRequest) return;');
    expect(res.text).toContain('postOptions = [];');
    expect(res.text).toContain("nextUrl.searchParams.set('p', post.p)");
    expect(res.text).toContain("nextUrl.searchParams.delete('notion')");
    expect(res.text).toContain("option.textContent = post.title");
    expect(res.text).toContain('initialEditorValue = easyMDE.value();');
  });

  it('returns 403 for paths outside whitelist', async () => {
    const forbidden = Buffer.from('/etc/passwd').toString('base64');
    const res = await request(app).get(`/api/file?p=${forbidden}`);
    expect(res.status).toBe(403);
  });

  it('requires an explicit content-path allowlist', () => {
    const originalPrefixes = process.env.EDITOR_ALLOWED_PREFIXES;
    delete process.env.EDITOR_ALLOWED_PREFIXES;
    try {
      expect(() => getAllowedPrefixes()).toThrow('EDITOR_ALLOWED_PREFIXES');
    } finally {
      process.env.EDITOR_ALLOWED_PREFIXES = originalPrefixes;
    }
  });

  it('requires authentication before listing configured posts', async () => {
    const res = await request(app).get('/api/posts?q=searchable');

    expect(res.status).toBe(401);
  });

  it('searches Markdown posts only inside the configured browse root', async () => {
    const res = await request(app)
      .get('/api/posts?q=first')
      .set('Authorization', 'Bearer test-token-12345');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.truncated).toBe(false);
    expect(res.body.posts[0]).toMatchObject({
      title: 'First Searchable Post',
      relativePath: 'first-post/index.md',
    });
    expect(Buffer.from(res.body.posts[0].p, 'base64').toString('utf8'))
      .toBe(path.join(testBrowsePostDir, 'index.md'));
  });

  it('does not expose non-Markdown files or symlink targets through post search', async () => {
    const outside = path.join(testContentDir, 'outside-search.md');
    const outsideDirectory = path.join(testContentDir, 'outside-directory');
    const link = path.join(testBrowseRoot, 'linked.md');
    const directoryLink = path.join(testBrowseRoot, 'linked-directory');
    fs.writeFileSync(outside, '# Linked Secret Post');
    fs.mkdirSync(outsideDirectory);
    fs.writeFileSync(path.join(outsideDirectory, 'secret.md'), '# Directory Secret Post');
    fs.symlinkSync(outside, link);
    fs.symlinkSync(outsideDirectory, directoryLink);

    try {
      const res = await request(app)
        .get('/api/posts?q=')
        .set('Authorization', 'Bearer test-token-12345');

      expect(res.status).toBe(200);
      expect(res.body.posts.map((post: { relativePath: string }) => post.relativePath))
        .toEqual(['first-post/index.md', 'second.md']);
    } finally {
      fs.unlinkSync(link);
      fs.unlinkSync(directoryLink);
      fs.rmSync(outsideDirectory, { recursive: true, force: true });
      fs.unlinkSync(outside);
    }
  });

  it('disables post browsing when no browse root is configured', async () => {
    const originalRoot = process.env.EDITOR_BROWSE_ROOT;
    delete process.env.EDITOR_BROWSE_ROOT;
    try {
      expect(getBrowseRoot()).toBeNull();
      const res = await request(app)
        .get('/api/posts')
        .set('Authorization', 'Bearer test-token-12345');
      expect(res.status).toBe(404);
    } finally {
      process.env.EDITOR_BROWSE_ROOT = originalRoot;
    }
  });

  it('rejects a browse root outside the allowed content prefixes', async () => {
    const originalRoot = process.env.EDITOR_BROWSE_ROOT;
    process.env.EDITOR_BROWSE_ROOT = testPublicDir;
    try {
      expect(() => getBrowseRoot()).toThrow('EDITOR_ALLOWED_PREFIXES');
      const res = await request(app)
        .get('/api/posts')
        .set('Authorization', 'Bearer test-token-12345');
      expect(res.status).toBe(503);
    } finally {
      process.env.EDITOR_BROWSE_ROOT = originalRoot;
    }
  });

  it('rejects non-Markdown files inside an allowed directory', async () => {
    const envFile = path.join(testContentDir, '.env');
    fs.writeFileSync(envFile, 'EDITOR_TOKEN=not-a-real-secret');
    const encoded = Buffer.from(envFile).toString('base64');

    const res = await request(app).get(`/api/file?p=${encoded}`);

    expect(res.status).toBe(403);
    fs.unlinkSync(envFile);
  });

  it('supports a configurable content-path allowlist', async () => {
    const customDir = '/tmp/markdown-content-editor-custom-content';
    const customFile = path.join(customDir, 'post.md');
    fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(customFile, '# Configured path');
    process.env.EDITOR_ALLOWED_PREFIXES = customDir;

    try {
      const encoded = Buffer.from(customFile).toString('base64');
      const res = await request(app).get(`/api/file?p=${encoded}`);

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('# Configured path');
    } finally {
      process.env.EDITOR_ALLOWED_PREFIXES = testContentDir;
      fs.rmSync(customDir, { recursive: true, force: true });
    }
  });

  it('rejects symlinks that escape the configured allowlist', async () => {
    const customDir = '/tmp/markdown-content-editor-symlink-check';
    const linkedFile = path.join(customDir, 'outside.md');
    fs.mkdirSync(customDir, { recursive: true });
    fs.symlinkSync('/etc/passwd', linkedFile);
    process.env.EDITOR_ALLOWED_PREFIXES = customDir;

    try {
      const encoded = Buffer.from(linkedFile).toString('base64');
      const res = await request(app).get(`/api/file?p=${encoded}`);

      expect(res.status).toBe(403);
    } finally {
      process.env.EDITOR_ALLOWED_PREFIXES = testContentDir;
      fs.rmSync(customDir, { recursive: true, force: true });
    }
  });

  it('does not create files through a symlinked parent directory', async () => {
    const allowedDir = '/tmp/markdown-content-editor-parent-symlink';
    const outsideDir = '/tmp/markdown-content-editor-parent-outside';
    const link = path.join(allowedDir, 'outside');
    const target = path.join(link, 'escaped.md');
    fs.mkdirSync(allowedDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.symlinkSync(outsideDir, link);
    process.env.EDITOR_ALLOWED_PREFIXES = allowedDir;

    try {
      const encoded = Buffer.from(target).toString('base64');
      const res = await request(app)
        .post('/api/save')
        .set('Authorization', 'Bearer test-token-12345')
        .send({ p: encoded, content: 'escaped' });

      expect(res.status).toBe(404);
      expect(fs.existsSync(path.join(outsideDir, 'escaped.md'))).toBe(false);
    } finally {
      process.env.EDITOR_ALLOWED_PREFIXES = testContentDir;
      fs.rmSync(allowedDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('returns 401 when token is missing', async () => {
    const p = Buffer.from(path.join(testContentDir, 'test.md')).toString('base64');
    const res = await request(app).post('/api/save').send({ p, content: 'test' });
    expect(res.status).toBe(401);
  });

  it('disables write operations when EDITOR_TOKEN is not configured', async () => {
    const originalToken = process.env.EDITOR_TOKEN;
    delete process.env.EDITOR_TOKEN;

    try {
      const p = Buffer.from(path.join(testContentDir, 'test.md')).toString('base64');
      const res = await request(app)
        .post('/api/save')
        .set('Authorization', 'Bearer any-value')
        .send({ p, content: 'test' });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('EDITOR_TOKEN is not configured');
    } finally {
      process.env.EDITOR_TOKEN = originalToken;
    }
  });

  it('returns 404 for missing file', async () => {
    const p = Buffer.from(path.join(testContentDir, 'nonexistent-file-xyz.md')).toString('base64');
    const res = await request(app).get(`/api/file?p=${p}`);
    expect(res.status).toBe(404);
  });

  it('save round-trip works', async () => {
    const p = Buffer.from(testFile).toString('base64');

    fs.writeFileSync(testFile, '# Original');

    const saveRes = await request(app)
      .post('/api/save')
      .set('Authorization', 'Bearer test-token-12345')
      .send({ p, content: '# Updated content\n\nHello world' });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.ok).toBe(true);

    const readRes = await request(app).get(`/api/file?p=${p}`);
    expect(readRes.status).toBe(200);
    expect(readRes.body.content).toBe('# Updated content\n\nHello world');
  });

  it('prepares an Astro draft for publication without publishing it', async () => {
    const p = Buffer.from(testFile).toString('base64');
    const content = `---
title: "Test post"
draft: true
---

The body can still mention draft: true without being changed.
`;
    fs.writeFileSync(testFile, content);

    const res = await request(app)
      .post('/api/prepare-publication')
      .set('Authorization', 'Bearer test-token-12345')
      .send({ p, content });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.content).toContain('draft: false');
    expect(res.body.content).toContain('The body can still mention draft: true');
    expect(fs.readFileSync(testFile, 'utf8')).toBe(res.body.content);
  });

  it('returns the current Notion review status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        properties: { Status: { select: { name: 'Approved' } } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const res = await request(app)
      .get('/api/review?notion_id=11111111-2222-3333-4444-555555555555')
      .set('Authorization', 'Bearer test-token-12345');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'Approved' });
  });

  it('reports when the optional Notion integration is not configured', async () => {
    const originalToken = process.env.NOTION_ACCESS_TOKEN;
    delete process.env.NOTION_ACCESS_TOKEN;
    try {
      const res = await request(app)
        .get('/api/review?notion_id=11111111-2222-3333-4444-555555555555')
        .set('Authorization', 'Bearer test-token-12345');

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('NOTION_ACCESS_TOKEN is not configured');
    } finally {
      process.env.NOTION_ACCESS_TOKEN = originalToken;
    }
  });

  it('does not follow a cover-image symlink outside the allowlist', async () => {
    const markdown = path.join(testContentDir, 'cover-check.md');
    const cover = path.join(testContentDir, 'cover-check-cover.webp');
    fs.writeFileSync(markdown, '# Cover check');
    fs.symlinkSync('/etc/passwd', cover);

    const encoded = Buffer.from(markdown).toString('base64');
    const res = await request(app).get(`/api/cover?p=${encoded}`);

    expect(res.status).toBe(404);
    fs.unlinkSync(cover);
    fs.unlinkSync(markdown);
  });

  it('serves configured blog images used by Markdown previews', async () => {
    const res = await request(app).get('/images/blog/preview.webp');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/webp/);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(Buffer.from(res.body).toString()).toBe('fake-webp-image');
  });

  it('does not allow the blog image route to escape its public directory', async () => {
    const res = await request(app).get('/images/blog/%2e%2e%2fsecret.txt');

    expect(res.status).toBe(404);
  });

  it('does not serve active SVG content from the application origin', async () => {
    fs.writeFileSync(path.join(testImageDir, 'active.svg'), '<svg><script>alert(1)</script></svg>');

    const res = await request(app).get('/images/blog/active.svg');

    expect(res.status).toBe(404);
  });
});

describe('extractDocumentTitle', () => {
  it('prefers the frontmatter title over headings inside fenced examples', () => {
    const content = `---
title: "How I Turned a VPS into an Always-On AI Coding Server"
draft: true
---

\`\`\`bash
# Example only
my-service --host 127.0.0.1
\`\`\`
`;

    expect(extractDocumentTitle(content)).toBe('How I Turned a VPS into an Always-On AI Coding Server');
  });

  it('falls back to the first Markdown heading outside fenced code', () => {
    const content = `\`\`\`bash
# Not the title
\`\`\`

# Actual title
`;

    expect(extractDocumentTitle(content)).toBe('Actual title');
  });
});

describe('setDraftStatus', () => {
  it('changes only the draft field inside Astro frontmatter', () => {
    const content = `---
title: "Test post"
draft: true
---

Body text containing draft: true stays unchanged.
`;

    const updated = setDraftStatus(content, false);

    expect(updated).toContain('draft: false');
    expect(updated).toContain('Body text containing draft: true stays unchanged.');
  });

  it('rejects content without a draft field in frontmatter', () => {
    expect(() => setDraftStatus('---\ntitle: Test\n---\n', false)).toThrow(
      'Frontmatter draft field not found'
    );
  });
});
