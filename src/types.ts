export interface CoverTextConfig {
  content?: string;
  position?: 'topLeft' | 'bottomLeft' | 'center' | 'bottomRight' | 'topRight';
  color?: string;
  size?: string;
}

export interface CoverImageConfig {
  src?: string;
  color?: string;
  brightness?: number;
  blur?: number;
  scale?: number;
  text?: CoverTextConfig;
}

export interface CoverConfig {
  image?: CoverImageConfig;
}

export interface Article {
  id: number;
  title: string;
  category: string;
  subcategory?: string;
  subtopic?: string;
  contentSnippet: string;
  publishTime: string;
  cover?: CoverConfig;
  path?: string;
}

export interface ArticleContent {
  html: string;
  title: string;
  publishTime: string;
  category: string;
  subcategory?: string;
  subtopic?: string;
  author: string;
  readingTime: string;
  wordCount: number;
  tags: string[];
  lastUpdated: string;
  cover?: CoverConfig;
}
