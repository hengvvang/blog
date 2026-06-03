import { Article } from "../../shared/types";
import { getCategoryColor } from "../utils/theme";
import { POSITION_MAP } from "../../shared/constants";

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

// Unified Cover Renderer helper for filter isolation and custom styling (strict schemas)
export function renderCoverHTML(cover: Article['cover'], categoryColor: string, defaultTextSize: string): string {
  const fallbackColor = cover?.image?.color || categoryColor;
  
  let bgImageHTML = '';
  if (cover?.image?.src) {
    const styleVariables: string[] = [];
    if (cover.image.scale !== undefined) {
      styleVariables.push(`--cover-scale: ${cover.image.scale}`);
    }
    if (cover.image.brightness !== undefined) {
      styleVariables.push(`--cover-brightness: ${cover.image.brightness}`);
    }
    if (cover.image.blur !== undefined) {
      styleVariables.push(`--cover-blur: ${cover.image.blur}px`);
    }
    
    // Hover animation configs
    const hover = cover.image.hover || {};
    if (hover.scale !== undefined) {
      styleVariables.push(`--cover-hover-scale: ${hover.scale}`);
    }
    if (hover.brightness !== undefined) {
      styleVariables.push(`--cover-hover-brightness: ${hover.brightness}`);
    }
    if (hover.rotate !== undefined) {
      styleVariables.push(`--cover-hover-rotate: ${hover.rotate}deg`);
    }
    if (hover.blur !== undefined) {
      const blurVal = String(hover.blur).endsWith("px") ? hover.blur : `${hover.blur}px`;
      styleVariables.push(`--cover-hover-blur: ${blurVal}`);
    }

    const varStyle = styleVariables.length > 0 ? `${styleVariables.join('; ')};` : '';
    bgImageHTML = `<div class="cover-bg-image" style="background-image: url('${cover.image.src}'); ${varStyle}"></div>`;
  }
  
  let coverContentHTML = '';
  const coverBadge = cover?.image?.badge;
  const badgeText = coverBadge?.text;
  const badgePos = coverBadge?.position;
  if (badgeText && badgePos) {
    const posStyle = POSITION_MAP[badgePos] || POSITION_MAP.center;
    const txtColor = coverBadge.color || '#ffffff';
    const txtSize = coverBadge.size || defaultTextSize;
    coverContentHTML = `<span style="position: absolute; ${posStyle} font-size: ${txtSize}; font-weight: 600; color: ${txtColor}; text-shadow: 0 2px 4px rgba(0,0,0,0.4); z-index: 2; width: 85%; box-sizing: border-box; pointer-events: none;">${badgeText}</span>`;
  }
  
  return `
    <div style="position: relative; width: 100%; height: 100%; background-color: ${fallbackColor}; overflow: hidden; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
      ${bgImageHTML}
      ${coverContentHTML}
    </div>
  `;
}

export function getDisplayTime(art: Article): string {
  return art.lastUpdatedTime || art.publishTime;
}

export function renderBadgeHTML(art: Article): string {
  const subcatStr = (art.subcategory || art.category).toUpperCase();
  if (art.subtopic) {
    return `
      <span class="list-card-badge" style="display: inline-flex; align-items: center;">
        <span style="color: #000000; font-weight: 700;">${subcatStr}</span>
        <span style="color: #ffffff; margin: 0 6px; font-weight: 500; opacity: 0.85;">|</span>
        <span style="color: #ffffff; font-weight: 700;">${art.subtopic.toUpperCase()}</span>
      </span>
    `;
  }
  return `<span class="list-card-badge">${subcatStr}</span>`;
}

// Featured article card (horizontal slide-out)
export function renderFeaturedCardHTML(art: Article, categoryColor: string): string {
  const scaleVar = art.cover?.image?.scale !== undefined ? `style="--cover-scale: ${art.cover.image.scale};"` : '';

  return `
    <div class="card toolchain-horizontal-card" data-action="view-article" data-id="${art.id}" ${scaleVar}>
      <div class="card-cover-wrapper" style="height: auto; display: flex; flex-direction: column; gap: 6px; padding: 8px 12px 10px 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 2px; line-height: 1.2;">
          ${renderBadgeHTML(art)}
          <span class="featured-date" style="font-size: 11px; color: var(--text-light, #888);">${getDisplayTime(art)}</span>
        </div>
        <div class="featured-cover" style="position: relative; overflow: hidden; height: 110px; border-radius: 4px;">
          ${renderCoverHTML(art.cover, categoryColor, '14px')}
        </div>
        <div class="featured-info" style="padding: 0;">
          <h4 class="featured-title" style="margin: 2px 0; font-size: 14px;">${art.title}</h4>
          <p class="featured-snippet" style="font-size: 11px; margin: 0; -webkit-line-clamp: 1;">${art.contentSnippet}</p>
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
  const scaleStyle = art.cover?.image?.scale !== undefined ? `--cover-scale: ${art.cover.image.scale};` : '';

  return `
    <div class="card toolchain-list-card" style="width: 100%; align-self: start; ${scaleStyle}" data-action="view-article" data-id="${art.id}">
      <div class="card-cover-wrapper" style="width: 100%; height: auto; display: flex; gap: 24px;">
        <div class="list-card-cover" style="position: relative; overflow: hidden; width: 180px; height: 110px; border-radius: 4px; flex-shrink: 0;">
          ${renderCoverHTML(art.cover, categoryColor, '14px')}
        </div>
        <div class="list-card-info" style="padding: 0; flex-grow: 1;">
          <div class="list-card-header">
            ${renderBadgeHTML(art)}
            <span class="list-card-date">${getDisplayTime(art)}</span>
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
            <p class="sidebar-item-date">${getDisplayTime(rel).split(' ')[0].replace(/-/g, '年').concat('日')}</p>
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
