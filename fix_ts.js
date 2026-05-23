const fs = require('fs');
let text = fs.readFileSync('src/main.ts', 'utf8');

// We delete the old renderPartition_OLD() code up to selectToolchainSubcat.
const oldFuncRegex = /function renderPartition_OLD\(\) \{[\s\S]*?\(window as any\)\.select/;
text = text.replace(oldFuncRegex, `function renderPartition() {
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
    tabsHTML = \`<div class="toolchain-tabs">\` + 
      subcats.map(sub => \`
        <button class="toolchain-tab \${currentSubcat === sub ? 'active' : ''}" onclick="window.selectSubcat('\${sub}')">\` +
          (sub === 'all' ? '全部' : sub.toUpperCase()) +
        \`</button>
      \`).join('') +
    \`</div>\`;
  }
  
  const featuredHTML = featured.length > 0 
    ? \`<div class="toolchain-featured-section">\` +
        featured.map(art => {
          const badgeText = (art.subcategory || currentCategory).toUpperCase();
          return \`
            <div class="card toolchain-horizontal-card" style="width: auto; flex: 1;">
                <div class="card-cover-wrapper" style="width: auto; flex: 1; height: auto; display: flex; flex-direction: column; gap: 8px; padding: 12px 16px;">
                  <div class="featured-cover" style="background: linear-gradient(135deg, \${getCategoryColor(currentCategory)} 0%, #1e222b 100%);">
                    <div class="featured-subcat-badge">\${badgeText}</div>
                    <span class="featured-cover-text">\${badgeText} 技术精选</span>
                  </div>
                  <div class="featured-info" style="padding: 0;">
                    <span class="featured-date" style="font-size: 11px;">\${art.publishTime}</span>
                    <h4 class="featured-title" style="margin: 4px 0; font-size: 16px;">\${art.title}</h4>
                    <p class="featured-snippet" style="font-size: 12px; margin: 0; -webkit-line-clamp: 2;">\${art.contentSnippet}</p>
                </div>
              </div>
              <div class="card-content">
                <div class="card-title-container">
                  <p class="card-title" style="visibility: hidden;">\${art.title}</p>
                </div>
                <div class="card-btn-container">
                  <div class="card-btn" onclick="window.viewArticle(\${art.id})">
                    <img src="https://fastcdn.hoyoverse.com/static-resource-v2/2024/03/21/882dcd6829a489afda8ba322eb982e7d_2051193489758981573.png" alt="arrow" />
                  </div>
                </div>
              </div>
            </div>
          \`;
        }).join('') +
      \`</div>\`
    : '';
    
  const visibleList = listArticles.slice(0, pageSize);
  const listHTML = visibleList.length > 0
    ? \`<div class="toolchain-list-section">\` +
        visibleList.map(art => {
          const badgeText = (art.subcategory || currentCategory).toUpperCase();
          return \`
            <div class="card" style="width: 100%;">
              <div class="card-cover-wrapper" style="width: 100%; height: auto; display: flex; gap: 24px;">
                <div class="list-card-cover" style="background: linear-gradient(135deg, \${getCategoryColor(currentCategory)} 0%, #2e3440 100%);">
                  <span class="list-cover-badge">\${badgeText}</span>
                </div>
                <div class="list-card-info" style="padding: 0; flex-grow: 1;">
                  <div class="list-card-header">
                    <span class="list-card-badge">\${badgeText}</span>
                    <span class="list-card-date">\${art.publishTime}</span>
                  </div>
                  <h4 class="list-card-title">\${art.title}</h4>
                  <p class="list-card-snippet">\${art.contentSnippet}</p>
                </div>
              </div>
              <div class="card-content" style="width: 100%;">
                <div class="card-title-container">
                  <p class="card-title" style="visibility: hidden;">\${art.title}</p>
                </div>
                <div class="card-btn-container">
                  <div class="card-btn" onclick="window.viewArticle(\${art.id})">
                    <img src="https://fastcdn.hoyoverse.com/static-resource-v2/2024/03/21/882dcd6829a489afda8ba322eb982e7d_2051193489758981573.png" alt="arrow" />
                  </div>
                </div>
              </div>
            </div>
          \`;
        }).join('') +
      \`</div>\`
    : (featured.length === 0 ? '<div class="toolchain-empty">没有找到相关文章。</div>' : '');
    
  const hasMore = listArticles.length > pageSize;
  const loadMoreHTML = hasMore
    ? \`<div class="toolchain-loadmore-container">
        <button class="toolchain-loadmore-btn" onclick="window.loadMore()">更多 (もっと)</button>
      </div>\`
    : '';
    
  articleGrid.innerHTML = \`
    <!-- Top Featured section -->
    \${featuredHTML}
    
    <!-- Subcategory Tabs -->
    \${tabsHTML}
    
    <!-- Vertical List of regular cards -->
    \${listHTML}
    
    <!-- Load more button -->
    \${loadMoreHTML}
  \`;
}

(window as any).select`);

fs.writeFileSync('src/main.ts', text, 'utf8');
