import { serve } from "bun";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { marked } from "marked";

interface ArticleMetadata {
  id: number;
  title: string;
  category: string;
  subcategory?: string;
  contentSnippet: string;
  publishTime: string;
  author?: string;
  filePath: string;
}

// Stable numeric hash from filepath string
function getNumericId(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// Simple front matter parser
function parseFrontMatter(content: string) {
  const meta: Record<string, string> = {};
  let markdown = content;
  
  if (content.startsWith("---")) {
    const endOffset = content.indexOf("---", 3);
    if (endOffset !== -1) {
      const header = content.slice(3, endOffset);
      markdown = content.slice(endOffset + 3);
      
      const lines = header.split("\n");
      for (const line of lines) {
        const parts = line.split(":");
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const value = parts.slice(1).join(":").trim().replace(/^['"]|['"]$/g, ""); // strip quotes
          meta[key] = value;
        }
      }
    }
  }
  return { meta, markdown };
}

// Recursively scan directories for *.md files
async function scanDirectory(dir: string, fileList: string[] = []) {
  try {
    const files = await readdir(dir);
    for (const file of files) {
      const filePath = join(dir, file);
      const fileStat = await stat(filePath);
      if (fileStat.isDirectory()) {
        await scanDirectory(filePath, fileList);
      } else if (file.endsWith(".md")) {
        fileList.push(filePath);
      }
    }
  } catch (e) {
    // If directory doesn't exist, ignore
  }
  return fileList;
}

// Get all articles with metadata
async function loadArticles(): Promise<ArticleMetadata[]> {
  const postsDir = "./posts";
  const files = await scanDirectory(postsDir);
  const articles: ArticleMetadata[] = [];
  
  for (const file of files) {
    const content = await Bun.file(file).text();
    const { meta, markdown } = parseFrontMatter(content);
    
    const relPath = relative(postsDir, file).replace(/\\/g, "/");
    const parts = relPath.split("/");
    const category = meta.category || parts[0] || "general";
    const subcategory = meta.subcategory || (parts.length > 2 ? parts.slice(1, -1).join("/") : undefined);
    
    let title = meta.title;
    if (!title) {
      const titleMatch = markdown.match(/^#\s+(.+)$/m);
      if (titleMatch) {
        title = titleMatch[1].trim();
      } else {
        title = parts[parts.length - 1].replace(/\.md$/, "").replace(/[-_]/g, " ");
      }
    }
    
    let publishTime = meta.publishTime;
    if (!publishTime) {
      const fileStat = await stat(file);
      publishTime = fileStat.mtime.toISOString().replace("T", " ").substring(0, 16);
    }
    
    const snippet = meta.description || meta.summary || "";
    
    const author = meta.author;

    articles.push({
      id: getNumericId(relPath),
      title,
      category: category.toLowerCase(),
      subcategory: subcategory ? subcategory.toLowerCase() : undefined,
      contentSnippet: snippet,
      publishTime,
      author,
      filePath: file
    });
  }
  
  return articles.sort((a, b) => new Date(b.publishTime).getTime() - new Date(a.publishTime).getTime());
}

const server = serve({
  port: 9191,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Route root to index.html
    if (path === "/") {
      return new Response(Bun.file("./public/index.html"));
    }
    
    // On-the-fly bundle main.ts for the browser
    if (path === "/main.js") {
      const build = await Bun.build({
        entrypoints: ["./src/main.ts"],
        minify: true,
      });
      
      if (!build.success) {
        console.error(build.logs);
        return new Response("Build failed", { status: 500 });
      }
      
      return new Response(build.outputs[0], {
        headers: { "Content-Type": "application/javascript" },
      });
    }

    // API: articles list
    if (path === "/api/articles" || path === "/api/articles.json") {
      const list = await loadArticles();
      const clientList = list.map(({ filePath, ...rest }) => rest);
      return new Response(JSON.stringify(clientList), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache"
        }
      });
    }

    // API: article content rendering
    if (path === "/api/article-content" || (path.startsWith("/api/article-content/") && path.endsWith(".json"))) {
      let idStr: string | null = null;
      if (path.startsWith("/api/article-content/")) {
        idStr = path.substring(21).replace(".json", "");
      } else {
        idStr = url.searchParams.get("id");
      }
      if (!idStr) {
        return new Response("Missing id parameter", { status: 400 });
      }
      const id = parseInt(idStr, 10);
      const list = await loadArticles();
      const article = list.find(a => a.id === id);
      if (!article) {
        return new Response("Article not found", { status: 404 });
      }
      
      const content = await Bun.file(article.filePath).text();
      const { markdown } = parseFrontMatter(content);
      const html = await marked.parse(markdown);
      
      return new Response(JSON.stringify({
        html,
        title: article.title,
        publishTime: article.publishTime,
        category: article.category,
        subcategory: article.subcategory,
        author: article.author
      }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache"
        }
      });
    }

    // Serve static files from public folder
    const publicFilePath = `./public${path}`;
    const publicFile = Bun.file(publicFilePath);
    if (await publicFile.exists()) {
      return new Response(publicFile);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`🚀 Blog dev server running at: http://localhost:${server.port}`);
