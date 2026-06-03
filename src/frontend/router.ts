import { state } from "./state";
import { HomeView } from "./views/HomeView";
import { CategoryView } from "./views/CategoryView";
import { DetailView } from "./views/DetailView";
import { renderNavHTML } from "./components/Nav";

const navBar = document.getElementById('nav-bar');
const articleGrid = document.getElementById('article-grid');

export function renderNav(): void {
  if (navBar) {
    navBar.innerHTML = renderNavHTML(state.CATEGORIES, state.currentCategory);
  }
}

export function handleRouting(): void {
  const hash = window.location.hash || "#/";
  
  if (hash === "#/" || hash === "#") {
    state.currentCategory = "home";
    state.currentSubcat = "all";
    
    if (navBar) navBar.style.display = "flex";
    const detailView = document.getElementById("article-detail-view");
    if (detailView) detailView.style.display = "none";
    
    document.title = "Developer Blog | Home";
    renderNav();
    if (articleGrid) {
      HomeView.render(articleGrid);
    }
  } else if (hash.startsWith("#/category/")) {
    const parts = hash.substring(11).split("?");
    const category = parts[0];
    let subcat = "all";
    let subtopic = "all";
    
    if (parts[1]) {
      const searchParams = new URLSearchParams(parts[1]);
      subcat = searchParams.get("subcat") || "all";
      subtopic = searchParams.get("subtopic") || "all";
    }
    
    state.currentCategory = category;
    state.currentSubcat = subcat;
    state.currentSubtopic = subtopic;
    state.pageSize = 5;
    
    if (navBar) navBar.style.display = "flex";
    const detailView = document.getElementById("article-detail-view");
    if (detailView) detailView.style.display = "none";
    
    document.title = `${category.toUpperCase()} | Developer Blog`;
    renderNav();
    if (articleGrid) {
      CategoryView.render(articleGrid);
    }
  } else if (hash.startsWith("#/article/")) {
    const articleIdStr = hash.substring(10);
    const id = parseInt(articleIdStr, 10);
    const art = state.ARTICLES.find(a => a.id === id);
    if (art && art.path) {
      window.location.replace(art.path);
    } else {
      if (articleGrid) {
        DetailView.render(articleGrid, id);
      }
    }
  }
}
