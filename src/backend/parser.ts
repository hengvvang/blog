import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

export interface ArticleMetadata {
  id: number;
  title: string;
  category: string;
  subcategory?: string;
  contentSnippet: string;
  publishTime: string;
  author?: string;
  filePath: string;
  cover?: string;
  coverText?: { position: string; context: string };
}

// Stable numeric hash from filepath string
export function getNumericId(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// Robust standard front matter parser using yaml library
export function parseFrontMatter(content: string) {
  let meta: Record<string, any> = {};
  let markdown = content;
  
  if (content.startsWith("---")) {
    const endOffset = content.indexOf("---", 3);
    if (endOffset !== -1) {
      const header = content.slice(3, endOffset);
      markdown = content.slice(endOffset + 3);
      try {
        meta = parseYaml(header) || {};
      } catch (err) {
        console.error("Failed to parse YAML front matter:", err);
      }
    }
  }
  return { meta, markdown };
}

export function calculateWordCount(markdown: string): number {
  const cleanText = markdown
    .replace(/[#*`_\[\]()\n\r]/g, " ")
    .trim();
  const cnChars = (cleanText.match(/[\u4e00-\u9fa5]/g) || []).length;
  const enWords = cleanText.replace(/[\u4e00-\u9fa5]/g, "").split(/\s+/).filter(Boolean).length;
  return cnChars + enWords;
}

export function parseTags(tagsValue?: any): string[] {
  if (!tagsValue) return [];
  if (Array.isArray(tagsValue)) return tagsValue.map(t => String(t).trim());
  try {
    const strVal = String(tagsValue).trim();
    if (strVal.startsWith("[") && strVal.endsWith("]")) {
      return JSON.parse(strVal);
    }
    return strVal.split(",").map(t => t.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Recursively scan directories for *.md files
export async function scanDirectory(dir: string, fileList: string[] = []): Promise<string[]> {
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
    // Ignore error
  }
  return fileList;
}

// Get all articles with metadata
export async function loadArticles(): Promise<ArticleMetadata[]> {
  const postsDir = "./posts";
  const files = await scanDirectory(postsDir);
  const articles: ArticleMetadata[] = [];
  
  for (const file of files) {
    const content = await Bun.file(file).text();
    const { meta, markdown } = parseFrontMatter(content);
    
    const relPath = relative(postsDir, file).replace(/\\/g, "/");
    const parts = relPath.split("/");
    let category = meta.category || parts[0] || "general";
    let subcategory = meta.subcategory || (parts.length > 2 ? parts.slice(1, -1).join("/") : undefined);
    
    if (category.toLowerCase() === "git") {
      category = "toolchain";
      subcategory = "git";
    }
    
    let title = meta.title;
    if (!title) {
      const titleMatch = markdown.match(/^#\s+(.+)$/m);
      if (titleMatch) {
        title = titleMatch[1].trim();
      } else {
        title = parts[parts.length - 1].replace(/\.md$/, "").replace(/[-_]/g, " ");
      }
    }
    
    let publishTime = String(meta.publishTime || "");
    if (!publishTime) {
      const fileStat = await stat(file);
      publishTime = fileStat.mtime.toISOString().replace("T", " ").substring(0, 16);
    }
    
    const snippet = meta.summary || meta.description || "";
    const author = meta.author;
    const cover = meta.cover || undefined;
    const coverText = meta.coverText || undefined;

    articles.push({
      id: getNumericId(relPath),
      title,
      category: category.toLowerCase(),
      subcategory: subcategory ? subcategory.toLowerCase() : undefined,
      contentSnippet: snippet,
      publishTime,
      author,
      filePath: file,
      cover,
      coverText
    });
  }
  
  return articles.sort((a, b) => new Date(b.publishTime).getTime() - new Date(a.publishTime).getTime());
}
