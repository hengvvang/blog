import { state, getSubcategoryKeys, getSubtopicKeys, getSortTime } from "../state";
import { stopAllSlideshows } from "../utils/slideshow";
import { getCategoryColor } from "../utils/theme";
import { renderFeaturedCardHTML, renderListCardHTML } from "../components/Card";
import { Article } from "../../shared/types";

export const CategoryView = {
  render(container: HTMLElement) {
    stopAllSlideshows();
    
    container.style.display = '';
    container.className = 'toolchain-partition-wrapper';
    
    const allArticles = state.ARTICLES.filter(a => a.category === state.currentCategory);
    
    // Determine subcategories for nav pills
    const subcats = ["all", ...getSubcategoryKeys(state.currentCategory)];
    if (!subcats.includes(state.currentSubcat)) {
      state.currentSubcat = "all";
    }
    
    // Render Subcategory Tabs HTML
    const subcatTabsHTML = `<div class="toolchain-tabs">` + 
      subcats.map(sub => {
        const activeClass = state.currentSubcat === sub ? 'active' : '';
        const displayLabel = sub === 'all' ? '全部' : sub.toUpperCase();
        return `<button class="toolchain-tab ${activeClass}" data-action="select-subcat" data-sub="${sub}">${displayLabel}</button>`;
      }).join('') +
    `</div>`;
    
    // Filter subcategory articles
    const subcatArticles = state.currentSubcat === "all"
      ? allArticles
      : allArticles.filter(a => a.subcategory === state.currentSubcat);

    // Sort subcategory articles by sortTime descending
    subcatArticles.sort((a, b) => new Date(getSortTime(b)).getTime() - new Date(getSortTime(a)).getTime());
    
    // Find unique subtopics
    const topicsMap = new Map<string, string>();
    subcatArticles.forEach(a => {
      if (!a.subtopic) return;
      const current = topicsMap.get(a.subtopic);
      const candidate = getSortTime(a);
      if (!current || new Date(candidate).getTime() > new Date(current).getTime()) {
        topicsMap.set(a.subtopic, candidate);
      }
    });
    const hasTopics = topicsMap.size > 0;
    
    let tabsHTML = '';
    if (hasTopics) {
      const topics = state.currentSubcat === 'all'
        ? ['all', ...Array.from(topicsMap.entries()).sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime()).map(([topic]) => topic)]
        : ['all', ...getSubtopicKeys(state.currentCategory, state.currentSubcat)];
      
      tabsHTML = `<div class="toolchain-tabs">` + 
        topics.map(topic => `
          <button class="toolchain-tab ${state.currentSubtopic === topic ? 'active' : ''}" data-action="select-subtopic" data-topic="${topic}">` +
            (topic === 'all' ? '全部' : topic.toUpperCase()) +
          `</button>
        `).join('') +
      `</div>`;
      
      if (!topics.includes(state.currentSubtopic)) {
        state.currentSubtopic = 'all';
      }
    }
    
    const filteredArticles = (state.currentSubtopic === 'all')
      ? subcatArticles
      : subcatArticles.filter(a => a.subtopic === state.currentSubtopic);
    
    // Latest 4 articles are featured
    const featured = subcatArticles.slice(0, 4);
    const visibleList = filteredArticles.slice(0, state.pageSize);
    
    const featuredHTML = featured.length > 0 
      ? `<div class="toolchain-featured-section">` +
          featured.map(art => renderFeaturedCardHTML(art, getCategoryColor(art.subcategory || state.currentCategory))).join('') +
        `</div>`
      : '';
      
    let listHTML = '';
    if (visibleList.length > 0) {
      const leftCards: Article[] = [];
      const rightCards: Article[] = [];
      visibleList.forEach((art, idx) => {
        if (idx % 2 === 0) {
          leftCards.push(art);
        } else {
          rightCards.push(art);
        }
      });
      
      const leftHTML = leftCards.map(art => renderListCardHTML(art, getCategoryColor(art.subcategory || state.currentCategory))).join('');
      const rightHTML = rightCards.map(art => renderListCardHTML(art, getCategoryColor(art.subcategory || state.currentCategory))).join('');
      
      listHTML = `
        <div class="toolchain-list-section">
          <div class="toolchain-list-column">${leftHTML}</div>
          <div class="toolchain-list-column">${rightHTML}</div>
        </div>
      `;
    } else {
      listHTML = featured.length === 0 ? '<div class="toolchain-empty">没有找到相关文章。</div>' : '';
    }
      
    const hasMore = filteredArticles.length > state.pageSize;
    const loadMoreHTML = hasMore
      ? `<div class="toolchain-loadmore-container">
          <button class="toolchain-loadmore-btn" data-action="load-more">更多</button>
        </div>`
      : '';
      
    container.innerHTML = `
      <div class="genshin-content-container">
        <!-- Category Tabs -->
        ${subcatTabsHTML}
  
        <!-- Top Featured section -->
        ${featuredHTML}
        
        <!-- Subtopic Tabs -->
        ${tabsHTML}
        
        <!-- Vertical List of regular cards -->
        ${listHTML}
        
        <!-- Load more button -->
        ${loadMoreHTML}
      </div>
    `;
  }
};
