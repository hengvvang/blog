export function renderNavHTML(categories: string[], currentCategory: string): string {
  const homeActive = currentCategory === 'home' ? 'active' : '';
  let html = `<button class="nav-item ${homeActive}" data-action="select-category" data-cat="home">首页</button>`;
  
  html += categories.map(cat => {
    const active = cat === currentCategory ? 'active' : '';
    return `<button class="nav-item ${active}" data-action="select-category" data-cat="${cat}">${cat.toUpperCase()}</button>`;
  }).join('');
  
  return html;
}
