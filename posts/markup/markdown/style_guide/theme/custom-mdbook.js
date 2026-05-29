// Injected home button script
window.addEventListener('DOMContentLoaded', () => {
  const menuBar = document.querySelector('.left-buttons');
  if (menuBar) {
    const homeBtn = document.createElement('a');
    homeBtn.href = '/';
    homeBtn.title = 'Back to Blog Home';
    homeBtn.className = 'icon-button';
    homeBtn.innerHTML = '<span class="fa-svg" style="display: inline-flex; align-items: center; justify-content: center; height: 100%;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg></span>';
    menuBar.insertBefore(homeBtn, menuBar.firstChild);
  }
});
