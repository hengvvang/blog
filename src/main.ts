interface Article {
  id: number;
  title: string;
  category: string;
  contentSnippet: string;
  publishTime: string;
}

const CATEGORIES = ['rust', 'rtos', 'mcu', 'git', 'markup', 'c', 'toolchain'];

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
  CATEGORIES.forEach((cat, index) => {
    for(let i = 0; i < 9; i++) {
        articles.push({
            id: index * 10 + i,
            title: `深入浅出 ${cat.toUpperCase()} 核心技术指南 - 深度解析 第 ${i + 1} 卷`,
            category: cat,
            contentSnippet: snippets[cat],
            publishTime: `2026-05-${String(20 + i).padStart(2, '0')} 14:${String(i * 15).padStart(2, '0')}`
        });
    }
  });
  return articles;
};

const ARTICLES = generateArticles();
let currentCategory = 'rust';

const navBar = document.getElementById('nav-bar');
const articleGrid = document.getElementById('article-grid');

function renderNav() {
  if (!navBar) return;
  navBar.innerHTML = '';
  
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
  if (articleGrid) articleGrid.style.display = 'grid';
  const detailView = document.getElementById('article-detail-view');
  if (detailView) detailView.style.display = 'none';
};
