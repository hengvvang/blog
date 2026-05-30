window.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/api/articles.json');
    if (!res.ok) throw new Error("Failed to load articles list");
    const articles = await res.json();
    
    // Find matching article based on pathname
    const pathname = window.location.pathname;
    const article = articles.find(a => pathname.endsWith(a.path) || pathname.includes(a.path));
    if (!article) return; // Not a registered article book page
    
    const category = article.category;
    const subcat = article.subcategory;
    const subtopic = article.subtopic;
    
    // Build taxonomy mapping
    const taxonomy = {};
    articles.forEach(art => {
      const cat = art.category || "";
      const sub = art.subcategory || "";
      const topic = art.subtopic || "";
      if (cat) {
        if (!taxonomy[cat]) {
          taxonomy[cat] = { subcategories: {} };
        }
        if (sub) {
          if (!taxonomy[cat].subcategories[sub]) {
            taxonomy[cat].subcategories[sub] = [];
          }
          if (topic) {
            if (!taxonomy[cat].subcategories[sub].includes(topic)) {
              taxonomy[cat].subcategories[sub].push(topic);
            }
          }
        }
      }
    });
    
    const separatorSVG = `<svg class="breadcrumb-separator-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
    const arrowSVG = `<svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

    const container = document.createElement('div');
    container.className = 'mdbook-custom-breadcrumbs';
    
    // HOME item
    let html = `
      <div class="breadcrumb-item">
        <a href="/" target="_parent">HOME</a>
      </div>
    `;
    
    // Category dropdown
    const categories = Object.keys(taxonomy).sort();
    const categoryDropdownHTML = categories.map(cat => {
      const activeClass = cat === category ? 'active-link' : '';
      return `<a href="/#/category/${cat}?subcat=all&subtopic=all" target="_parent" class="${activeClass}">${cat.toUpperCase()}</a>`;
    }).join('');
    
    html += `
      ${separatorSVG}
      <div class="breadcrumb-item dropdown-trigger">
        <span class="segment-label">${category.toUpperCase()}</span>
        ${arrowSVG}
        <div class="breadcrumb-dropdown">${categoryDropdownHTML}</div>
      </div>
    `;
    
    // Subcategory dropdown
    if (subcat) {
      const subcategories = Object.keys(taxonomy[category]?.subcategories || {}).sort();
      const subcatDropdownHTML = subcategories.map(sub => {
        const activeClass = sub === subcat ? 'active-link' : '';
        return `<a href="/#/category/${category}?subcat=${sub}&subtopic=all" target="_parent" class="${activeClass}">${sub.toUpperCase()}</a>`;
      }).join('');
      
      html += `
        ${separatorSVG}
        <div class="breadcrumb-item dropdown-trigger">
          <span class="segment-label">${subcat.toUpperCase()}</span>
          ${arrowSVG}
          <div class="breadcrumb-dropdown">${subcatDropdownHTML}</div>
        </div>
      `;
    }
    
    // Subtopic dropdown
    if (subtopic) {
      const subtopics = (taxonomy[category]?.subcategories[subcat] || []).sort();
      const subtopicDropdownHTML = subtopics.map(topic => {
        const activeClass = topic === subtopic ? 'active-link' : '';
        return `<a href="/#/category/${category}?subcat=${subcat}&subtopic=${topic}" target="_parent" class="${activeClass}">${topic.toUpperCase()}</a>`;
      }).join('');
      
      if (subtopics.length > 0) {
        html += `
          ${separatorSVG}
          <div class="breadcrumb-item dropdown-trigger">
            <span class="segment-label">${subtopic.toUpperCase()}</span>
            ${arrowSVG}
            <div class="breadcrumb-dropdown">${subtopicDropdownHTML}</div>
          </div>
        `;
      }
    }
    
    container.innerHTML = html;
    document.body.appendChild(container);
    
    // Click events toggle
    const triggers = container.querySelectorAll('.dropdown-trigger');
    triggers.forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        if (e.target.closest('.breadcrumb-dropdown a')) {
          return;
        }
        e.stopPropagation();
        const isActive = trigger.classList.contains('active');
        
        // Close all
        triggers.forEach(t => t.classList.remove('active'));
        
        if (!isActive) {
          trigger.classList.add('active');
        }
      });
    });
    
    // Close on click outside
    document.addEventListener('click', () => {
      triggers.forEach(t => t.classList.remove('active'));
    });
    
  } catch (err) {
    console.error("Failed to build custom breadcrumbs:", err);
  }
});