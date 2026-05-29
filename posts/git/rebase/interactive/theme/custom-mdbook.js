window.addEventListener('DOMContentLoaded', () => {
  const category = "toolchain";
  const subcat = "git";
  const subtopic = "rebase";
  const taxonomy = {"lang":{"subcategories":{"python":["oop","decorators","concurrency"],"c":["memory","pointers"],"rust":["ownership","lifetime","concurrency"]}},"toolchain":{"subcategories":{"git":["internals","workflow","rebase"],"cmake":["others"],"gcc":["others"]}},"mcu":{"subcategories":{"esp32":["others"],"stm32":["others"]}},"rtos":{"subcategories":{"zephyr":["others"],"freertos":["others"]}},"markup":{"subcategories":{"markdown":["others"],"css":["others"]}}};
  
  const separatorSVG = `<svg class="breadcrumb-separator-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
  const arrowSVG = `<svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

  if (category) {
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
  }
});