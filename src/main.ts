interface Article {
  id: number;
  title: string;
  category: string;
  subcategory?: string;
  contentSnippet: string;
  publishTime: string;
}

const CATEGORIES = ['rust', 'rtos', 'mcu', 'markup', 'c', 'toolchain'];


function formatDate(dateStr: string): string {
  const parts = dateStr.split(' ')[0].split('-');
  if (parts.length === 3) {
    return `${parts[0]}年${parts[1]}月${parts[2]}日`;
  }
  return dateStr;
}

let currentSubcat = 'all';
let pageSize = 5;

// 生成带有真实文章内容的详细占位数据
const generateArticles = (): Article[] => {
  const snippets: Record<string, string> = {
    rust: "Rust 语言的所有权模型为开发带来了极大的内存安全保证。本文深入探讨如何在实际工程中处理生命周期约束，以及在并发场景下如何规避数据竞争问题，打造零分配的高性能系统...",
    rtos: "实时操作系统（RTOS）的核心在于其确定性的任务调度机制。本文将带领大家实战剖析底层的上下文切换汇编过程，并展示如何使用互斥量解决优先级翻转难题...",
    mcu: "物联网设备对功耗极度敏感，现代MCU提供了多种低功耗模式。文章以真实实验数据展示关闭外围设备时钟、配置LDO降压模块对全局底电流的显著改善幅度...",
    git: "杂乱无章的提交流程总是让人头疼。利用 git rebase -i 变基操作...",
    markup: "Markdown 让各种技术排版变得像写代码一样自然。如何深度定制化你的文档预设样式，结合现代解析引擎渲染出一套属于自己的特色UI外观？本文有全套配置细节...",
    c: "尽管现代语言层出不穷，C语言在底层系统中依然不可替代。详细讨论双指针高级操作、内存对齐导致的总线陷阱，以及 volatile 关键字在嵌入式硬件寄存器编程中的真正含义...",
    toolchain: "一套好用的构建工具链可以大幅提升软件开发生产力。从 GCC 链接器脚本（.ld）的自定义语法分配，到 CMake 构建宏编写与自动化 CI/CD 环境的结合运用..."
  };

  const subcatsMap: Record<string, string[]> = {
    rust: ['lifetime', 'ownership', 'reference'],
    rtos: ['freertos', 'zephyr', 'rt-thread'],
    mcu: ['stm32', 'esp32', 'gd32'],
    markup: ['markdown', 'html', 'css'],
    c: ['pointers', 'memory', 'volatile'],
    toolchain: ['cmake', 'gcc', 'gdb']
  };

  const articles: Article[] = [];
  Object.keys(snippets).forEach((catKey, index) => {
    const targetCat = catKey === 'git' ? 'toolchain' : catKey;
    for(let i = 0; i < 9; i++) {
        let subcat: string | undefined;
        if (catKey === 'git') {
          subcat = 'git';
        } else {
          const subcats = subcatsMap[targetCat] || [];
          if (subcats.length > 0) {
            subcat = subcats[i % subcats.length];
          }
        }

        articles.push({
            id: index * 10 + i,
            title: `深入浅出 ${catKey.toUpperCase()} 核心技术指南 - 深度解析 第 ${i + 1} 卷`,
            category: targetCat,
            subcategory: subcat,
            contentSnippet: snippets[catKey],
            publishTime: `2026-05-${String(20 + i).padStart(2, '0')} 14:${String(i * 15).padStart(2, '0')}`
        });
    }
  });
  return articles;
};

const ARTICLES = generateArticles();
let currentCategory = 'home';

const navBar = document.getElementById('nav-bar');
const articleGrid = document.getElementById('article-grid');

// Category icons
const ICONS: Record<string, string> = {
  rust: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
  rtos: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  mcu: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="15" x2="23" y2="15"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="15" x2="4" y2="15"></line></svg>`,
  markup: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
  c: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`,
  toolchain: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`
};

// Category preview slideshow text keywords (slideshow of text words instead of photos)
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
CATEGORIES.forEach(cat => {
  categoryDirections[cat] = slideDirs[Math.floor(Math.random() * slideDirs.length)];
});

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
        
        // Pre-position next element WITHOUT transition
        nextEl.style.transition = 'none';
        nextEl.style.transform = rnd.in;
        
        // Force layout so browser registers the new start position
        void nextEl.offsetWidth;
        
        // Restore transition
        nextEl.style.transition = '';
        currEl.style.transition = '';
        
        // Execute switch
        currEl.classList.remove('js-active');
        currEl.style.transform = rnd.out;
        
        nextEl.classList.add('js-active');
        nextEl.style.transform = 'translate(-50%, -50%)';
      }
    }, 600); // Faster interval for hover!
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
  const list = KEYWORDS[cat] || [];
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
    currentCategory = 'home';
    renderNav();
    renderArticles();
  };
  navBar.appendChild(homeBtn);
  
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `nav-item ${cat === currentCategory ? 'active' : ''}`;
    btn.textContent = cat;
    btn.onclick = () => {
      currentCategory = cat;
      currentSubcat = 'all';
      pageSize = 5;
      renderNav();
      renderArticles();
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
  
  const filtered = (!hasSubcats || currentSubcat === 'all')
    ? allArticles
    : allArticles.filter(a => a.subcategory === currentSubcat);
    
  const featured = filtered.slice(0, 3);
  const listArticles = filtered.slice(3);
  
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
            <div class="card toolchain-horizontal-card" style="width: auto; flex: 1;">
                <div class="card-cover-wrapper" style="width: auto; flex: 1; height: auto; display: flex; flex-direction: column; gap: 8px; padding: 8px 16px 12px 16px;">
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
                  <div class="card-btn" onclick="window.viewArticle(${art.id})">
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
            <div class="card" style="width: 100%;">
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
                  <div class="card-btn" onclick="window.viewArticle(${art.id})">
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
  currentSubcat = sub;
  pageSize = 5;
  renderPartition();
};

(window as any).loadMore = () => {
  pageSize += 5;
  renderPartition();
};

function renderArticles() {
  if (!articleGrid) return;
  
  // Ensure the element is visible
  articleGrid.style.display = '';
  
  if (currentCategory === 'home') {
    articleGrid.className = 'home-collections-wrapper';
    
    articleGrid.innerHTML = CATEGORIES.map((cat, index) => {
      const count = ARTICLES.filter(a => a.category === cat).length;
      const formattedCount = String(count).padStart(2, '0');
      const iconSVG = ICONS[cat] || '';
      
      const iconHTML = `<div class="collection-icon">${iconSVG}</div>`;
      const nameHTML = `<h3 class="collection-name">${cat.toUpperCase()}</h3>`;
      const countHTML = `<h3 class="collection-count">(${formattedCount})</h3>`;
      const mediaHTML = `
        <div class="media-wrapper" data-category="${cat}">
          ${getCategoryKeywordsHTML(cat)}
        </div>
      `;
      
      let rowContent = '';
      const patternIndex = index % 4;
      
      if (patternIndex === 0) {
        // Pattern 0 (Urban / Details): Icon -> Name -> Media -> Count
        rowContent = `${iconHTML}${nameHTML}${mediaHTML}${countHTML}`;
      } else if (patternIndex === 1) {
        // Pattern 1 (Nature): Icon -> Media -> Name -> Count
        rowContent = `${iconHTML}${mediaHTML}${nameHTML}${countHTML}`;
      } else if (patternIndex === 2) {
        // Pattern 2 (Golf): Icon -> Name -> Count -> Media
        rowContent = `${iconHTML}${nameHTML}${countHTML}${mediaHTML}`;
      } else {
        // Pattern 3 (RePlastic): Media -> Icon -> Name -> Count
        rowContent = `${mediaHTML}${iconHTML}${nameHTML}${countHTML}`;
      }
      
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

// 首次渲染
renderNav();
renderArticles();

function getCategoryColor(cat: string): string {
  const colors: Record<string, string> = {
    rust: '#b15b45',
    rtos: '#3b7a9e',
    mcu: '#438e68',
    markup: '#968045',
    c: '#a84545',
    toolchain: '#5e4b8b'
  };
  return colors[cat] || '#b79773';
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

// 挂载到 window 供 onclick 调用
(window as any).viewArticle = (id: number) => {
  const article = ARTICLES.find(a => a.id === id);
  if (!article) return;

  if (navBar) navBar.style.display = 'none';
  if (articleGrid) articleGrid.style.display = 'none';

  let detailView = document.getElementById('article-detail-view');
  if (!detailView) {
    detailView = document.createElement('div');
    detailView.id = 'article-detail-view';
    detailView.className = 'article-detail-view';
    document.querySelector('.main-container')?.appendChild(detailView);
  }

  // Get 5 related articles in the same category (excluding the current one)
  const related = ARTICLES.filter(a => a.category === article.category && a.id !== article.id).slice(0, 5);
  const relatedArticlesHTML = related.map(rel => {
    return `
      <div class="card sidebar-item-card">
        <div class="card-cover-wrapper" style="border: none;">
          <div class="sidebar-item-inner">
            <div class="sidebar-thumb" style="background-color: ${getCategoryColor(rel.category)};"></div>
            <div class="sidebar-item-info">
              <p class="sidebar-item-title">${rel.title}</p>
              <p class="sidebar-item-date">${formatDate(rel.publishTime)}</p>
            </div>
          </div>
        </div>
        <div class="card-content">
          <div class="card-title-container">
            <p class="card-title" style="visibility: hidden;">${rel.title}</p>
          </div>
          <div class="card-btn-container">
            <div class="card-btn" onclick="window.viewArticle(${rel.id})">
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
            <a onclick="window.selectCategory('rust')">RUST</a>
            <a onclick="window.selectCategory('rtos')">RTOS</a>
            <a onclick="window.selectCategory('mcu')">MCU</a>
            <a onclick="window.selectCategory('markup')">MARKUP</a>
            <a onclick="window.selectCategory('c')">C</a>
            <a onclick="window.selectCategory('toolchain')">TOOLCHAIN</a>
          </div>
        </div>
        <span class="path-separator">&gt;</span>
        <span class="path-item path-title-truncated">${article.title}</span>
      </div>
      <button class="return-news-btn" onclick="window.backToList()">
        Return to News
      </button>
    </div>

    <!-- Main Layout (Content Column + Sidebar Column) -->
    <div class="detail-main-layout">
      <!-- Left: Article Content Card -->
      <div class="detail-content-card">
        <div class="detail-header">
          <h1 class="detail-title">${article.title}</h1>
          <p class="detail-date">発表時間 ${formatDate(article.publishTime)}</p>
        </div>
        
        <!-- Decorative Horizontal Category Banner -->
        <div class="detail-banner" style="background-color: ${getCategoryColor(article.category)};">
          <span class="banner-text">${article.category.toUpperCase()}</span>
        </div>

        <div class="detail-body">
          <p class="detail-lead">${article.contentSnippet}</p>
          <p>（这里是文章的详细正文内容。实际项目中可以通过加载具体的 Markdown 文件或请求后端接口获取富文本内容来展示，目前为占位详情文本以展示阅读视图效果。）</p>
          <p>在这篇教程中，我们详细解析了 ${article.category.toUpperCase()} 相关的核心技术与实践机制，通过具体的案例和实战代码带你快速入门并掌握高级技巧。</p>
          <p>无论是在工程构建还是在底层系统优化中，这些方法都能为你提供强大的思路和实践参考。未来我们还将深入探讨更多进阶特性，结合具体硬件平台或编译器优化选项，实现更加高效、稳健 of 系统架构。敬请期待我们的后续更新！</p>
        </div>

        <!-- Bottom Navigation Links -->
        ${bottomBarHTML}
      </div>

      <!-- Right: Related Articles Sidebar Card -->
      <div class="detail-sidebar-card">
        <div class="sidebar-header">
          最新
        </div>
        <div class="sidebar-list">
          ${relatedArticlesHTML.length > 0 ? relatedArticlesHTML : '<p class="sidebar-empty">No other articles in this category.</p>'}
        </div>
      </div>
    </div>

    <!-- Floating Back to Top Button -->
    <button id="back-top-btn" class="back-top-btn" onclick="window.scrollToTop()">
      <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
    </button>
  `;
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

(window as any).backToHome = () => {
  currentCategory = 'home';
  if (navBar) navBar.style.display = 'flex';
  const detailView = document.getElementById('article-detail-view');
  if (detailView) detailView.style.display = 'none';
  renderNav();
  renderArticles();
};

(window as any).backToList = () => {
  if (navBar) navBar.style.display = 'flex';
  const detailView = document.getElementById('article-detail-view');
  if (detailView) detailView.style.display = 'none';
  renderArticles();
};

(window as any).selectCategory = (cat: string) => {
  currentCategory = cat;
  currentSubcat = 'all';
  pageSize = 5;
  if (navBar) navBar.style.display = 'flex';
  const detailView = document.getElementById('article-detail-view');
  if (detailView) detailView.style.display = 'none';
  renderNav();
  renderArticles();
};
