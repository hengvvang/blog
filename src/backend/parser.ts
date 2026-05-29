import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { CoverConfig } from "../types";

export interface ArticleMetadata {
  id: number;
  title: string;
  category: string;
  subcategory?: string;
  subtopic?: string;
  contentSnippet: string;
  publishTime: string;
  filePath: string;
  cover?: CoverConfig;
  path: string;
  bookSrc?: string;
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

// Recursively scan directories for organization.yaml configuration files
export async function scanForYamlConfigs(dir: string, fileList: string[] = []): Promise<string[]> {
  try {
    const files = await readdir(dir);
    for (const file of files) {
      const filePath = join(dir, file);
      const fileStat = await stat(filePath);
      if (fileStat.isDirectory()) {
        await scanForYamlConfigs(filePath, fileList);
      } else if (file === "organization.yaml") {
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
  const yamlFiles = await scanForYamlConfigs(postsDir);
  const articles: ArticleMetadata[] = [];
  
  for (const yamlFile of yamlFiles) {
    let meta: any = {};
    try {
      const yamlContent = await Bun.file(yamlFile).text();
      meta = parseYaml(yamlContent) || {};
    } catch (err) {
      console.error(`Failed to parse YAML config: ${yamlFile}`, err);
      continue;
    }
    
    const bookSrc = dirname(yamlFile).replace(/\\/g, "/");
    const bookFolder = relative(postsDir, bookSrc).replace(/\\/g, "/");
    
    const category = meta.category ? String(meta.category).trim().toLowerCase() : "";
    const subcategory = meta.subcategory ? String(meta.subcategory).trim().toLowerCase() : "";
    const subtopic = meta.subtopic ? String(meta.subtopic).trim().toLowerCase() : "others";
    
    if (!category || !subcategory) {
      throw new Error(`Missing category or subcategory in ${yamlFile}`);
    }
    
    const path = `/books/${bookFolder}/index.html`;
    let file = join(bookSrc, "src", "README.md").replace(/\\/g, "/");
    if (!existsSync(file)) {
      file = join(bookSrc, "README.md").replace(/\\/g, "/");
    }
    
    const timeline = meta.timeline || {};
    let publishTime = timeline.publishTime ? String(timeline.publishTime).trim() : "";
    if (!publishTime) {
      const fileStat = await stat(file);
      publishTime = fileStat.mtime.toISOString().replace("T", " ").substring(0, 16);
    }
    
    const coverMeta = meta.cover || {};
    const title = coverMeta.title || "";
    const snippet = coverMeta.summary || "";
    
    let cover: any = undefined;
    if (coverMeta.image) {
      cover = {
        image: coverMeta.image
      };
    }

    articles.push({
      id: getNumericId(bookFolder),
      title,
      category,
      subcategory: subcategory || undefined,
      subtopic,
      contentSnippet: snippet,
      publishTime,
      filePath: file,
      cover,
      path,
      bookSrc
    });
  }
  
  return articles.sort((a, b) => new Date(b.publishTime).getTime() - new Date(a.publishTime).getTime());
}
