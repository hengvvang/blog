import { mkdir } from "node:fs/promises";
import { marked } from "marked";
import { loadArticles, parseFrontMatter, calculateWordCount, parseTags } from "./src/backend/parser";

async function buildStatic() {
  console.log("Starting static site generation...");
  const articles = await loadArticles();
  
  // Create output API directories inside public/
  await mkdir("./public/api", { recursive: true });
  await mkdir("./public/api/article-content", { recursive: true });
  
  // Write articles list JSON
  const clientList = articles.map(({ filePath, ...rest }) => rest);
  await Bun.write("./public/api/articles.json", JSON.stringify(clientList));
  console.log(`Generated: public/api/articles.json (${clientList.length} articles)`);
  
  // Write each article content JSON
  for (const article of articles) {
    const content = await Bun.file(article.filePath).text();
    const { meta, markdown } = parseFrontMatter(content);
    const html = await marked.parse(markdown);
    const wordCount = calculateWordCount(markdown);
    const tags = parseTags(meta.tags);
    const author = meta.author || "hengvvang";
    const readingTime = meta.readingTime || "10 min";
    const lastUpdated = meta.lastUpdated || "";
    
    const articleData = {
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
    };
    
    const outputPath = `./public/api/article-content/${article.id}.json`;
    await Bun.write(outputPath, JSON.stringify(articleData));
  }
  console.log("Static site generation completed successfully!");
}

buildStatic().catch(console.error);
