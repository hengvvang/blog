// Injected home button & breadcrumbs script
window.addEventListener('DOMContentLoaded', () => {
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

  // 2. Add floating breadcrumbs in bottom-right corner
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  // URL structure is always: /books/<subcategory>/<subtopic>/<article_folder>/index.html
  // pathParts can be: ["books", "mcu", "esp32", "wifi_sta", "index.html"]
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

    const breadcrumbs = [
      { label: 'HOME', url: '/' }
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

    const breadcrumbHTML = breadcrumbs.map(b => `<a href="${b.url}" target="_parent">${b.label}</a>`).join('<span>&gt;</span>');

    const container = document.createElement('div');
    container.className = 'mdbook-custom-breadcrumbs';
    container.innerHTML = breadcrumbHTML;
    document.body.appendChild(container);
  }
});
