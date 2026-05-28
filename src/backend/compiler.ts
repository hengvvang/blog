import { marked } from "marked";
import { parseFrontMatter, calculateWordCount, parseTags, ArticleMetadata } from "./parser";
import { ArticleContent } from "../types";

export async function compileArticleToContent(article: ArticleMetadata): Promise<ArticleContent> {
  const content = await Bun.file(article.filePath).text();
  const { meta, markdown } = parseFrontMatter(content);
  const html = await marked.parse(markdown);
  const wordCount = calculateWordCount(markdown);
  const tags = parseTags(meta.tags);
  const author = meta.author || "hengvvang";
  const readingTime = meta.readingTime || "10 min";
  const lastUpdated = meta.lastUpdated || "";
  
  return {
    html,
    title: article.title,
    publishTime: article.publishTime,
    category: article.category,
    subcategory: article.subcategory,
    subtopic: article.subtopic,
    author,
    readingTime,
    wordCount,
    tags,
    lastUpdated,
    cover: article.cover
  };
}
