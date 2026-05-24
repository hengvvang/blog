import { Article } from "./types";
import {
  formatEnglishDate,
  getCategoryColor,
  categoryDirections,
  categoryOrders,
  slideDirs,
  getCategoryKeywordsHTML,
  onRowEnter,
  onRowLeave,
  stopAllSlideshows
} from "./utils";
import {
  renderNavHTML,
  renderHomeCollectionHTML,
  renderFeaturedCardHTML,
  renderListCardHTML,
  renderRelatedCardHTML,
  renderBottomBarHTML,
  renderSidebarMetaHTML,
  renderDetailViewHTML
} from "./components";

// State management
let CATEGORIES: string[] = ['rust', 'rtos', 'mcu', 'markup', 'c', 'toolchain'];
let ARTICLES: Article[] = [];
let currentCategory = 'home';
let currentSubcat = 'all';
let pageSize = 5;

// DOM references
const navBar = document.getElementById('nav-bar');
const articleGrid = document.getElementById('article-grid');

// Expose animation utility triggers and handlers to the global window
(window as any).onRowEnter = onRowEnter;
(window as any).onRowLeave = onRowLeave;

(window as any).backToHome = () => {
  window.location.hash = "#/";
};

(window as any).backToList = () => {
  window.location.hash = `#/category/${currentCategory}`;
};

(window as any).selectCategory = (cat: string) => {
  window.location.hash = `#/category/${cat}`;
};

(window as any).viewArticle = (id: number) => {
  window.location.hash = `#/article/${id}`;
};

(window as any).selectSubcat = (sub: string) => {
  window.location.hash = `#/category/${currentCategory}?subcat=${sub}`;
};

(window as any).loadMore = () => {
  pageSize += 5;
  renderPartition();
};

(window as any).scrollToTop = () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// Global scroll event listener for Back-to-Top button
window.addEventListener('scroll', () => {
  const btn = document.getElementById('back-top-btn');
  if (btn) {
    if (window.scrollY > 300) {
      btn.classList.add('show');
    } else {
      btn.classList.remove('show');
    }
  }
});

// Category options nav bar rendering
function renderNav() {
  if (!navBar) return;
  navBar.innerHTML = renderNavHTML(CATEGORIES, currentCategory);
}

// Category list and article grids rendering
function renderArticles() {
  if (!articleGrid) return;
  articleGrid.style.display = '';
  
  if (currentCategory === 'home') {
    articleGrid.className = 'home-collections-wrapper';
    articleGrid.innerHTML = CATEGORIES.map(cat => {
      const count = ARTICLES.filter(a => a.category === cat).length;
      const keywordsHTML = getCategoryKeywordsHTML(cat);
      const order = categoryOrders[cat] || [0, 1, 3, 2];
      return renderHomeCollectionHTML(cat, count, keywordsHTML, order);
    }).join('');
  } else {
    renderPartition();
  }
}

// Render subcategory list and article listing page
function renderPartition() {
  if (!articleGrid) return;
  stopAllSlideshows();
  
  articleGrid.className = 'toolchain-partition-wrapper';
  
  const allArticles = ARTICLES.filter(a => a.category === currentCategory);
  
  const subcatsSet = new Set<string>();
  allArticles.forEach(a => { if (a.subcategory) subcatsSet.add(a.subcategory); });
  const hasSubcats = subcatsSet.size > 0;
  
  const filteredArticles = (currentSubcat === 'all')
    ? allArticles
    : allArticles.filter(a => a.subcategory === currentSubcat);
  
  filteredArticles.sort((a, b) => new Date(b.publishTime).getTime() - new Date(a.publishTime).getTime());
  
  const featured = filteredArticles.slice(0, 3);
  const visibleList = filteredArticles.slice(0, pageSize);
  
  let tabsHTML = '';
  if (hasSubcats) {
    const subcats = ['all', ...Array.from(subcatsSet).sort()];
    tabsHTML = `<div class="toolchain-tabs">` + 
      subcats.map(sub => `
        <button class="toolchain-tab ${currentSubcat === sub ? 'active' : ''}" onclick="window.selectSubcat('${sub}')">` +
          (sub === 'all' ? '全部' : sub.toUpperCase()) +
        `</button>
      `).join('') +
    `</div>`;
  }
  
  const featuredHTML = featured.length > 0 
    ? `<div class="toolchain-featured-section">` +
        featured.map(art => renderFeaturedCardHTML(art, getCategoryColor(currentCategory))).join('') +
      `</div>`
    : '';
    
  const listHTML = visibleList.length > 0
    ? `<div class="toolchain-list-section">` +
        visibleList.map(art => renderListCardHTML(art, getCategoryColor(currentCategory))).join('') +
      `</div>`
    : (featured.length === 0 ? '<div class="toolchain-empty">没有找到相关文章。</div>' : '');
    
  const hasMore = filteredArticles.length > pageSize;
  const loadMoreHTML = hasMore
    ? `<div class="toolchain-loadmore-container">
        <button class="toolchain-loadmore-btn" onclick="window.loadMore()">更多</button>
      </div>`
    : '';
    
  articleGrid.innerHTML = `
    <!-- Top Featured section -->
    ${featuredHTML}
    
    <!-- Subcategory Tabs -->
    ${tabsHTML}
    
    <!-- Vertical List of regular cards -->
    ${listHTML}
    
    <!-- Load more button -->
    ${loadMoreHTML}
  `;
}

// Fetch article details content and render view
async function loadAndShowArticle(id: number) {
  const article = ARTICLES.find(a => a.id === id);
  if (!article) {
    window.location.hash = "#/";
    return;
  }

  if (navBar) navBar.style.display = 'none';
  if (articleGrid) articleGrid.style.display = 'none';

  let detailView = document.getElementById('article-detail-view');
  if (!detailView) {
    detailView = document.createElement('div');
    detailView.id = 'article-detail-view';
    detailView.className = 'article-detail-view';
    document.querySelector('.main-container')?.appendChild(detailView);
  }

  document.title = `${article.title} | Developer Blog`;

  const related = ARTICLES.filter(a => a.category === article.category && a.id !== article.id).slice(0, 5);
  const relatedArticlesHTML = related.map(rel => renderRelatedCardHTML(rel)).join('');

  const categoryArticles = ARTICLES.filter(a => a.category === article.category);
  const currIndex = categoryArticles.findIndex(a => a.id === article.id);
  const prevArticle = currIndex > 0 ? categoryArticles[currIndex - 1] : null;
  const nextArticle = currIndex < categoryArticles.length - 1 ? categoryArticles[currIndex + 1] : null;
  const bottomBarHTML = renderBottomBarHTML(prevArticle, nextArticle);

  detailView.style.display = 'block';
  detailView.innerHTML = renderDetailViewHTML(article, CATEGORIES, relatedArticlesHTML, bottomBarHTML);
  
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Load content dynamically from backend JSON endpoint
  try {
    const res = await fetch(`/api/article-content/${article.id}.json`);
    if (!res.ok) throw new Error("Load content failed");
    const data = await res.json();
    
    const bodyEl = detailView.querySelector('.detail-body');
    if (bodyEl) {
      bodyEl.innerHTML = `<div class="markdown-body">${data.html}</div>`;
    }

    const metaBoxEl = detailView.querySelector('#sidebar-meta-box');
    if (metaBoxEl) {
      const author = data.author || 'hengvvang';
      const pTime = data.publishTime || article.publishTime;
      const formattedDate = formatEnglishDate(pTime);
      
      const tagsHtml = data.tags && data.tags.length > 0 
        ? data.tags.map((tag: string) => `<span class="tag-badge">${tag}</span>`).join(' <span class="meta-divider">·</span> ')
        : `<span style="color: var(--text-light, #888);">None</span>`;
        
      const lastUpdatedHtml = data.lastUpdated
        ? `<div class="meta-row meta-updated">Updated on ${formatEnglishDate(data.lastUpdated)}</div>`
        : '';
        
      metaBoxEl.innerHTML = renderSidebarMetaHTML(
        author,
        formattedDate,
        tagsHtml,
        data.readingTime,
        data.wordCount || 0,
        lastUpdatedHtml
      );
    }
  } catch (err) {
    console.error(err);
    const bodyEl = detailView.querySelector('.detail-body');
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div class="error-container" style="color: #a84545; padding: 20px; border: 1px solid #a84545; background-color: rgba(168,69,69,0.05); border-radius: 4px; text-align: center;">
          <p>加载文章内容失败，请稍后重试。</p>
        </div>
      `;
    }
    const metaBoxEl = detailView.querySelector('#sidebar-meta-box');
    if (metaBoxEl) {
      metaBoxEl.innerHTML = `<div style="color: #a84545; font-size: 13px; text-align: center; padding: 20px 0;">Failed to load metadata.</div>`;
    }
  }
}

// Router matcher & hash parser
function handleRouting() {
  const hash = window.location.hash || "#/";
  
  if (hash === "#/" || hash === "#") {
    currentCategory = "home";
    currentSubcat = "all";
    if (navBar) navBar.style.display = "flex";
    const detailView = document.getElementById("article-detail-view");
    if (detailView) detailView.style.display = "none";
    
    document.title = "Developer Blog | Home";
    renderNav();
    renderArticles();
  } else if (hash.startsWith("#/category/")) {
    const parts = hash.substring(11).split("?");
    const category = parts[0];
    let subcat = "all";
    
    if (parts[1] && parts[1].startsWith("subcat=")) {
      subcat = parts[1].substring(7);
    }
    
    currentCategory = category;
    currentSubcat = subcat;
    pageSize = 5;
    
    if (navBar) navBar.style.display = "flex";
    const detailView = document.getElementById("article-detail-view");
    if (detailView) detailView.style.display = "none";
    
    document.title = `${category.toUpperCase()} | Developer Blog`;
    renderNav();
    renderArticles();
  } else if (hash.startsWith("#/article/")) {
    const articleIdStr = hash.substring(10);
    const id = parseInt(articleIdStr, 10);
    loadAndShowArticle(id);
  }
}

// App bootstrapping
async function initBlog() {
  try {
    const res = await fetch("/api/articles.json");
    if (!res.ok) throw new Error("Fetch articles failed");
    ARTICLES = await res.json();
    
    // Parse categories from articles
    const scannedCats = new Set<string>();
    ARTICLES.forEach(a => {
      if (a.category) scannedCats.add(a.category);
    });
    
    const defaultCats = ['rust', 'rtos', 'mcu', 'markup', 'c', 'toolchain'];
    const allCats = new Set([...defaultCats, ...Array.from(scannedCats)]);
    CATEGORIES = Array.from(allCats).filter(cat => ARTICLES.some(a => a.category === cat));
    if (CATEGORIES.length === 0) {
      CATEGORIES = defaultCats;
    }
    
    // Initialize slideshow configurations
    CATEGORIES.forEach(cat => {
      if (!categoryDirections[cat]) {
        categoryDirections[cat] = slideDirs[Math.floor(Math.random() * slideDirs.length)];
      }
      if (!categoryOrders[cat]) {
        const order = [0, 1, 2];
        const mediaPos = Math.floor(Math.random() * 4);
        order.splice(mediaPos, 0, 3);
        categoryOrders[cat] = order;
      }
    });
    
    // Bind hashchange routing listener
    window.addEventListener("hashchange", handleRouting);
    handleRouting();
    
  } catch (err) {
    console.error("Initialization failed", err);
    if (articleGrid) {
      articleGrid.innerHTML = `
        <div style="color: #a84545; padding: 40px; text-align: center; font-size: 16px;">
          加载博客数据失败，请确保后端服务已启动并正常运行。
        </div>
      `;
    }
  }
}

// Boot
initBlog();
