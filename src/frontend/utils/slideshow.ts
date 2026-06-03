import { getCategoryColor, getKeywordIcon, ICONS, SINGLE_ICON_CATEGORIES } from "./theme";
import { DEFAULT_ICON } from "../../shared/constants";

export const slideshowTimers: Record<string, any> = {};
export const slideDirs = [
  { in: 'translate(-50%, 150%)', out: 'translate(-50%, -150%)' },
  { in: 'translate(-50%, -150%)', out: 'translate(-50%, 150%)' },
  { in: 'translate(150%, -50%)', out: 'translate(-150%, -50%)' },
  { in: 'translate(-150%, -50%)', out: 'translate(150%, -50%)' }
];

export const categoryDirections: Record<string, typeof slideDirs[0]> = {};
export const categoryOrders: Record<string, number[]> = {};

export function getOppositeDirection(dir: typeof slideDirs[0]): typeof slideDirs[0] {
  const idx = slideDirs.indexOf(dir);
  if (idx === -1) return slideDirs[1];
  if (idx === 0 || idx === 1) {
    return slideDirs[idx ^ 1]; // opposite for up/down
  }
  return slideDirs[idx]; // same for left/right
}

export function getCategoryHomeElementsHTML(cat: string, list: string[]): { keywordsHTML: string; iconsHTML: string } {
  const displayList = list.length > 0 ? list : ['Code', 'Tech', 'Doc', 'Dev', 'System'];
  const initialIndex = Math.floor(Math.random() * displayList.length);
  
  const keywordsHTML = displayList.map((word, i) => `<span class="media-text ${i === initialIndex ? 'js-active' : ''}">${word}</span>`).join('');
  
  let iconsHTML = '';
  if (SINGLE_ICON_CATEGORIES.includes(cat)) {
    const singleIcon = ICONS[cat] || DEFAULT_ICON;
    iconsHTML = `<span class="icon-item js-active">${singleIcon}</span>`;
  } else {
    iconsHTML = displayList.map((word, i) => {
      const iconSVG = getKeywordIcon(word);
      return `<span class="icon-item ${i === initialIndex ? 'js-active' : ''}">${iconSVG}</span>`;
    }).join('');
  }
  
  return { keywordsHTML, iconsHTML };
}

export function onRowEnter(cat: string): void {
  if (slideshowTimers[cat]) clearInterval(slideshowTimers[cat]);
  
  const wrapper = document.querySelector(`.media-wrapper[data-category="${cat}"]`);
  if (!wrapper) return;
  const texts = wrapper.querySelectorAll('.media-text');
  if (texts.length === 0) return;
  
  const iconWrapper = document.querySelector(`.collection-icon[data-category="${cat}"]`);
  const icons = iconWrapper ? iconWrapper.querySelectorAll('.icon-item') : [];
  
  let currActive = -1;
  for (let i = 0; i < texts.length; i++) {
    if (texts[i].classList.contains('js-active')) {
      currActive = i;
      break;
    }
  }
  if (currActive === -1) {
    currActive = 0;
    const el = texts[currActive] as HTMLElement;
    el.classList.add('js-active');
    el.style.transform = 'translate(-50%, -50%)';
    
    if (icons[currActive]) {
      const iconEl = icons[currActive] as HTMLElement;
      iconEl.classList.add('js-active');
      iconEl.style.transform = 'translate(-50%, -50%)';
    }
  }
  
  if (texts.length > 1) {
    const fixedDir = categoryDirections[cat] || slideDirs[0];
    const oppositeDir = getOppositeDirection(fixedDir);
    
    slideshowTimers[cat] = setInterval(() => {
      let curr = -1;
      for (let i = 0; i < texts.length; i++) {
        if (texts[i].classList.contains('js-active')) {
          curr = i;
          break;
        }
      }
      
      if (curr !== -1) {
        const nextActive = (curr + 1) % texts.length;
        
        // Transition text
        const currEl = texts[curr] as HTMLElement;
        const nextEl = texts[nextActive] as HTMLElement;
        
        nextEl.style.transition = 'none';
        nextEl.style.transform = fixedDir.in;
        
        void nextEl.offsetWidth; // force reflow
        
        nextEl.style.transition = '';
        currEl.style.transition = '';
        
        currEl.classList.remove('js-active');
        currEl.style.transform = fixedDir.out;
        
        nextEl.classList.add('js-active');
        nextEl.style.transform = 'translate(-50%, -50%)';
        
        // Transition icon (if multi-icon category)
        if (icons.length > 1 && icons[curr] && icons[nextActive]) {
          const currIconEl = icons[curr] as HTMLElement;
          const nextIconEl = icons[nextActive] as HTMLElement;
          
          nextIconEl.style.transition = 'none';
          nextIconEl.style.transform = oppositeDir.in;
          
          void nextIconEl.offsetWidth; // force reflow
          
          nextIconEl.style.transition = '';
          currIconEl.style.transition = '';
          
          currIconEl.classList.remove('js-active');
          currIconEl.style.transform = oppositeDir.out;
          
          nextIconEl.classList.add('js-active');
          nextIconEl.style.transform = 'translate(-50%, -50%)';
        }
      }
    }, 600);
  }
}

export function onRowLeave(cat: string): void {
  if (slideshowTimers[cat]) {
    clearInterval(slideshowTimers[cat]);
    delete slideshowTimers[cat];
  }
}

export function stopAllSlideshows(): void {
  Object.keys(slideshowTimers).forEach(cat => {
    clearInterval(slideshowTimers[cat]);
    delete slideshowTimers[cat];
  });
}
