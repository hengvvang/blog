window.addEventListener('DOMContentLoaded', async () => {
  // 1. Add home button to left buttons
  const menuBar = document.querySelector('.left-buttons');
  if (menuBar) {
    const homeBtn = document.createElement('a');
    homeBtn.href = '/';
    homeBtn.title = 'Back to Blog Home';
    homeBtn.className = 'icon-button';
    homeBtn.innerHTML = '<span class="fa-svg" style="display: inline-flex; align-items: center; justify-content: center; height: 100%;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg></span>';
    menuBar.insertBefore(homeBtn, menuBar.firstChild);
  }

  // 2. Add floating breadcrumbs
  try {
    const [articlesRes, taxonomyRes] = await Promise.all([
      fetch('/api/articles.json'),
      fetch('/api/taxonomy.json')
    ]);
    if (!articlesRes.ok) throw new Error("Failed to load articles list");
    if (!taxonomyRes.ok) throw new Error("Failed to load taxonomy");
    const articles = await articlesRes.json();
    const taxonomy = await taxonomyRes.json();
    
    // Find matching article based on pathname (normalize both to support Cloudflare Pretty URLs)
    const pathname = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
    const article = articles.find(a => {
      const cleanPath = a.path.replace(/\/index\.html$/, '').replace(/\/$/, '');
      return pathname === cleanPath || pathname.endsWith(cleanPath) || pathname.includes(cleanPath);
    });
    if (!article) return; // Not a registered article book page
    
    const category = article.category;
    const subcat = article.subcategory;
    const subtopic = article.subtopic;
    
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
    const categories = (taxonomy.categories || []).map(cat => cat.key);
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
      const categoryEntry = (taxonomy.categories || []).find(c => c.key === category);
      const subcategories = (categoryEntry?.subcategories || []).map(sub => sub.key);
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
      const categoryEntry = (taxonomy.categories || []).find(c => c.key === category);
      const subcatEntry = (categoryEntry?.subcategories || []).find(s => s.key === subcat);
      const subtopics = (subcatEntry?.subtopics || []).map(topic => topic.key);
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