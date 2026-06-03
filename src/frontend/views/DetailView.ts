import { state } from "../state";
import { renderRelatedCardHTML } from "../components/Card";
import { renderDetailViewHTML, renderBottomBarHTML } from "../components/Breadcrumbs";
import { formatEnglishDate } from "../utils/date";
import { renderSidebarMetaHTML } from "../components/Sidebar";

export const DetailView = {
  async render(container: HTMLElement, id: number) {
    const article = state.ARTICLES.find(a => a.id === id);
    if (!article) {
      window.location.hash = "#/";
      return;
    }

    const navBar = document.getElementById('nav-bar');
    const articleGrid = document.getElementById('article-grid');
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

    const related = state.ARTICLES.filter(a => a.category === article.category && a.id !== article.id).slice(0, 5);
    const relatedArticlesHTML = related.map(rel => renderRelatedCardHTML(rel)).join('');

    const categoryArticles = state.ARTICLES.filter(a => a.category === article.category);
    const currIndex = categoryArticles.findIndex(a => a.id === article.id);
    const prevArticle = currIndex > 0 ? categoryArticles[currIndex - 1] : null;
    const nextArticle = currIndex < categoryArticles.length - 1 ? categoryArticles[currIndex + 1] : null;
    const bottomBarHTML = renderBottomBarHTML(prevArticle, nextArticle);

    detailView.style.display = 'block';
    detailView.innerHTML = renderDetailViewHTML(article, state.CATEGORIES, relatedArticlesHTML, bottomBarHTML);
    
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
};
