interface Article {
  id: number;
  title: string;
  category: string;
  subcategory?: string;
  contentSnippet: string;
  publishTime: string;
}

let CATEGORIES: string[] = ['rust', 'rtos', 'mcu', 'markup', 'c', 'toolchain'];
let ARTICLES: Article[] = [];
let currentCategory = 'home';
let currentSubcat = 'all';
let pageSize = 5;

function formatDate(dateStr: string): string {
  const parts = dateStr.split(' ')[0].split('-');
  if (parts.length === 3) {
    return `${parts[0]}年${parts[1]}月${parts[2]}日`;
  }
  return dateStr;
}

// Category icons
const ICONS: Record<string, string> = {
  rust: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
  rtos: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  mcu: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="15" x2="23" y2="15"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="15" x2="4" y2="15"></line></svg>`,
  markup: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
  c: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`,
  toolchain: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`
};

const DEFAULT_ICON = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

// Category preview slideshow text keywords
const KEYWORDS: Record<string, string[]> = {
  rust: ['Cargo', 'Rustc', 'Clippy', 'Tokio', 'Wasm'],
  rtos: ['FreeRTOS', 'RT-Thread', 'Zephyr', 'uCOS', 'ThreadX'],
  mcu: ['STM32', 'ESP32', 'GD32', 'MSP430', 'AVR'],
  markup: ['Markdown', 'HTML', 'CSS', 'LaTeX', 'XML'],
  c: ['C99', 'C11', 'Pointer', 'Volatile', 'Makefile'],
  toolchain: ['CMake', 'GCC', 'GDB', 'Git', 'Clang', 'LLVM']
};

const slideshowTimers: Record<string, any> = {};

const slideDirs = [
  { in: 'translate(-50%, 150%)', out: 'translate(-50%, -150%)' }, // bottom to top
  { in: 'translate(-50%, -150%)', out: 'translate(-50%, 150%)' }, // top to bottom
  { in: 'translate(150%, -50%)', out: 'translate(-150%, -50%)' }, // right to left
  { in: 'translate(-150%, -50%)', out: 'translate(150%, -50%)' }  // left to right
];
const categoryDirections: Record<string, typeof slideDirs[0]> = {};
const categoryOrders: Record<string, number[]> = {};

const navBar = document.getElementById('nav-bar');
const articleGrid = document.getElementById('article-grid');

(window as any).onRowEnter = (cat: string) => {
  if (slideshowTimers[cat]) clearInterval(slideshowTimers[cat]);
  
  const wrapper = document.querySelector(`.media-wrapper[data-category="${cat}"]`);
  if (!wrapper) return;
  const texts = wrapper.querySelectorAll('.media-text');
  if (texts.length === 0) return;
  
  let currActive = -1;
  for (let i = 0; i < texts.length; i++) {
    if (texts[i].classList.contains('js-active')) {
      currActive = i;
      break;
    }
  }
  if (currActive === -1) {
    currActive = 0;
    const el = texts[currActive] as HTMLElement;
    el.classList.add('js-active');
    el.style.transform = 'translate(-50%, -50%)';
  }
  
  if (texts.length > 1) {
    const fixedDir = categoryDirections[cat] || slideDirs[0];
    
    slideshowTimers[cat] = setInterval(() => {
      let curr = -1;
      for (let i = 0; i < texts.length; i++) {
        if (texts[i].classList.contains('js-active')) {
          curr = i;
          break;
        }
      }
      
      if (curr !== -1) {
        const nextActive = (curr + 1) % texts.length;
        const rnd = fixedDir;
        const currEl = texts[curr] as HTMLElement;
        const nextEl = texts[nextActive] as HTMLElement;
        
        nextEl.style.transition = 'none';
        nextEl.style.transform = rnd.in;
        
        void nextEl.offsetWidth;
        
        nextEl.style.transition = '';
        currEl.style.transition = '';
        
        currEl.classList.remove('js-active');
        currEl.style.transform = rnd.out;
        
        nextEl.classList.add('js-active');
        nextEl.style.transform = 'translate(-50%, -50%)';
      }
    }, 600);
  }
};

(window as any).onRowLeave = (cat: string) => {
  if (slideshowTimers[cat]) {
    clearInterval(slideshowTimers[cat]);
    delete slideshowTimers[cat];
  }
};

function stopAllSlideshows() {
  Object.keys(slideshowTimers).forEach(cat => {
    clearInterval(slideshowTimers[cat]);
    delete slideshowTimers[cat];
  });
}

function getCategoryKeywordsHTML(cat: string): string {
  const list = KEYWORDS[cat] || ['Code', 'Tech', 'Doc', 'Dev', 'System'];
  const initialIndex = Math.floor(Math.random() * list.length);
  return list.map((word, i) => `<span class="media-text ${i === initialIndex ? 'js-active' : ''}">${word}</span>`).join('');
}

function renderNav() {
  if (!navBar) return;
  navBar.innerHTML = '';
  
  // Add Home option
  const homeBtn = document.createElement('button');
  homeBtn.className = `nav-item ${currentCategory === 'home' ? 'active' : ''}`;
  homeBtn.textContent = '首页';
  homeBtn.onclick = () => {
    window.location.hash = "#/";
  };
  navBar.appendChild(homeBtn);
  
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `nav-item ${cat === currentCategory ? 'active' : ''}`;
    btn.textContent = cat;
    btn.onclick = () => {
      window.location.hash = `#/category/${cat}`;
    };
    navBar.appendChild(btn);
  });
}

function renderPartition() {
  if (!articleGrid) return;
  stopAllSlideshows();
  
  articleGrid.className = 'toolchain-partition-wrapper';
  
  const allArticles = ARTICLES.filter(a => a.category === currentCategory);
  
  const subcatsSet = new Set<string>();
  allArticles.forEach(a => { if (a.subcategory) subcatsSet.add(a.subcategory); });
  const hasSubcats = subcatsSet.size > 0;
  
  // Filter articles based on subcategory first, and make sure they are sorted by time (newest first)
  const filteredArticles = (currentSubcat === 'all')
    ? allArticles
    : allArticles.filter(a => a.subcategory === currentSubcat);
  
  filteredArticles.sort((a, b) => new Date(b.publishTime).getTime() - new Date(a.publishTime).getTime());
  
  // Featured is the top 3 newest of the filtered articles
  const featured = filteredArticles.slice(0, 3);
  
  // The list below displays ALL filtered articles sorted by time
  const listArticles = filteredArticles;
  
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
        featured.map(art => {
          const badgeText = (art.subcategory || currentCategory).toUpperCase();
          return `
            <div class="card toolchain-horizontal-card" onclick="window.viewArticle(${art.id})">
                <div class="card-cover-wrapper" style="height: auto; display: flex; flex-direction: column; gap: 8px; padding: 8px 16px 12px 16px;">
                  <div style="text-align: right; width: 100%; margin-bottom: 0px; line-height: 1;">
                    <span class="featured-date" style="font-size: 12px; color: var(--text-light, #888);">${art.publishTime}</span>
                  </div>
                  <div class="featured-cover" style="background: linear-gradient(135deg, ${getCategoryColor(currentCategory)} 0%, #1e222b 100%);">
                    <div class="featured-subcat-badge">${badgeText}</div>
                    <span class="featured-cover-text">${badgeText} 技术精选</span>
                  </div>
                  <div class="featured-info" style="padding: 0;">
                    <h4 class="featured-title" style="margin: 4px 0; font-size: 16px;">${art.title}</h4>
                    <p class="featured-snippet" style="font-size: 12px; margin: 0; -webkit-line-clamp: 2;">${art.contentSnippet}</p>
                </div>
              </div>
              <div class="card-content">
                <div class="card-title-container">
                  <p class="card-title" style="visibility: hidden;">${art.title}</p>
                </div>
                <div class="card-btn-container">
                  <div class="card-btn">
                    <img src="https://fastcdn.hoyoverse.com/static-resource-v2/2024/03/21/882dcd6829a489afda8ba322eb982e7d_2051193489758981573.png" alt="arrow" />
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('') +
      `</div>`
    : '';
    
  const visibleList = listArticles.slice(0, pageSize);
  const listHTML = visibleList.length > 0
    ? `<div class="toolchain-list-section">` +
        visibleList.map(art => {
          const badgeText = (art.subcategory || currentCategory).toUpperCase();
          return `
            <div class="card" style="width: 100%;" onclick="window.viewArticle(${art.id})">
              <div class="card-cover-wrapper" style="width: 100%; height: auto; display: flex; gap: 24px;">
                <div class="list-card-cover" style="background: linear-gradient(135deg, ${getCategoryColor(currentCategory)} 0%, #2e3440 100%);">
                  <span class="list-cover-badge">${badgeText}</span>
                </div>
                <div class="list-card-info" style="padding: 0; flex-grow: 1;">
                  <div class="list-card-header">
                    <span class="list-card-badge">${badgeText}</span>
                    <span class="list-card-date">${art.publishTime}</span>
                  </div>
                  <h4 class="list-card-title">${art.title}</h4>
                  <p class="list-card-snippet">${art.contentSnippet}</p>
                </div>
              </div>
              <div class="card-content" style="width: 100%;">
                <div class="card-title-container">
                  <p class="card-title" style="visibility: hidden;">${art.title}</p>
                </div>
                <div class="card-btn-container">
                  <div class="card-btn">
                    <img src="https://fastcdn.hoyoverse.com/static-resource-v2/2024/03/21/882dcd6829a489afda8ba322eb982e7d_2051193489758981573.png" alt="arrow" />
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('') +
      `</div>`
    : (featured.length === 0 ? '<div class="toolchain-empty">没有找到相关文章。</div>' : '');
    
  const hasMore = listArticles.length > pageSize;
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

(window as any).selectSubcat = (sub: string) => {
  window.location.hash = `#/category/${currentCategory}?subcat=${sub}`;
};

(window as any).loadMore = () => {
  pageSize += 5;
  renderPartition();
};

function renderArticles() {
  if (!articleGrid) return;
  
  articleGrid.style.display = '';
  
  if (currentCategory === 'home') {
    articleGrid.className = 'home-collections-wrapper';
    
    articleGrid.innerHTML = CATEGORIES.map((cat, index) => {
      const count = ARTICLES.filter(a => a.category === cat).length;
      const formattedCount = String(count).padStart(2, '0');
      const iconSVG = ICONS[cat] || DEFAULT_ICON;
      
      const iconHTML = `<div class="collection-icon">${iconSVG}</div>`;
      const nameHTML = `<h3 class="collection-name">${cat.toUpperCase()}</h3>`;
      const countHTML = `<h3 class="collection-count">(${formattedCount})</h3>`;
      const mediaHTML = `
        <div class="media-wrapper" data-category="${cat}" style="background-color: ${getCategoryColor(cat)};">
          ${getCategoryKeywordsHTML(cat)}
        </div>
      `;
      
      const elements = [iconHTML, nameHTML, countHTML, mediaHTML];
      const order = categoryOrders[cat] || [0, 1, 3, 2];
      const rowContent = order.map(idx => elements[idx]).join('');
      
      return `
        <div class="home-collection" onclick="window.selectCategory('${cat}')" onmouseenter="window.onRowEnter('${cat}')" onmouseleave="window.onRowLeave('${cat}')">
          <div class="collection-inner">
            ${rowContent}
          </div>
        </div>
      `;
    }).join('');
  } else {
    renderPartition();
  }
}

const categoryColors: Record<string, string> = {};

function getCategoryColor(cat: string): string {
  if (!categoryColors[cat]) {
    // Generate a random high-quality muted HSL color
    const h = Math.floor(Math.random() * 360);
    const s = Math.floor(Math.random() * 20) + 40; // 40% - 60% saturation (soft, premium)
    const l = Math.floor(Math.random() * 15) + 35; // 35% - 50% lightness (good contrast)
    categoryColors[cat] = `hsl(${h}, ${s}%, ${l}%)`;
  }
  return categoryColors[cat];
}

// Scroll event listener for Back-to-Top button
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

(window as any).scrollToTop = () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

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

  // Get 5 related articles in the same category (excluding current)
  const related = ARTICLES.filter(a => a.category === article.category && a.id !== article.id).slice(0, 5);
  const relatedArticlesHTML = related.map(rel => {
    return `
      <div class="card sidebar-item-card" onclick="window.viewArticle(${rel.id})" style="margin-bottom: 8px;">
        <div class="card-cover-wrapper" style="border: none; padding: 0; height: auto; min-height: auto; width: 100%;">
          <div class="sidebar-item-inner" style="display: flex; align-items: center; gap: 12px; padding: 10px 10px 22px 10px;">
            <!-- Thumbnail on the left -->
            <div class="sidebar-thumb" style="background-color: ${getCategoryColor(rel.category)}; width: 80px; height: 52px; flex-shrink: 0; border-radius: 4px; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; box-shadow: inset 0 0 8px rgba(0,0,0,0.12);">
              <span style="font-family: 'Outfit', sans-serif; font-size: 9px; font-weight: 700; color: #ffffff; letter-spacing: 0.05em; text-transform: uppercase;">
                ${rel.category}
              </span>
            </div>
            <!-- Text Content on the right -->
            <div class="sidebar-item-info" style="margin: 0; flex-grow: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden; width: auto; min-width: 0;">
              <!-- Date in the upper right -->
              <div style="display: flex; justify-content: flex-end; width: 100%; margin-bottom: 2px;">
                <span style="font-size: 10px; color: var(--text-light, #888); line-height: 1;">${rel.publishTime}</span>
              </div>
              <!-- Title -->
              <p class="sidebar-item-title" style="font-size: 13px; line-height: 1.3; color: var(--text-dark); margin: 0; font-weight: 600; text-align: left; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${rel.title}</p>
            </div>
          </div>
        </div>
        <div class="card-content" style="width: 100%;">
          <div class="card-title-container">
            <p class="card-title" style="visibility: hidden;">${rel.title}</p>
          </div>
          <div class="card-btn-container">
            <div class="card-btn">
              <img src="https://fastcdn.hoyoverse.com/static-resource-v2/2024/03/21/882dcd6829a489afda8ba322eb982e7d_2051193489758981573.png" alt="arrow" />
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Get previous and next articles in the same category
  const categoryArticles = ARTICLES.filter(a => a.category === article.category);
  const currIndex = categoryArticles.findIndex(a => a.id === article.id);
  const prevArticle = currIndex > 0 ? categoryArticles[currIndex - 1] : null;
  const nextArticle = currIndex < categoryArticles.length - 1 ? categoryArticles[currIndex + 1] : null;

  let bottomBarHTML = '';
  if (prevArticle || nextArticle) {
    bottomBarHTML = `
      <div class="detail-bottom-bar">
        ${prevArticle 
          ? `<a class="bottombar-prev" onclick="window.viewArticle(${prevArticle.id})">
              <svg class="nav-arrow" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
              <div class="nav-link-info">
                <span class="nav-label">PREVIOUS ARTICLE</span>
                <span class="nav-title">${prevArticle.title}</span>
              </div>
             </a>` 
          : ''
        }
        ${nextArticle 
          ? `<a class="bottombar-next" onclick="window.viewArticle(${nextArticle.id})">
              <div class="nav-link-info text-right">
                <span class="nav-label">NEXT ARTICLE</span>
                <span class="nav-title">${nextArticle.title}</span>
              </div>
              <svg class="nav-arrow" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
             </a>` 
          : ''
        }
      </div>
    `;
  }

  detailView.style.display = 'block';
  detailView.innerHTML = `
    <!-- Top Breadcrumbs / Path Bar -->
    <div class="detail-path-bar">
      <div class="path-breadcrumbs">
        <span class="path-item" onclick="window.backToHome()">HOME</span>
        <span class="path-separator">&gt;</span>
        <div class="path-category-dropdown">
          <span class="path-item active-cat">
            ${article.category.toUpperCase()}
            <svg class="dropdown-arrow" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none"></path></svg>
          </span>
          <div class="dropdown-content">
            ${CATEGORIES.map(cat => `<a onclick="window.selectCategory('${cat}')">${cat.toUpperCase()}</a>`).join('')}
          </div>
        </div>
        <span class="path-separator">&gt;</span>
        <span class="path-item path-title-truncated">${article.title}</span>
      </div>
      <button class="return-news-btn" onclick="window.backToList()">
        Return to List
      </button>
    </div>

    <!-- Main Layout (Content Column + Sidebar Column) -->
    <div class="detail-main-layout">
      <!-- Left: Article Content Card -->
      <div class="detail-content-card">
        <div class="detail-header">
          <h1 class="detail-title">${article.title}</h1>
        </div>

        <div class="detail-body">
          <div class="loading-container" style="text-align: center; padding: 40px 0; color: var(--text-light);">
            <div class="spinner" style="display: inline-block; width: 30px; height: 30px; border: 3px solid rgba(183,151,115,0.2); border-top-color: var(--btn-bg); border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 12px;"></div>
            <div>正在加载内容...</div>
          </div>
        </div>

        <!-- Bottom Navigation Links -->
        ${bottomBarHTML}
      </div>

      <!-- Right: Related Articles Sidebar Card -->
      <div class="detail-sidebar-card">
        <div class="sidebar-header">
          最新推荐
        </div>
        <div class="sidebar-list">
          ${relatedArticlesHTML.length > 0 ? relatedArticlesHTML : '<p class="sidebar-empty">该分类下无其他文章。</p>'}
        </div>
      </div>
    </div>

    <!-- Floating Back to Top Button -->
    <button id="back-top-btn" class="back-top-btn" onclick="window.scrollToTop()">
      <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
    </button>
  `;
  
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Load content from API
  try {
    const res = await fetch(`/api/article-content?id=${article.id}`);
    if (!res.ok) throw new Error("Load content failed");
    const data = await res.json();
    
    const bodyEl = detailView.querySelector('.detail-body');
    if (bodyEl) {
      const authorHtml = data.author ? `<span>作者：${data.author}</span>` : '';
      const timeHtml = `<span>发布时间：${formatDate(data.publishTime || article.publishTime)}</span>`;
      bodyEl.innerHTML = `
        <div class="markdown-body">${data.html}</div>
        <div class="article-footer" style="margin-top: 40px; padding-top: 20px; border-top: 1px solid rgba(136, 136, 136, 0.2); color: var(--text-light, #888); font-size: 14px; display: flex; justify-content: flex-end; gap: 20px;">
          ${authorHtml}
          ${timeHtml}
        </div>
      `;
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
  }
}

// Route handler
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

// Main Initialization
async function initBlog() {
  try {
    const res = await fetch("/api/articles");
    if (!res.ok) throw new Error("Fetch articles failed");
    ARTICLES = await res.json();
    
    // Dynamically compile categories that have articles
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
    
    // Dynamic initialization of slideshow params for discovered categories
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
    
    // Set up router and process initial route
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

// Start
initBlog();
