import { serve } from "bun";
import { marked } from "marked";
import { loadArticles, parseFrontMatter, calculateWordCount, parseTags } from "./src/backend/parser";

const server = serve({
  port: 9191,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Route root to index.html
    if (path === "/") {
      return new Response(Bun.file("./public/index.html"), {
        headers: {
          "Cache-Control": "no-cache"
        }
      });
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
        headers: {
          "Content-Type": "application/javascript",
          "Cache-Control": "no-cache"
        },
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
      const { meta, markdown } = parseFrontMatter(content);
      const html = await marked.parse(markdown);
      const wordCount = calculateWordCount(markdown);
      const tags = parseTags(meta.tags);
      const author = meta.author || "hengvvang";
      const readingTime = meta.readingTime || "10 min";
      const lastUpdated = meta.lastUpdated || "";
      
      return new Response(JSON.stringify({
        html,
        title: article.title,
        publishTime: article.publishTime,
        category: article.category,
        subcategory: article.subcategory,
        author,
        readingTime,
        wordCount,
        tags,
        lastUpdated,
        cover: article.cover,
        coverText: article.coverText
      }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache"
        }
      });
    }

    const publicFilePath = `./public${path}`;
    const publicFile = Bun.file(publicFilePath);
    if (await publicFile.exists()) {
      return new Response(publicFile, {
        headers: {
          "Cache-Control": "no-cache"
        }
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`🚀 Blog dev server running at: http://localhost:${server.port}`);
