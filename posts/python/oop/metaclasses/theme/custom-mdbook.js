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
      const caretSvg = `<svg class="caret-icon" viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 4px; vertical-align: middle; transition: transform 0.2s ease; opacity: 0.8;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

      const breadcrumbsContainer = document.createElement('div');
      breadcrumbsContainer.className = 'menu-bar-breadcrumbs';
      
      const dropdownHtml = `
        <div class="breadcrumb-dropdown-panel">
          <div class="dropdown-group">
            <div class="group-title"><a href="/#/category/lang" target="_parent">LANG</a></div>
            <div class="group-links">
              <a href="/#/category/lang?subcat=rust&subtopic=all" target="_parent">RUST</a>
              <a href="/#/category/lang?subcat=c&subtopic=all" target="_parent">C</a>
              <a href="/#/category/lang?subcat=python&subtopic=all" target="_parent">PYTHON</a>
            </div>
          </div>
          <div class="dropdown-group">
            <div class="group-title"><a href="/#/category/rtos" target="_parent">RTOS</a></div>
            <div class="group-links">
              <a href="/#/category/rtos?subcat=freertos&subtopic=all" target="_parent">FREERTOS</a>
              <a href="/#/category/rtos?subcat=zephyr&subtopic=all" target="_parent">ZEPHYR</a>
            </div>
          </div>
          <div class="dropdown-group">
            <div class="group-title"><a href="/#/category/mcu" target="_parent">MCU</a></div>
            <div class="group-links">
              <a href="/#/category/mcu?subcat=stm32&subtopic=all" target="_parent">STM32</a>
              <a href="/#/category/mcu?subcat=esp32&subtopic=all" target="_parent">ESP32</a>
            </div>
          </div>
          <div class="dropdown-group">
            <div class="group-title"><a href="/#/category/markup" target="_parent">MARKUP</a></div>
            <div class="group-links">
              <a href="/#/category/markup?subcat=markdown&subtopic=all" target="_parent">MARKDOWN</a>
              <a href="/#/category/markup?subcat=css&subtopic=all" target="_parent">CSS</a>
            </div>
          </div>
          <div class="dropdown-group">
            <div class="group-title"><a href="/#/category/toolchain" target="_parent">TOOLCHAIN</a></div>
            <div class="group-links">
              <a href="/#/category/toolchain?subcat=cmake&subtopic=all" target="_parent">CMAKE</a>
              <a href="/#/category/toolchain?subcat=gcc&subtopic=all" target="_parent">GCC</a>
            </div>
          </div>
        </div>
      `;

      breadcrumbsContainer.innerHTML = `
        <a href="/" target="_parent" class="breadcrumb-link home-link">${homeSvg}HOME</a>
        <span class="breadcrumb-separator">/</span>
        <span class="breadcrumb-link dropdown-trigger" data-dropdown="category">${category.toUpperCase()}${caretSvg}</span>
        <span class="breadcrumb-separator">/</span>
        <span class="breadcrumb-link dropdown-trigger" data-dropdown="subcategory">${subcat.toUpperCase()}${caretSvg}</span>
        ${dropdownHtml}
      `;
      
      // Insert after sidebarToggle
      sidebarToggle.parentNode.insertBefore(breadcrumbsContainer, sidebarToggle.nextSibling);

      // Bind dropdown toggle events
      breadcrumbsContainer.addEventListener('click', (e) => {
        const trigger = e.target.closest('.dropdown-trigger');
        if (trigger) {
          e.stopPropagation();
          const isOpen = breadcrumbsContainer.classList.contains('open');
          const isTriggerActive = trigger.classList.contains('active');
          
          breadcrumbsContainer.querySelectorAll('.dropdown-trigger').forEach(t => {
            t.classList.remove('active');
          });
          
          if (!isOpen || !isTriggerActive) {
            breadcrumbsContainer.classList.add('open');
            trigger.classList.add('active');
          } else {
            breadcrumbsContainer.classList.remove('open');
          }
        }
      });

      document.addEventListener('click', () => {
        breadcrumbsContainer.classList.remove('open');
        breadcrumbsContainer.querySelectorAll('.dropdown-trigger').forEach(t => {
          t.classList.remove('active');
        });
      });
    }
  }
});
