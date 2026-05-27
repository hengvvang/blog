export interface CoverConfig {
  image?: string;
  text?: string;
  position?: 'topLeft' | 'bottomLeft' | 'center' | 'bottomRight' | 'topRight';
}

export interface Article {
  id: number;
  title: string;
  category: string;
  subcategory?: string;
  contentSnippet: string;
  publishTime: string;
  cover?: CoverConfig;
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
  cover?: CoverConfig;
}
