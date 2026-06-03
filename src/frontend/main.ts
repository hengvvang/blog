import { state, loadState } from "./state";
import { handleRouting } from "./router";
import { CategoryView } from "./views/CategoryView";
import { categoryDirections, categoryOrders, slideDirs } from "./utils/slideshow";

const articleGrid = document.getElementById('article-grid');

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
      const art = state.ARTICLES.find(a => String(a.id) === idStr);
      if (art && art.path) {
        window.location.href = art.path;
      } else {
        window.location.hash = `#/article/${idStr}`;
      }
    }
  } else if (action === 'back-to-home') {
    window.location.hash = '#/';
  } else if (action === 'back-to-list') {
    window.location.hash = `#/category/${state.currentCategory}?subcat=${state.currentSubcat}&subtopic=${state.currentSubtopic}`;
  } else if (action === 'select-subcat') {
    const sub = actionEl.getAttribute('data-sub');
    if (sub) {
      window.location.hash = `#/category/${state.currentCategory}?subcat=${sub}&subtopic=all`;
    }
  } else if (action === 'select-subtopic') {
    const topic = actionEl.getAttribute('data-topic');
    if (topic) {
      window.location.hash = `#/category/${state.currentCategory}?subcat=${state.currentSubcat}&subtopic=${topic}`;
    }
  } else if (action === 'load-more') {
    state.pageSize += 5;
    if (articleGrid) {
      CategoryView.render(articleGrid);
    }
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

// App bootstrapping
async function initBlog() {
  try {
    await loadState();
    
    // Initialize slideshow configurations
    state.CATEGORIES.forEach(cat => {
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
