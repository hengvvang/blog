import { Article } from "./types";
import {
  formatEnglishDate,
  getCategoryColor,
  categoryDirections,
  categoryOrders,
  slideDirs,
  getCategoryHomeElementsHTML,
  onRowEnter,
  onRowLeave,
  stopAllSlideshows,
  formatSubcategory
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

type TaxonomyNode = {
  key: string;
  latestTime: string;
  subcategories?: TaxonomyNode[];
  subtopics?: TaxonomyNode[];
};

type Taxonomy = {
  categories: TaxonomyNode[];
};

// State management
let CATEGORIES: string[] = [];
let ARTICLES: Article[] = [];
let TAXONOMY: Taxonomy | null = null;
let currentCategory = 'home';
let currentSubcat = 'all';
let currentSubtopic = 'all';
let pageSize = 5;

// DOM references
const navBar = document.getElementById('nav-bar');
const articleGrid = document.getElementById('article-grid');

function getCategoryEntry(category: string): TaxonomyNode | undefined {
  return TAXONOMY?.categories.find(cat => cat.key === category);
}

function getSubcategoryKeys(category: string): string[] {
  const entry = getCategoryEntry(category);
  return (entry?.subcategories || []).map(sub => sub.key);
}

function getSubtopicKeys(category: string, subcategory: string): string[] {
  const entry = getCategoryEntry(category);
  const subEntry = (entry?.subcategories || []).find(sub => sub.key === subcategory);
  return (subEntry?.subtopics || []).map(topic => topic.key);
}

function getSortTime(article: Article): string {
  return article.sortTime || article.lastUpdatedTime || article.publishTime;
}

// Global Click Event Delegation
document.body.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const actionEl = target.closest('[data-action]');
  if (!actionEl) return;
  
  const action = actionEl.getAttribute('data-action');
  
  if (action === 'select-category') {
    const cat = actionEl.getAttribute('data-cat');
    if (cat) {
      if (cat === 'home') {
        window.location.hash = '#/';
      } else {
        window.location.hash = `#/category/${cat}?subcat=all&subtopic=all`;
      }
    }
  } else if (action === 'view-article') {
    const idStr = actionEl.getAttribute('data-id');
    if (idStr) {
      const art = ARTICLES.find(a => String(a.id) === idStr);
      if (art && art.path) {
        window.location.href = art.path;
      } else {
        window.location.hash = `#/article/${idStr}`;
      }
    }
  } else if (action === 'back-to-home') {
    window.location.hash = '#/';
  } else if (action === 'back-to-list') {
    window.location.hash = `#/category/${currentCategory}?subcat=${currentSubcat}&subtopic=${currentSubtopic}`;
  } else if (action === 'select-subcat') {
    const sub = actionEl.getAttribute('data-sub');
    if (sub) {
      window.location.hash = `#/category/${currentCategory}?subcat=${sub}&subtopic=all`;
    }
  } else if (action === 'select-subtopic') {
    const topic = actionEl.getAttribute('data-topic');
    if (topic) {
      window.location.hash = `#/category/${currentCategory}?subcat=${currentSubcat}&subtopic=${topic}`;
    }
  } else if (action === 'load-more') {
    pageSize += 5;
    renderPartition();
  } else if (action === 'scroll-to-top') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (action === 'switch-meta-tab') {
    const tabName = actionEl.getAttribute('data-tab');
    if (tabName) {
      const tabs = document.querySelectorAll('.sidebar-tab');
      tabs.forEach(t => {
        if (t.getAttribute('data-tab') === tabName) {
          t.classList.add('active');
        } else {
          t.classList.remove('active');
        }
      });
      const contents = document.querySelectorAll('.sidebar-tab-content');
      contents.forEach(c => {
        const id = c.getAttribute('id');
        if (id === `tab-content-${tabName}`) {
          c.classList.add('active');
        } else {
          c.classList.remove('active');
        }
      });
      const recCard = document.getElementById('sidebar-recommendations');
      if (recCard) {
        recCard.style.display = tabName === 'info' ? 'block' : 'none';
      }
    }
  } else if (action === 'scroll-to-heading') {
    const targetId = actionEl.getAttribute('data-target');
    if (targetId) {
      const targetHeading = document.getElementById(targetId);
      if (targetHeading) {
        targetHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }
});

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
      const categoryEntry = TAXONOMY?.categories.find(c => c.key === cat);
      const rawSubcats = (categoryEntry?.subcategories || []).map(sub => sub.key);
      const formattedSubcats = rawSubcats.map(sub => formatSubcategory(sub));
      
      const { keywordsHTML, iconsHTML } = getCategoryHomeElementsHTML(cat, formattedSubcats);
      const order = categoryOrders[cat] || [0, 1, 3, 2];
      return renderHomeCollectionHTML(cat, count, keywordsHTML, order, iconsHTML);
    }).join('');
    
    // Programmatically bind hover events for the animated slideshow rows
    const rows = articleGrid.querySelectorAll('.home-collection');
    rows.forEach(row => {
      const cat = row.getAttribute('data-cat');
      if (cat) {
        row.addEventListener('mouseenter', () => onRowEnter(cat));
        row.addEventListener('mouseleave', () => onRowLeave(cat));
      }
    });
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
  
  // Determine subcategories for left sidebar
  const subcats = ["all", ...getSubcategoryKeys(currentCategory)];
  if (!subcats.includes(currentSubcat)) {
    currentSubcat = "all";
  }
  
  // Render Subcategory Tabs HTML (same style as toolchain-tabs)
  const subcatTabsHTML = `<div class="toolchain-tabs">` + 
    subcats.map(sub => {
      const activeClass = currentSubcat === sub ? 'active' : '';
      const displayLabel = sub === 'all' ? '全部' : sub.toUpperCase();
      return `<button class="toolchain-tab ${activeClass}" data-action="select-subcat" data-sub="${sub}">${displayLabel}</button>`;
    }).join('') +
  `</div>`;
  
  // Filter articles and handle subtopic tabs for all categories
  let filteredArticles: Article[] = [];
  let tabsHTML = '';
  
  const subcatArticles = currentSubcat === "all"
    ? allArticles
    : allArticles.filter(a => a.subcategory === currentSubcat);

  // Sort subcategory articles by sortTime descending first
  subcatArticles.sort((a, b) => new Date(getSortTime(b)).getTime() - new Date(getSortTime(a)).getTime());
  
  // Find unique subtopics for this subcategory
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
  
  if (hasTopics) {
    const topics = currentSubcat === 'all'
      ? ['all', ...Array.from(topicsMap.entries()).sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime()).map(([topic]) => topic)]
      : ['all', ...getSubtopicKeys(currentCategory, currentSubcat)];
    tabsHTML = `<div class="toolchain-tabs">` + 
      topics.map(topic => `
        <button class="toolchain-tab ${currentSubtopic === topic ? 'active' : ''}" data-action="select-subtopic" data-topic="${topic}">` +
          (topic === 'all' ? '全部' : topic.toUpperCase()) +
        `</button>
      `).join('') +
    `</div>`;
    if (!topics.includes(currentSubtopic)) {
      currentSubtopic = 'all';
    }
  }
  
  filteredArticles = (currentSubtopic === 'all')
    ? subcatArticles
    : subcatArticles.filter(a => a.subtopic === currentSubtopic);
  
  // The featured cards are always the latest 4 articles under the selected subcategory
  const featured = subcatArticles.slice(0, 4);
  const visibleList = filteredArticles.slice(0, pageSize);
  
  const featuredHTML = featured.length > 0 
    ? `<div class="toolchain-featured-section">` +
        featured.map(art => renderFeaturedCardHTML(art, getCategoryColor(art.subcategory || currentCategory))).join('') +
      `</div>`
    : '';
    
  const listHTML = visibleList.length > 0
    ? `<div class="toolchain-list-section">` +
        visibleList.map(art => renderListCardHTML(art, getCategoryColor(art.subcategory || currentCategory))).join('') +
      `</div>`
    : (featured.length === 0 ? '<div class="toolchain-empty">没有找到相关文章。</div>' : '');
    
  const hasMore = filteredArticles.length > pageSize;
  const loadMoreHTML = hasMore
    ? `<div class="toolchain-loadmore-container">
        <button class="toolchain-loadmore-btn" data-action="load-more">更多</button>
      </div>`
    : '';
    
  articleGrid.innerHTML = `
    <!-- Right Content Area -->
    <div class="genshin-content-container">
      <!-- Category Tabs (Horizontal Pills) -->
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
      const pTime = data.lastUpdatedTime || article.lastUpdatedTime || data.publishTime || article.publishTime;
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

    const outlineBoxEl = detailView.querySelector('#sidebar-outline-box');
    if (bodyEl && outlineBoxEl) {
      const headings = bodyEl.querySelectorAll('.markdown-body h2, .markdown-body h3');
      const outlineItems: { text: string; id: string; level: number }[] = [];
      
      headings.forEach((heading, idx) => {
        const id = `heading-${idx}`;
        heading.id = id;
        outlineItems.push({
          text: heading.textContent || '',
          id: id,
          level: heading.tagName === 'H2' ? 2 : 3
        });
      });
      
      if (outlineItems.length > 0) {
        outlineBoxEl.innerHTML = `
          <div class="outline-list">
            ${outlineItems.map(item => `
              <div class="outline-item outline-level-${item.level}" data-action="scroll-to-heading" data-target="${item.id}">
                <span class="outline-bullet"></span>
                <span class="outline-text">${item.text}</span>
              </div>
            `).join('')}
          </div>
        `;
      } else {
        outlineBoxEl.innerHTML = `<div class="outline-empty">该文章无大纲目录</div>`;
      }
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
    const outlineBoxEl = detailView.querySelector('#sidebar-outline-box');
    if (outlineBoxEl) {
      outlineBoxEl.innerHTML = `<div style="color: #a84545; font-size: 13px; text-align: center; padding: 20px 0;">Failed to load outline.</div>`;
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
    let subtopic = "all";
    
    if (parts[1]) {
      const searchParams = new URLSearchParams(parts[1]);
      subcat = searchParams.get("subcat") || "all";
      subtopic = searchParams.get("subtopic") || "all";
    }
    
    currentCategory = category;
    currentSubcat = subcat;
    currentSubtopic = subtopic;
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
    const art = ARTICLES.find(a => a.id === id);
    if (art && art.path) {
      window.location.replace(art.path);
    } else {
      loadAndShowArticle(id);
    }
  }
}

// App bootstrapping
async function initBlog() {
  try {
    const [articlesRes, taxonomyRes] = await Promise.all([
      fetch("/api/articles.json"),
      fetch("/api/taxonomy.json")
    ]);
    if (!articlesRes.ok) throw new Error("Fetch articles failed");
    if (!taxonomyRes.ok) throw new Error("Fetch taxonomy failed");
    ARTICLES = await articlesRes.json();
    TAXONOMY = await taxonomyRes.json();
    
    CATEGORIES = (TAXONOMY?.categories || []).map(cat => cat.key)
      .filter(cat => ARTICLES.some(a => a.category === cat));
    if (CATEGORIES.length === 0) {
      const scannedCats = new Set<string>();
      ARTICLES.forEach(a => {
        if (a.category) scannedCats.add(a.category);
      });
      CATEGORIES = Array.from(scannedCats);
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
