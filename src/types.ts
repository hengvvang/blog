export interface Article {
  id: number;
  title: string;
  category: string;
  subcategory?: string;
  contentSnippet: string;
  publishTime: string;
  cover?: string;
  coverText?: { position: string; context: string };
}

export interface ArticleContent {
  html: string;
  title: string;
  publishTime: string;
  category: string;
  subcategory?: string;
  author: string;
  readingTime: string;
  wordCount: number;
  tags: string[];
  lastUpdated: string;
  cover?: string;
  coverText?: { position: string; context: string };
}
