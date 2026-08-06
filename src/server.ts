import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";

function parsePort(value: string | undefined): number {
  const raw = value || "18793";
  if (!/^\d+$/.test(raw)) throw new Error("PORT must be an integer between 1 and 65535");
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535");
  return port;
}

const PORT = parsePort(process.env.PORT);
const HOST = process.env.HOST || "127.0.0.1";
const EDITABLE_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

export function getAllowedPrefixes(): string[] {
  const configured = process.env.EDITOR_ALLOWED_PREFIXES
    ?.split(path.delimiter)
    .map((prefix) => prefix.trim())
    .filter(Boolean);
  if (!configured?.length) {
    throw new Error("EDITOR_ALLOWED_PREFIXES must contain at least one content directory");
  }
  const prefixes = configured;

  return prefixes.map((prefix) => {
    const resolved = path.resolve(prefix);
    const canonical = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
    return canonical.endsWith(path.sep) ? canonical : `${canonical}${path.sep}`;
  });
}

function isAllowedPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return getAllowedPrefixes().some((prefix) =>
    resolved === prefix.slice(0, -1) || resolved.startsWith(prefix)
  );
}

export function getBrowseRoot(): string | null {
  const configured = process.env.EDITOR_BROWSE_ROOT?.trim();
  if (!configured) return null;

  const resolved = path.resolve(configured);
  if (!fs.existsSync(resolved)) throw new Error("EDITOR_BROWSE_ROOT does not exist");
  const canonical = fs.realpathSync(resolved);
  if (!fs.statSync(canonical).isDirectory()) {
    throw new Error("EDITOR_BROWSE_ROOT must be a directory");
  }
  if (!isAllowedPath(canonical)) {
    throw new Error("EDITOR_BROWSE_ROOT must be inside EDITOR_ALLOWED_PREFIXES");
  }
  return canonical;
}

type BrowsePost = {
  title: string;
  relativePath: string;
  p: string;
};

function listBrowsePosts(root: string, query: string): BrowsePost[] {
  const files: string[] = [];
  const maxScannedFiles = 2000;

  const visit = (directory: string, depth: number): void => {
    if (depth > 12 || files.length >= maxScannedFiles) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (files.length >= maxScannedFiles) break;
      if (entry.name.startsWith(".")) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(candidate, depth + 1);
      } else if (entry.isFile() && EDITABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(candidate);
      }
    }
  };

  visit(root, 0);
  const normalizedQuery = query.trim().toLowerCase();
  return files
    .map((filePath) => {
      const relativePath = path.relative(root, filePath).split(path.sep).join("/");
      const content = fs.readFileSync(filePath, "utf8").slice(0, 64 * 1024);
      const title = extractDocumentTitle(content) || path.basename(filePath, path.extname(filePath));
      return {
        title,
        relativePath,
        p: Buffer.from(filePath).toString("base64"),
      };
    })
    .filter((post) =>
      !normalizedQuery ||
      post.title.toLowerCase().includes(normalizedQuery) ||
      post.relativePath.toLowerCase().includes(normalizedQuery)
    )
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .slice(0, 50);
}

function decodePath(b64: string): string {
  const decoded = Buffer.from(b64, "base64").toString("utf-8");
  const resolved = path.resolve(decoded);
  if (!EDITABLE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new Error("Only Markdown files are allowed");
  }
  const canonical = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
  if (!isAllowedPath(canonical)) {
    throw new Error("Path not allowed");
  }
  return canonical;
}

export function extractDocumentTitle(content: string): string | null {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (frontmatter) {
    const title = frontmatter[1].match(/^title:\s*(?:"([^"]+)"|'([^']+)'|(.+?))\s*$/m);
    const value = title?.[1] ?? title?.[2] ?? title?.[3];
    if (value?.trim()) return value.trim();
  }

  const withoutFencedCode = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "");
  const heading = withoutFencedCode.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim() || null;
}

export function setDraftStatus(content: string, isDraft: boolean): string {
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) {
    throw new Error("Astro frontmatter not found");
  }

  const draftField = /^draft:\s*(?:true|false)\s*$/m;
  if (!draftField.test(frontmatter[0])) {
    throw new Error("Frontmatter draft field not found");
  }

  const updatedFrontmatter = frontmatter[0].replace(draftField, `draft: ${isDraft}`);
  return updatedFrontmatter + content.slice(frontmatter[0].length);
}

function isValidNotionPageId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{32}$|^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(value);
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.EDITOR_TOKEN || "";
  if (!token) {
    res.status(503).json({ error: "EDITOR_TOKEN is not configured" });
    return;
  }
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${token}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    next();
  });
  app.use(express.json());

  // Serve configured public blog images at the same root-relative URLs
  // used by Markdown. Canonical-path checks prevent symlinks or
  // traversal from escaping the intended public image directory.
  app.get("/images/blog/*", (req: Request, res: Response) => {
    const publicDir = process.env.EDITOR_PUBLIC_DIR;
    if (!publicDir) {
      res.status(404).end();
      return;
    }
    const imageRoot = path.join(publicDir, "images", "blog");
    const relativePath = req.params[0];
    const allowedExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);

    try {
      const realRoot = fs.realpathSync(imageRoot);
      const candidate = path.resolve(realRoot, relativePath);
      if (!candidate.startsWith(`${realRoot}${path.sep}`)) {
        res.status(404).end();
        return;
      }

      const realFile = fs.realpathSync(candidate);
      if (
        !realFile.startsWith(`${realRoot}${path.sep}`) ||
        !allowedExtensions.has(path.extname(realFile).toLowerCase()) ||
        !fs.statSync(realFile).isFile()
      ) {
        res.status(404).end();
        return;
      }

      res.set({
        "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
        "CDN-Cache-Control": "no-store",
        "Cloudflare-CDN-Cache-Control": "no-store",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.sendFile(realFile);
    } catch {
      res.status(404).end();
    }
  });

  // GET / - serve editor HTML
  app.get("/", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(__dirname, "..", "templates", "editor.html"));
  });

  // GET /api/file - read a file
  app.get("/api/file", (req: Request, res: Response) => {
    const p = req.query.p as string;
    if (!p) {
      res.status(400).json({ error: "Missing parameter p" });
      return;
    }

    let filePath: string;
    try {
      filePath = decodePath(p);
    } catch {
      res.status(403).json({ error: "Path not allowed" });
      return;
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ content, title: extractDocumentTitle(content) });
  });

  // GET /api/posts - search Markdown files under an optional configured root.
  // Authentication is required because directory enumeration exposes content metadata.
  app.get("/api/posts", requireAuth, (req: Request, res: Response) => {
    const queryValue = req.query.q;
    if (Array.isArray(queryValue) || (queryValue !== undefined && typeof queryValue !== "string")) {
      res.status(400).json({ error: "Invalid query" });
      return;
    }
    const query = queryValue || "";
    if (query.length > 100) {
      res.status(400).json({ error: "Query is too long" });
      return;
    }

    try {
      const root = getBrowseRoot();
      if (!root) {
        res.status(404).json({ error: "Post browsing is not configured" });
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({ posts: listBrowsePosts(root, query) });
    } catch {
      res.status(503).json({ error: "Post browsing is unavailable" });
    }
  });

  // POST /api/save - save file content
  app.post("/api/save", requireAuth, (req: Request, res: Response) => {
    const { p, content } = req.body;
    if (!p || content === undefined) {
      res.status(400).json({ error: "Missing p or content" });
      return;
    }

    let filePath: string;
    try {
      filePath = decodePath(p);
    } catch {
      res.status(403).json({ error: "Path not allowed" });
      return;
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    fs.writeFileSync(filePath, content, "utf-8");
    res.json({ ok: true });
  });

  // POST /api/prepare-publication - set Astro frontmatter draft:false and save
  app.post("/api/prepare-publication", requireAuth, (req: Request, res: Response) => {
    const { p, content } = req.body;
    if (!p || typeof content !== "string") {
      res.status(400).json({ error: "Missing p or content" });
      return;
    }

    let filePath: string;
    try {
      filePath = decodePath(p);
    } catch {
      res.status(403).json({ error: "Path not allowed" });
      return;
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    try {
      const updatedContent = setDraftStatus(content, false);
      fs.writeFileSync(filePath, updatedContent, "utf-8");
      res.json({ ok: true, content: updatedContent, draft: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update draft status";
      res.status(400).json({ error: message });
    }
  });

  // GET /api/review - return the current Notion review status
  app.get("/api/review", requireAuth, async (req: Request, res: Response) => {
    const notionId = req.query.notion_id;
    if (!isValidNotionPageId(notionId)) {
      res.status(400).json({ error: "Invalid notion_id" });
      return;
    }

    const notionToken = process.env.NOTION_ACCESS_TOKEN;
    if (!notionToken) {
      res.status(503).json({ error: "NOTION_ACCESS_TOKEN is not configured" });
      return;
    }

    try {
      const response = await fetch(`https://api.notion.com/v1/pages/${notionId}`, {
        headers: {
          Authorization: "Bearer " + notionToken,
          "Notion-Version": "2022-06-28",
        },
      });

      if (!response.ok) {
        res.status(502).json({ error: "Notion API error" });
        return;
      }

      const page = await response.json() as {
        properties?: { Status?: { select?: { name?: string } | null } };
      };
      const status = page.properties?.Status?.select?.name || "Unknown";
      res.setHeader("Cache-Control", "no-store");
      res.json({ status });
    } catch {
      res.status(502).json({ error: "Notion API error" });
    }
  });

  // POST /api/review - submit review to Notion
  app.post("/api/review", requireAuth, async (req: Request, res: Response) => {
    const { notion_id, status, feedback } = req.body;
    const validStatuses = ["Approved", "Needs Revision", "Denied"];

    if (!isValidNotionPageId(notion_id) || !status || !validStatuses.includes(status)) {
      res.status(400).json({ error: "Invalid notion_id or status" });
      return;
    }

    const notionToken = process.env.NOTION_ACCESS_TOKEN;
    if (!notionToken) {
      res.status(503).json({ error: "NOTION_ACCESS_TOKEN is not configured" });
      return;
    }

    try {
      const response = await fetch(
        `https://api.notion.com/v1/pages/${notion_id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${notionToken}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            properties: {
              Status: { select: { name: status } },
              ...(feedback
                ? {
                    Feedback: {
                      rich_text: [{ text: { content: feedback } }],
                    },
                  }
                : {}),
            },
          }),
        }
      );

      if (!response.ok) {
        res.status(502).json({ error: "Notion API error" });
        return;
      }

      res.json({ ok: true });
    } catch {
      res.status(502).json({ error: "Notion API error" });
    }
  });

  // GET /api/cover - serve cover image for a markdown file
  app.get("/api/cover", (req: Request, res: Response) => {
    const p = req.query.p as string;
    if (!p) { res.status(400).json({ error: "Missing parameter p" }); return; }
    let filePath: string;
    try { filePath = decodePath(p); } catch { res.status(403).json({ error: "Path not allowed" }); return; }
    const dir = path.dirname(filePath);
    const stem = path.basename(filePath, path.extname(filePath));
    const coverPath = path.join(dir, `${stem}-cover.webp`);
    try {
      const realCover = fs.realpathSync(coverPath);
      if (
        !isAllowedPath(realCover) ||
        path.extname(realCover).toLowerCase() !== ".webp" ||
        !fs.statSync(realCover).isFile()
      ) {
        res.status(404).json({ error: "No cover image" });
        return;
      }
      res.setHeader("Content-Type", "image/webp");
      res.sendFile(realCover);
    } catch {
      res.status(404).json({ error: "No cover image" });
    }
  });

  return app;
}

const app = createApp();

if (require.main === module) {
  getAllowedPrefixes();
  app.listen(PORT, HOST, () =>
    console.log(`Markdown content editor running at http://${HOST}:${PORT}`)
  );
}

export default app;
