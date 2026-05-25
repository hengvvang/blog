import { SIMPLE_ICONS } from "./icons-data";

// Date helpers
export function formatDate(dateStr: string): string {
  const parts = dateStr.split(' ')[0].split('-');
  if (parts.length === 3) {
    return `${parts[0]}年${parts[1]}月${parts[2]}日`;
  }
  return dateStr;
}

export function formatEnglishDate(dateStr: string): string {
  const parts = dateStr.split(' ');
  const [year, monthStr, dayStr] = parts[0].split('-');
  if (!year || !monthStr || !dayStr) return `<span style="font-weight: 600; color: var(--text-dark, #333);">${dateStr}</span>`;
  
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const month = monthNames[parseInt(monthStr, 10) - 1];
  const day = parseInt(dayStr, 10);
  
  const dateFormatted = `<span style="font-weight: 600; color: var(--text-dark, #333);">${month} ${day}, ${year}</span>`;
  
  if (parts[1]) {
    const [hrStr, minStr] = parts[1].split(':');
    let hour = parseInt(hrStr, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return `${dateFormatted} at <span style="font-weight: 600; color: var(--text-dark, #333);">${hour}:${minStr} ${ampm}</span>`;
  }
  
  return dateFormatted;
}

// Color and Theme helpers
const categoryColors: Record<string, string> = {};

export function getCategoryColor(cat: string): string {
  if (!categoryColors[cat]) {
    const h = Math.floor(Math.random() * 360);
    const s = Math.floor(Math.random() * 20) + 40; // 40% - 60% saturation
    const l = Math.floor(Math.random() * 15) + 35; // 35% - 50% lightness
    categoryColors[cat] = `hsl(${h}, ${s}%, ${l}%)`;
  }
  return categoryColors[cat];
}

export const SINGLE_ICON_CATEGORIES = ['rust', 'c', 'python'];

export const ICONS: Record<string, string> = {
  rust: SIMPLE_ICONS["cat:rust"] || "",
  rtos: SIMPLE_ICONS["cat:rtos"] || "",
  mcu: SIMPLE_ICONS["cat:mcu"] || "",
  markup: SIMPLE_ICONS["cat:markup"] || "",
  c: SIMPLE_ICONS["cat:c"] || "",
  toolchain: SIMPLE_ICONS["cat:toolchain"] || "",
  python: SIMPLE_ICONS["cat:python"] || ""
};

export const DEFAULT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

export const KEYWORDS: Record<string, string[]> = {
  rust: ['Cargo', 'Rustc', 'Clippy', 'Tokio', 'Wasm'],
  rtos: ['FreeRTOS', 'RT-Thread', 'Zephyr', 'uCOS', 'ThreadX'],
  mcu: ['STM32', 'ESP32', 'GD32', 'MSP430', 'AVR'],
  markup: ['Markdown', 'HTML', 'CSS', 'LaTeX', 'XML'],
  c: ['C99', 'C11', 'Pointer', 'Volatile', 'Makefile'],
  toolchain: ['CMake', 'GCC', 'GDB', 'Git', 'Clang', 'LLVM'],
  python: ['PIP', 'Pytest', 'Decorators', 'OOP', 'Asyncio']
};

export function getKeywordIcon(keyword: string): string {
  const key = keyword.toLowerCase();
  return SIMPLE_ICONS[key] || DEFAULT_ICON;
}

// Slideshow state
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

export function getCategoryHomeElementsHTML(cat: string): { keywordsHTML: string; iconsHTML: string } {
  const list = KEYWORDS[cat] || ['Code', 'Tech', 'Doc', 'Dev', 'System'];
  const initialIndex = Math.floor(Math.random() * list.length);
  
  const keywordsHTML = list.map((word, i) => `<span class="media-text ${i === initialIndex ? 'js-active' : ''}">${word}</span>`).join('');
  
  let iconsHTML = '';
  if (SINGLE_ICON_CATEGORIES.includes(cat)) {
    const singleIcon = ICONS[cat] || DEFAULT_ICON;
    iconsHTML = `<span class="icon-item js-active">${singleIcon}</span>`;
  } else {
    iconsHTML = list.map((word, i) => {
      const iconSVG = getKeywordIcon(word);
      return `<span class="icon-item ${i === initialIndex ? 'js-active' : ''}">${iconSVG}</span>`;
    }).join('');
  }
  
  return { keywordsHTML, iconsHTML };
}

export function getCategoryKeywordsHTML(cat: string): string {
  const list = KEYWORDS[cat] || ['Code', 'Tech', 'Doc', 'Dev', 'System'];
  const initialIndex = Math.floor(Math.random() * list.length);
  return list.map((word, i) => `<span class="media-text ${i === initialIndex ? 'js-active' : ''}">${word}</span>`).join('');
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

export function getCategoryIcon(cat: string): string {
  return ICONS[cat] || DEFAULT_ICON;
}
