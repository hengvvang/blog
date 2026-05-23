interface Article {
  id: number;
  title: string;
  category: string;
  contentSnippet: string;
  publishTime: string;
}

const CATEGORIES = ['rust', 'rtos', 'mcu', 'markup', 'c', 'toolchain'];

// 生成带有真实文章内容的详细占位数据
const generateArticles = (): Article[] => {
  const snippets: Record<string, string> = {
    rust: "Rust 语言的所有权模型为开发带来了极大的内存安全保证。本文深入探讨如何在实际工程中处理生命周期约束，以及在并发场景下如何规避数据竞争问题，打造零分配的高性能系统...",
    rtos: "实时操作系统（RTOS）的核心在于其确定性的任务调度机制。本文将带领大家实战剖析底层的上下文切换汇编过程，并展示如何使用互斥量解决优先级翻转难题...",
    mcu: "物联网设备对功耗极度敏感，现代MCU提供了多种低功耗模式。文章以真实实验数据展示关闭外围设备时钟、配置LDO降压模块对全局底电流的显著改善幅度...",
    git: "杂乱无章的提交流程总是让人头疼。利用 git rebase -i 变基操作，你可以随心所欲合并历史提交，让你的项目维护历史变得清爽优雅，方便后续的追踪与代码审查...",
    markup: "Markdown 让各种技术排版变得像写代码一样自然。如何深度定制化你的文档预设样式，结合现代解析引擎渲染出一套属于自己的特色UI外观？本文有全套配置细节...",
    c: "尽管现代语言层出不穷，C语言在底层系统中依然不可替代。详细讨论双指针高级操作、内存对齐导致的总线陷阱，以及 volatile 关键字在嵌入式硬件寄存器编程中的真正含义...",
    toolchain: "一套好用的构建工具链可以大幅提升软件开发生产力。从 GCC 链接器脚本（.ld）的自定义语法分配，到 CMake 构建宏编写与自动化 CI/CD 环境的结合运用..."
  };

  const articles: Article[] = [];
  Object.keys(snippets).forEach((catKey, index) => {
    const targetCat = catKey === 'git' ? 'toolchain' : catKey;
    for(let i = 0; i < 9; i++) {
        articles.push({
            id: index * 10 + i,
            title: `深入浅出 ${catKey.toUpperCase()} 核心技术指南 - 深度解析 第 ${i + 1} 卷`,
            category: targetCat,
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

(window as any).onRowEnter = (cat: string) => {
  if (slideshowTimers[cat]) clearInterval(slideshowTimers[cat]);
  
  const wrapper = document.querySelector(`.media-wrapper[data-category="${cat}"]`);
  if (!wrapper) return;
  const texts = wrapper.querySelectorAll('.media-text');
  if (texts.length === 0) return;
  
  let activeIndex = 0;
  texts.forEach((el, i) => {
    if (i === activeIndex) {
      el.classList.add('js-active');
    } else {
      el.classList.remove('js-active');
    }
  });
  
  if (texts.length > 1) {
    slideshowTimers[cat] = setInterval(() => {
      let currActive = -1;
      for (let i = 0; i < texts.length; i++) {
        if (texts[i].classList.contains('js-active')) {
          currActive = i;
          break;
        }
      }
      if (currActive !== -1) {
        texts[currActive].classList.remove('js-active');
        const nextActive = (currActive + 1) % texts.length;
        texts[nextActive].classList.add('js-active');
      }
    }, 1500); // 1.5s interval is perfect for text keyword cycling!
  }
};

(window as any).onRowLeave = (cat: string) => {
  if (slideshowTimers[cat]) {
    clearInterval(slideshowTimers[cat]);
    delete slideshowTimers[cat];
  }
  
  const wrapper = document.querySelector(`.media-wrapper[data-category="${cat}"]`);
  if (wrapper) {
    const texts = wrapper.querySelectorAll('.media-text');
    texts.forEach(el => {
      el.classList.remove('js-active');
    });
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
  return list.map(word => `<span class="media-text">${word}</span>`).join('');
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
      renderNav();
      renderArticles();
    };
    navBar.appendChild(btn);
  });
}

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
    stopAllSlideshows();
    articleGrid.className = 'article-grid';
    const filtered = ARTICLES.filter(a => a.category === currentCategory);
    
    articleGrid.innerHTML = filtered.map(article => `
      <div class="card">
        <div class="card-cover-wrapper">
          <div class="card-cover-text">${article.contentSnippet}</div>
        </div>
        <div class="card-content">
          <div class="card-title-container">
            <p class="card-title">${article.title}</p>
            <p class="card-date">${article.publishTime}</p>
          </div>
          <div class="card-btn-container">
            <div class="card-btn" onclick="window.viewArticle(${article.id})">
              <img src="https://fastcdn.hoyoverse.com/static-resource-v2/2024/03/21/882dcd6829a489afda8ba322eb982e7d_2051193489758981573.png" alt="arrow" />
            </div>
          </div>
        </div>
      </div>
    `).join('');
  }
}

// 首次渲染
renderNav();
renderArticles();

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

  detailView.style.display = 'block';
  detailView.innerHTML = `
    <button class="back-btn" onclick="window.backToList()">
      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      返回列表
    </button>
    <div class="detail-header">
      <h1 class="detail-title">${article.title}</h1>
      <p class="detail-meta">
        <span class="detail-cat">${article.category.toUpperCase()}</span>
        <span>${article.publishTime}</span>
      </p>
    </div>
    <div class="detail-content">
      <p class="detail-lead">${article.contentSnippet}</p>
      <div class="detail-body">
        <p>（这里是文章的详细正文内容。实际项目中可以通过加载具体的 Markdown 文件或请求后端接口获取富文本内容来展示，目前为占位详情文本以展示阅读视图效果。）</p>
        <p>在这篇教程中，我们详细解析了内部的机制，通过具体的案例和实战代码带你快速入门并掌握高级技巧...</p>
      </div>
    </div>
  `;
};

(window as any).backToList = () => {
  if (navBar) navBar.style.display = 'flex';
  const detailView = document.getElementById('article-detail-view');
  if (detailView) detailView.style.display = 'none';
  renderArticles();
};

(window as any).selectCategory = (cat: string) => {
  currentCategory = cat;
  renderNav();
  renderArticles();
};
