import { state } from "../state";
import { renderHomeCollectionHTML } from "../components/Card";
import { getCategoryHomeElementsHTML, onRowEnter, onRowLeave } from "../utils/slideshow";
import { formatSubcategory } from "../utils/theme";
import { categoryOrders } from "../utils/slideshow";

export const HomeView = {
  render(container: HTMLElement) {
    container.style.display = '';
    container.className = 'home-collections-wrapper';
    
    container.innerHTML = state.CATEGORIES.map(cat => {
      const count = state.ARTICLES.filter(a => a.category === cat).length;
      const categoryEntry = state.TAXONOMY?.categories.find(c => c.key === cat);
      const rawSubcats = (categoryEntry?.subcategories || []).map(sub => sub.key);
      const formattedSubcats = rawSubcats.map(sub => formatSubcategory(sub));
      
      const { keywordsHTML, iconsHTML } = getCategoryHomeElementsHTML(cat, formattedSubcats);
      const order = categoryOrders[cat] || [0, 1, 3, 2];
      return renderHomeCollectionHTML(cat, count, keywordsHTML, order, iconsHTML);
    }).join('');
    
    // Bind hover slideshow event listeners
    const rows = container.querySelectorAll('.home-collection');
    rows.forEach(row => {
      const cat = row.getAttribute('data-cat');
      if (cat) {
        row.addEventListener('mouseenter', () => onRowEnter(cat));
        row.addEventListener('mouseleave', () => onRowLeave(cat));
      }
    });
  }
};
