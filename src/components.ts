import { Article } from "./types";
import { getCategoryColor } from "./utils";

// Top Nav breadcrumbs and options
export function renderNavHTML(categories: string[], currentCategory: string): string {
  const homeActive = currentCategory === 'home' ? 'active' : '';
  let html = `<button class="nav-item ${homeActive}" data-action="select-category" data-cat="home">首页</button>`;
  
  html += categories.map(cat => {
    const active = cat === currentCategory ? 'active' : '';
    return `<button class="nav-item ${active}" data-action="select-category" data-cat="${cat}">${cat.toUpperCase()}</button>`;
  }).join('');
  
  return html;
}

// Home collection categories grid card
export function renderHomeCollectionHTML(
  cat: string,
  articlesCount: number,
  keywordsHTML: string,
  order: number[],
  iconsHTML: string
): string {
  const formattedCount = String(articlesCount).padStart(2, '0');
  
  const iconHTML = `<div class="collection-icon" data-category="${cat}">${iconsHTML}</div>`;
  const nameHTML = `<h3 class="collection-name">${cat.toUpperCase()}</h3>`;
  const countHTML = `<h3 class="collection-count">(${formattedCount})</h3>`;
  const mediaHTML = `
    <div class="media-wrapper" data-category="${cat}" style="background-color: ${getCategoryColor(cat)};">
      ${keywordsHTML}
    </div>
  `;
  
  const elements = [iconHTML, nameHTML, countHTML, mediaHTML];
  const rowContent = order.map(idx => elements[idx]).join('');
  
  return `
    <div class="home-collection" data-action="select-category" data-cat="${cat}">
      <div class="collection-inner">
        ${rowContent}
      </div>
    </div>
  `;
}

const POSITION_MAP: Record<string, string> = {
  topLeft: "top: 12px; left: 16px; transform: none; text-align: left;",
  bottomLeft: "bottom: 12px; left: 16px; transform: none; text-align: left;",
  center: "top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center;",
  bottomRight: "bottom: 12px; right: 16px; transform: none; text-align: right;",
  topRight: "top: 12px; right: 16px; transform: none; text-align: right;"
};

// Unified Cover Renderer helper for filter isolation and custom styling
function renderCoverHTML(cover: Article['cover'], categoryColor: string, defaultTextSize: string): string {
  const fallbackColor = cover?.image?.color || categoryColor;
  
  let bgImageHTML = '';
  if (cover?.image?.src) {
    const filters: string[] = [];
    if (cover.image.brightness !== undefined) {
      filters.push(`brightness(${cover.image.brightness})`);
    }
    if (cover.image.blur !== undefined) {
      filters.push(`blur(${cover.image.blur})`);
    }
    const filterStyle = filters.length > 0 ? `filter: ${filters.join(' ')};` : '';
    bgImageHTML = `<div class="cover-bg-image" style="background-image: url('${cover.image.src}'); ${filterStyle}"></div>`;
  }
  
  let coverContentHTML = '';
  if (cover?.text?.content && cover?.text?.position) {
    const posStyle = POSITION_MAP[cover.text.position] || POSITION_MAP.center;
    const txtColor = cover.text.color || '#ffffff';
    const txtSize = cover.text.size || defaultTextSize;
    coverContentHTML = `<span style="position: absolute; ${posStyle} font-size: ${txtSize}; font-weight: 600; color: ${txtColor}; text-shadow: 0 2px 4px rgba(0,0,0,0.4); z-index: 2; width: 85%; box-sizing: border-box; pointer-events: none;">${cover.text.content}</span>`;
  }
  
  return `
    <div style="position: relative; width: 100%; height: 100%; background-color: ${fallbackColor}; overflow: hidden; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
      ${bgImageHTML}
      ${coverContentHTML}
    </div>
  `;
}

// Featured article card (horizontal slide-out)
export function renderFeaturedCardHTML(art: Article, categoryColor: string): string {
  const scaleVar = art.cover?.image?.scale !== undefined ? `style="--cover-scale: ${art.cover.image.scale};"` : '';

  return `
    <div class="card toolchain-horizontal-card" data-action="view-article" data-id="${art.id}" ${scaleVar}>
      <div class="card-cover-wrapper" style="height: auto; display: flex; flex-direction: column; gap: 8px; padding: 8px 16px 12px 16px;">
        <div style="text-align: right; width: 100%; margin-bottom: 0px; line-height: 1;">
          <span class="featured-date" style="font-size: 12px; color: var(--text-light, #888);">${art.publishTime}</span>
        </div>
        <div class="featured-cover" style="position: relative; overflow: hidden; height: 160px; border-radius: 4px;">
          ${renderCoverHTML(art.cover, categoryColor, '18px')}
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
}

// Regular list article card
export function renderListCardHTML(art: Article, categoryColor: string): string {
  const subcatStr = (art.subcategory || art.category).toUpperCase();
  const badgeText = art.subtopic ? `${subcatStr} | ${art.subtopic.toUpperCase()}` : subcatStr;
  const scaleStyle = art.cover?.image?.scale !== undefined ? `--cover-scale: ${art.cover.image.scale};` : '';

  return `
    <div class="card" style="width: 100%; ${scaleStyle}" data-action="view-article" data-id="${art.id}">
      <div class="card-cover-wrapper" style="width: 100%; height: auto; display: flex; gap: 24px;">
        <div class="list-card-cover" style="position: relative; overflow: hidden; width: 180px; height: 110px; border-radius: 4px; flex-shrink: 0;">
          ${renderCoverHTML(art.cover, categoryColor, '14px')}
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
}

// Side bar: Related recommendation article item template
export function renderRelatedCardHTML(rel: Article): string {
  const scaleVar = rel.cover?.image?.scale !== undefined ? `style="--cover-scale: ${rel.cover.image.scale};"` : '';

  return `
    <div class="card sidebar-item-card" data-action="view-article" data-id="${rel.id}" ${scaleVar}>
      <div class="card-cover-wrapper" style="border: none;">
        <div class="sidebar-item-inner">
          <div class="sidebar-thumb" style="position: relative; overflow: hidden; width: 140px; height: 70px; border-radius: 4px;">
            ${renderCoverHTML(rel.cover, getCategoryColor(rel.category), '10px')}
          </div>
          <div class="sidebar-item-info">
            <p class="sidebar-item-title">${rel.title}</p>
            <p class="sidebar-item-date">${rel.publishTime.split(' ')[0].replace(/-/g, '年').concat('日') /* localized inline */}</p>
          </div>
        </div>
      </div>
      <div class="card-content">
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
}

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

// 5-row minimalist metadata box inside details view
export function renderSidebarMetaHTML(
  author: string,
  formattedDate: string,
  tagsHtml: string,
  readingTime: string,
  wordCount: number,
  lastUpdatedHtml: string
): string {
  return `
    <div class="meta-row meta-tags">
      ${tagsHtml}
    </div>
    <div class="meta-row meta-metrics">
      <span class="meta-value">${readingTime || '10 min'} read</span>
      <span class="meta-divider">·</span>
      <span class="meta-value">${wordCount.toLocaleString()} words</span>
    </div>
    <div class="meta-row meta-pubdate">
      on ${formattedDate}
    </div>
    ${lastUpdatedHtml}
    <div class="meta-row meta-author">
      by <span class="meta-author-name">${author}</span>
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
        <!-- Sidebar Metadata Card -->
        <div id="sidebar-meta-box" class="sidebar-meta-card">
          <div class="loading-meta" style="color: var(--text-light, #888); font-size: 13px; text-align: center; padding: 20px 0;">
            Loading metadata...
          </div>
        </div>

        <!-- Related Articles Sidebar Card (Original layout) -->
        <div class="detail-sidebar-card">
          <div class="sidebar-header">
            最新推荐
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
