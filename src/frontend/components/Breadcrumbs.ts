import { Article } from "../../shared/types";

// Footer previous/next article paginator bar
export function renderBottomBarHTML(prevArticle: Article | null, nextArticle: Article | null): string {
  if (!prevArticle && !nextArticle) return '';
  return `
    <div class="detail-bottom-bar">
      ${prevArticle 
        ? `<a class="bottombar-prev" data-action="view-article" data-id="${prevArticle.id}">
            <svg class="nav-arrow" viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
            <div class="nav-link-info">
              <span class="nav-label">PREVIOUS ARTICLE</span>
              <span class="nav-title">${prevArticle.title}</span>
            </div>
           </a>` 
        : ''
      }
      ${nextArticle 
        ? `<a class="bottombar-next" data-action="view-article" data-id="${nextArticle.id}">
            <div class="nav-link-info text-right">
              <span class="nav-label">NEXT ARTICLE</span>
              <span class="nav-title">${nextArticle.title}</span>
            </div>
            <svg class="nav-arrow" viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
           </a>` 
        : ''
      }
    </div>
  `;
}

// Complete structural detail view HTML
export function renderDetailViewHTML(
  article: Article,
  categories: string[],
  relatedHTML: string,
  bottomBarHTML: string
): string {
  return `
    <!-- Top Breadcrumbs / Path Bar -->
    <div class="detail-path-bar">
      <div class="path-breadcrumbs">
        <span class="path-item" data-action="back-to-home">HOME</span>
        <span class="path-separator">&gt;</span>
        <div class="path-category-dropdown">
          <span class="path-item active-cat">
            ${article.category.toUpperCase()}
            <svg class="dropdown-arrow" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none"></path></svg>
          </span>
          <div class="dropdown-content">
            ${categories.map(cat => `<a data-action="select-category" data-cat="${cat}">${cat.toUpperCase()}</a>`).join('')}
          </div>
        </div>
        <span class="path-separator">&gt;</span>
        <span class="path-title-truncated">${article.title}</span>
      </div>
      <button class="return-news-btn" data-action="back-to-list">
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

      <!-- Right: Sidebar Column containing Metadata Card and Related Articles Card -->
      <div class="detail-sidebar-column">
        <!-- Sidebar Metadata Card with Tabs (Embedded / protruding right edge) -->
        <div class="sidebar-meta-card">
          <div class="sidebar-tabs-container">
            <button class="sidebar-tab active" data-action="switch-meta-tab" data-tab="info">INFO</button>
            <button class="sidebar-tab" data-action="switch-meta-tab" data-tab="outline">OUTLINE</button>
          </div>
          
          <!-- Tab Contents: Info -->
          <div class="sidebar-tab-content active" id="tab-content-info">
            <div class="sidebar-header">INFO</div>
            <div id="sidebar-meta-box" style="padding: 25px 20px;">
              <div class="loading-meta" style="color: var(--text-light, #888); font-size: 13px; text-align: center; padding: 20px 0;">
                Loading metadata...
              </div>
            </div>
          </div>
          
          <!-- Tab Contents: Outline -->
          <div class="sidebar-tab-content" id="tab-content-outline">
            <div class="sidebar-header">OUTLINE</div>
            <div id="sidebar-outline-box" class="outline-list" style="padding: 25px 20px;">
              <div class="loading-meta" style="color: var(--text-light, #888); font-size: 13px; text-align: center; padding: 20px 0;">
                Loading outline...
              </div>
            </div>
          </div>
        </div>

        <!-- Related Articles Sidebar Card (Original layout, sibling of sidebar-meta-card) -->
        <div class="detail-sidebar-card" id="sidebar-recommendations">
          <div class="sidebar-header">
            RECOMMENDED
          </div>
          <div class="sidebar-list">
            ${relatedHTML || '<p class="sidebar-empty">该分类下无其他文章。</p>'}
          </div>
        </div>
      </div>
    </div>

    <!-- Floating Back to Top Button -->
    <button id="back-top-btn" class="back-top-btn" data-action="scroll-to-top">
      <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
    </button>
  `;
}
