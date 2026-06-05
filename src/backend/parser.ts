import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { CoverConfig, Article } from "../shared/types";

export interface ArticleMetadata extends Article {
  filePath: string;
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

// Recursively scan directories for meta.yaml configuration files
export async function scanForYamlConfigs(dir: string, fileList: string[] = []): Promise<string[]> {
  try {
    const files = await readdir(dir);
    for (const file of files) {
      const filePath = join(dir, file);
      const fileStat = await stat(filePath);
      if (fileStat.isDirectory()) {
        await scanForYamlConfigs(filePath, fileList);
      } else if (file === "meta.yaml") {
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
    
    let bookSrc = dirname(yamlFile).replace(/\\/g, "/");
    if (meta.book) {
      if (!meta.book.src) {
        throw new Error(`Missing book.src in ${yamlFile}`);
      }
      bookSrc = join(dirname(yamlFile), meta.book.src).replace(/\\/g, "/");
    }
    const bookFolder = relative(postsDir, bookSrc).replace(/\\/g, "/");
    
    const category = meta.category ? String(meta.category).trim().toLowerCase() : "";
    const subcategory = meta.subcategory ? String(meta.subcategory).trim().toLowerCase() : "";
    const subtopic = meta.subtopic ? String(meta.subtopic).trim().toLowerCase() : "others";
    
    if (!category || !subcategory) {
      throw new Error(`Missing category or subcategory in ${yamlFile}`);
    }
    
    // Determine path from book.toml build-dir dynamically if book is specified
    let path = "";
    if (meta.book) {
      const bookTomlPath = join(bookSrc, "book.toml");
      if (!existsSync(bookTomlPath)) {
        throw new Error(`Missing book.toml at ${bookSrc} for article ${yamlFile}`);
      }
      const bookTomlContent = await Bun.file(bookTomlPath).text();
      const match = bookTomlContent.match(/build-dir\s*=\s*"([^"]+)"/);
      if (!match) {
        throw new Error(`Missing build-dir configuration in ${bookTomlPath}`);
      }
      const buildDir = match[1];
      const destDir = join(process.cwd(), bookSrc, buildDir).replace(/\\/g, "/");
      const publicRoot = join(process.cwd(), "public").replace(/\\/g, "/");
      const relativePath = relative(publicRoot, destDir).replace(/\\/g, "/");
      path = "/" + relativePath;
      if (!path.endsWith("/")) {
        path = path + "/";
      }
    } else {
      path = `/books/${bookFolder}/`;
    }
    
    let file = join(bookSrc, "src", "README.md").replace(/\\/g, "/");
    if (!existsSync(file)) {
      file = join(bookSrc, "README.md").replace(/\\/g, "/");
    }
    
    const timeline = meta.timeline || {};
    const publishTime = timeline.publishTime ? String(timeline.publishTime).trim() : "";
    if (!publishTime) {
      throw new Error(`Missing timeline.publishTime in ${yamlFile}`);
    }
    
    // Support lastUpdatedTime strictly under timeline
    const lastUpdatedTime = timeline.lastUpdatedTime ? String(timeline.lastUpdatedTime).trim() : "";
    const sortTime = lastUpdatedTime || publishTime;
    
    const coverMeta = meta.cover || {};
    const title = coverMeta.title || "";
    const snippet = coverMeta.summary || "";
    
    let cover: CoverConfig | undefined = undefined;
    if (coverMeta.image) {
      const imgConfig = coverMeta.image;
      cover = {
        image: {
          src: imgConfig.src,
          color: imgConfig.color,
          brightness: imgConfig.brightness,
          blur: imgConfig.blur,
          scale: imgConfig.scale,
          badge: imgConfig.badge,
          hover: imgConfig.hover
        }
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
      lastUpdatedTime: lastUpdatedTime || undefined,
      sortTime,
      filePath: file,
      cover,
      path,
      bookSrc
    });
  }
  
  return articles.sort((a, b) => new Date(b.sortTime).getTime() - new Date(a.sortTime).getTime());
}
