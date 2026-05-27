import { mkdir } from "node:fs/promises";
import { loadArticles } from "./src/backend/parser";
import { compileArticleToContent } from "./src/backend/compiler";

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
    const articleData = await compileArticleToContent(article);
    const outputPath = `./public/api/article-content/${article.id}.json`;
    await Bun.write(outputPath, JSON.stringify(articleData));
  }
  console.log("Static site generation completed successfully!");
}

buildStatic().catch(console.error);
