import { readdir, stat, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { marked } from "marked";

interface ArticleMetadata {
  id: number;
  title: string;
  category: string;
  subcategory?: string;
  contentSnippet: string;
  publishTime: string;
  filePath: string;
}

function getNumericId(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

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
          const value = parts.slice(1).join(":").trim().replace(/^['"]|['"]$/g, "");
          meta[key] = value;
        }
      }
    }
  }
  return { meta, markdown };
}

function calculateWordCount(markdown: string): number {
  const cleanText = markdown
    .replace(/[#*`_\[\]()\n\r]/g, " ")
    .trim();
  const cnChars = (cleanText.match(/[\u4e00-\u9fa5]/g) || []).length;
  const enWords = cleanText.replace(/[\u4e00-\u9fa5]/g, "").split(/\s+/).filter(Boolean).length;
  return cnChars + enWords;
}

function parseTags(tagsValue?: string): string[] {
  if (!tagsValue) return [];
  try {
    if (tagsValue.startsWith("[") && tagsValue.endsWith("]")) {
      return JSON.parse(tagsValue);
    }
    return tagsValue.split(",").map(t => t.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  } catch (e) {
    return [];
  }
}

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
  } catch (e) {}
  return fileList;
}

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
    
    const snippet = meta.summary || meta.description || "";
    
    articles.push({
      id: getNumericId(relPath),
      title,
      category: category.toLowerCase(),
      subcategory: subcategory ? subcategory.toLowerCase() : undefined,
      contentSnippet: snippet,
      publishTime,
      filePath: file
    });
  }
  
  return articles.sort((a, b) => new Date(b.publishTime).getTime() - new Date(a.publishTime).getTime());
}

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
      lastUpdated
    };
    
    const outputPath = `./public/api/article-content/${article.id}.json`;
    await Bun.write(outputPath, JSON.stringify(articleData));
  }
  console.log("Static site generation completed successfully!");
}

buildStatic().catch(console.error);
