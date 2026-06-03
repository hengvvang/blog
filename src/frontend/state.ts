import { Article, Taxonomy, TaxonomyNode } from "../shared/types";

export interface AppState {
  ARTICLES: Article[];
  CATEGORIES: string[];
  TAXONOMY: Taxonomy | null;
  currentCategory: string;
  currentSubcat: string;
  currentSubtopic: string;
  pageSize: number;
}

export const state: AppState = {
  ARTICLES: [],
  CATEGORIES: [],
  TAXONOMY: null,
  currentCategory: 'home',
  currentSubcat: 'all',
  currentSubtopic: 'all',
  pageSize: 5
};

export async function loadState(): Promise<void> {
  const [articlesRes, taxonomyRes] = await Promise.all([
    fetch("/api/articles.json"),
    fetch("/api/taxonomy.json")
  ]);
  
  if (!articlesRes.ok) throw new Error("Fetch articles failed");
  if (!taxonomyRes.ok) throw new Error("Fetch taxonomy failed");
  
  state.ARTICLES = await articlesRes.json();
  state.TAXONOMY = await taxonomyRes.json();
  
  state.CATEGORIES = (state.TAXONOMY?.categories || []).map(cat => cat.key)
    .filter(cat => state.ARTICLES.some(a => a.category === cat));
    
  if (state.CATEGORIES.length === 0) {
    const scannedCats = new Set<string>();
    state.ARTICLES.forEach(a => {
      if (a.category) scannedCats.add(a.category);
    });
    state.CATEGORIES = Array.from(scannedCats);
  }
}

export function getCategoryEntry(category: string): TaxonomyNode | undefined {
  return state.TAXONOMY?.categories.find(cat => cat.key === category);
}

export function getSubcategoryKeys(category: string): string[] {
  const entry = getCategoryEntry(category);
  return (entry?.subcategories || []).map(sub => sub.key);
}

export function getSubtopicKeys(category: string, subcategory: string): string[] {
  const entry = getCategoryEntry(category);
  const subEntry = (entry?.subcategories || []).find(sub => sub.key === subcategory);
  return (subEntry?.subtopics || []).map(topic => topic.key);
}

export function getSortTime(article: Article): string {
  return article.sortTime || article.lastUpdatedTime || article.publishTime;
}
