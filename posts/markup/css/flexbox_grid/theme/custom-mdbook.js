window.addEventListener('DOMContentLoaded', () => {
  // 1. Move search and theme buttons to the right-buttons container
  const rightButtons = document.querySelector('.right-buttons');
  const themeToggle = document.getElementById('mdbook-theme-toggle') || document.getElementById('theme-toggle');
  const themeList = document.getElementById('mdbook-theme-list') || document.getElementById('theme-list');
  const searchToggle = document.getElementById('mdbook-search-toggle') || document.getElementById('search-toggle');
  
  if (rightButtons) {
    if (themeToggle) {
      rightButtons.insertBefore(themeToggle, rightButtons.firstChild);
    }
    if (themeList && themeToggle) {
      themeToggle.parentNode.insertBefore(themeList, themeToggle.nextSibling);
    }
    if (searchToggle) {
      rightButtons.insertBefore(searchToggle, rightButtons.firstChild);
    }
  }

  // 2. Generate and add breadcrumbs inside left-buttons
  const sidebarToggle = document.getElementById('mdbook-sidebar-toggle') || document.getElementById('sidebar-toggle');
  
  if (sidebarToggle) {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    // URL structure is: /books/<subcategory>/<subtopic>/<article_folder>/index.html
    if (pathParts[0] === 'books' && pathParts.length >= 4) {
      const part1 = pathParts[1];
      const part2 = pathParts[2];
      
      const catMap = {
        c: 'lang',
        python: 'lang',
        rust: 'lang',
        git: 'toolchain',
        cmake: 'toolchain',
        gcc: 'toolchain'
      };

      let category = part1;
      let subcat = part2;
      let subtopic = 'all';

      if (catMap[part1]) {
        category = catMap[part1];
        subcat = part1;
        subtopic = part2;
      }

      const homeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: -1px;"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`;

      const breadcrumbs = [
        { label: `${homeSvg}HOME`, url: '/' }
      ];

      breadcrumbs.push({
        label: category.toUpperCase(),
        url: `/#/category/${category}`
      });

      breadcrumbs.push({
        label: subcat.toUpperCase(),
        url: `/#/category/${category}?subcat=${subcat}&subtopic=all`
      });

      if (subtopic !== 'all' && subtopic !== 'others') {
        breadcrumbs.push({
          label: subtopic.toUpperCase(),
          url: `/#/category/${category}?subcat=${subcat}&subtopic=${subtopic}`
        });
      }

      const breadcrumbsContainer = document.createElement('div');
      breadcrumbsContainer.className = 'menu-bar-breadcrumbs';
      
      const breadcrumbHTML = breadcrumbs.map(b => `<a href="${b.url}" target="_parent">${b.label}</a>`).join('<span class="breadcrumb-separator">/</span>');
      breadcrumbsContainer.innerHTML = breadcrumbHTML;
      
      // Insert after sidebarToggle
      sidebarToggle.parentNode.insertBefore(breadcrumbsContainer, sidebarToggle.nextSibling);
    }
  }
});
