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

export const ICONS: Record<string, string> = {
  rust: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
  rtos: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  mcu: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="15" x2="23" y2="15"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="15" x2="4" y2="15"></line></svg>`,
  markup: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
  c: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`,
  toolchain: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`
};

export const DEFAULT_ICON = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

export const KEYWORDS: Record<string, string[]> = {
  rust: ['Cargo', 'Rustc', 'Clippy', 'Tokio', 'Wasm'],
  rtos: ['FreeRTOS', 'RT-Thread', 'Zephyr', 'uCOS', 'ThreadX'],
  mcu: ['STM32', 'ESP32', 'GD32', 'MSP430', 'AVR'],
  markup: ['Markdown', 'HTML', 'CSS', 'LaTeX', 'XML'],
  c: ['C99', 'C11', 'Pointer', 'Volatile', 'Makefile'],
  toolchain: ['CMake', 'GCC', 'GDB', 'Git', 'Clang', 'LLVM']
};

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
  }
  
  if (texts.length > 1) {
    const fixedDir = categoryDirections[cat] || slideDirs[0];
    
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
        const rnd = fixedDir;
        const currEl = texts[curr] as HTMLElement;
        const nextEl = texts[nextActive] as HTMLElement;
        
        nextEl.style.transition = 'none';
        nextEl.style.transform = rnd.in;
        
        void nextEl.offsetWidth; // force reflow
        
        nextEl.style.transition = '';
        currEl.style.transition = '';
        
        currEl.classList.remove('js-active');
        currEl.style.transform = rnd.out;
        
        nextEl.classList.add('js-active');
        nextEl.style.transform = 'translate(-50%, -50%)';
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
