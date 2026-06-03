export interface CoverTextConfig {
  content?: string;
  text?: string;
  position?: 'topLeft' | 'bottomLeft' | 'center' | 'bottomRight' | 'topRight' | 'top-left' | 'bottom-left' | 'bottom-right' | 'top-right';
  color?: string;
  size?: string;
}

export interface CoverImageHoverConfig {
  scale?: number;
  brightness?: number;
  rotate?: number;
  blur?: string | number;
}

export interface CoverImageConfig {
  src?: string;
  image?: string; // legacy support
  color?: string;
  brightness?: number;
  blur?: number;
  scale?: number;
  text?: CoverTextConfig;
  badge?: CoverTextConfig;
  hover?: CoverImageHoverConfig;
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
  lastUpdatedTime?: string;
  sortTime: string;
  cover?: CoverConfig;
  path?: string;
}

export interface ArticleContent {
  html: string;
  title: string;
  publishTime: string;
  lastUpdatedTime?: string;
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
