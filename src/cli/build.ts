import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadArticles, ArticleMetadata } from "../backend/parser";
import { compileArticleToContent } from "../backend/compiler";
import { execSync } from "node:child_process";
import { relative, join } from "node:path";

async function safeReadFile(path: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    try {
      return await readFile(path, "utf-8");
    } catch (err) {
      if (i === 4) throw err;
      await new Promise(r => setTimeout(r, 100));
    }
  }
  return "";
}

async function safeWriteFile(path: string, content: string) {
  for (let i = 0; i < 5; i++) {
    try {
      await writeFile(path, content, "utf-8");
      return;
    } catch (err) {
      if (i === 4) throw err;
      await new Promise(r => setTimeout(r, 100));
    }
  }
}

function compareTimeDesc(a: string, b: string): number {
  return new Date(b).getTime() - new Date(a).getTime();
}

type TaxonomyNode = {
  key: string;
  latestTime: string;
  subcategories?: TaxonomyNode[];
  subtopics?: TaxonomyNode[];
};

type Taxonomy = {
  categories: TaxonomyNode[];
};

function buildTaxonomy(articles: ArticleMetadata[]): Taxonomy {
  const categoryMap = new Map<string, { latestTime: string; subcategories: Map<string, { latestTime: string; subtopics: Map<string, { latestTime: string }> }> }>();

  for (const art of articles) {
    const cat = art.category || "";
    const subcat = art.subcategory || "";
    const subtopic = art.subtopic || "";
    const sortTime = art.sortTime;
    if (!cat) continue;

    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, { latestTime: sortTime, subcategories: new Map() });
    }
    const catEntry = categoryMap.get(cat)!;
    if (compareTimeDesc(sortTime, catEntry.latestTime) < 0) {
      catEntry.latestTime = sortTime;
    }

    if (subcat) {
      if (!catEntry.subcategories.has(subcat)) {
        catEntry.subcategories.set(subcat, { latestTime: sortTime, subtopics: new Map() });
      }
      const subEntry = catEntry.subcategories.get(subcat)!;
      if (compareTimeDesc(sortTime, subEntry.latestTime) < 0) {
        subEntry.latestTime = sortTime;
      }

      if (subtopic) {
        if (!subEntry.subtopics.has(subtopic)) {
          subEntry.subtopics.set(subtopic, { latestTime: sortTime });
        }
        const topicEntry = subEntry.subtopics.get(subtopic)!;
        if (compareTimeDesc(sortTime, topicEntry.latestTime) < 0) {
          topicEntry.latestTime = sortTime;
        }
      }
    }
  }

  const categories: TaxonomyNode[] = Array.from(categoryMap.entries()).map(([key, value]) => {
    const subcategories: TaxonomyNode[] = Array.from(value.subcategories.entries()).map(([subKey, subValue]) => {
      const subtopics: TaxonomyNode[] = Array.from(subValue.subtopics.entries()).map(([topicKey, topicValue]) => ({
        key: topicKey,
        latestTime: topicValue.latestTime
      }));
      subtopics.sort((a, b) => compareTimeDesc(a.latestTime, b.latestTime));
      return { key: subKey, latestTime: subValue.latestTime, subtopics };
    });
    subcategories.sort((a, b) => compareTimeDesc(a.latestTime, b.latestTime));
    return { key, latestTime: value.latestTime, subcategories };
  });

  categories.sort((a, b) => compareTimeDesc(a.latestTime, b.latestTime));
  return { categories };
}

async function buildStatic() {
  console.log("Starting static site generation...");
  
  // Ensure mdbook is available on Linux/Unix CI systems (e.g. Cloudflare)
  let mdbookCmd = "mdbook";
  if (process.platform === "linux" || process.platform === "darwin") {
    try {
      execSync("which mdbook", { stdio: "ignore" });
    } catch (e) {
      const localMdbook = join(process.cwd(), "mdbook");
      if (!existsSync(localMdbook)) {
        console.log(`[Build] mdbook not found globally. Downloading v0.4.40 for ${process.platform}...`);
        const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
        const platform = process.platform === "darwin" ? "apple-darwin" : "unknown-linux-gnu";
        const downloadUrl = `https://github.com/rust-lang/mdBook/releases/download/v0.4.40/mdbook-v0.4.40-${arch}-${platform}.tar.gz`;
        execSync(`curl -sL "${downloadUrl}" | tar -xz`, { stdio: "inherit" });
        execSync(`chmod +x "${localMdbook}"`, { stdio: "inherit" });
      }
      mdbookCmd = localMdbook;
    }
  }

  const articles = await loadArticles();
  const taxonomy = buildTaxonomy(articles);
  
  // Clean up legacy books folder to prevent stale files/folders from blocking build
  await rm("./public/books", { recursive: true, force: true });
  
  // Create output API directories inside public/
  await mkdir("./public/api", { recursive: true });
  
  // Write articles list JSON (exclude filePath and bookSrc from client payload)
  const clientList = articles.map(({ filePath, bookSrc, ...rest }) => rest);
  await safeWriteFile("./public/api/articles.json", JSON.stringify(clientList));
  console.log(`Generated: public/api/articles.json (${clientList.length} articles)`);
  await safeWriteFile("./public/api/taxonomy.json", JSON.stringify(taxonomy));
  console.log(`Generated: public/api/taxonomy.json (${taxonomy.categories.length} categories)`);
  
  // Create output article-content directory inside public/api/
  await mkdir("./public/api/article-content", { recursive: true });
  
  // Pre-render article contents to JSON
  for (const art of articles) {
    try {
      const content = await compileArticleToContent(art);
      await safeWriteFile(
        `./public/api/article-content/${art.id}.json`,
        JSON.stringify(content)
      );
    } catch (err) {
      console.error(`Failed to pre-render article content for id ${art.id}:`, err);
    }
  }
  console.log(`Pre-rendered content for ${articles.length} articles inside public/api/article-content/`);
  

  const customCss = `/* Custom floating breadcrumb panel styling */
.mdbook-custom-breadcrumbs {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  z-index: 1000;
  font-size: 11px;
  font-family: system-ui, -apple-system, sans-serif;
  display: flex;
  align-items: center;
  gap: 4px;
  line-height: 1.2;
}

.mdbook-custom-breadcrumbs svg.breadcrumb-separator-icon {
  width: 12px;
  height: 12px;
  color: var(--fg);
  opacity: 0.5;
  margin: 0 6px;
  flex-shrink: 0;
  vertical-align: middle;
}

/* Breadcrumb Item */
.breadcrumb-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  user-select: none;
  color: var(--fg);
  font-weight: 600;
  transition: background-color 0.15s, color 0.15s;
}

.breadcrumb-item:hover {
  background-color: var(--theme-hover);
}

.breadcrumb-item a {
  color: inherit !important;
  text-decoration: none !important;
}

.breadcrumb-item .arrow-icon {
  width: 10px;
  height: 10px;
  margin-left: 6px;
  opacity: 0.7;
  transition: transform 0.2s ease;
  flex-shrink: 0;
  vertical-align: middle;
}

.breadcrumb-item.active .arrow-icon {
  transform: rotate(180deg);
}

/* Dropdown menu */
.breadcrumb-dropdown {
  display: none;
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 10px;
  background-color: var(--theme-popup-bg, var(--bg, #ffffff));
  border: 1px solid var(--theme-popup-border, #cccccc);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  min-width: 140px;
  padding: 6px 0;
  z-index: 1001;
  flex-direction: column;
}

.breadcrumb-item.active .breadcrumb-dropdown {
  display: flex;
}

/* Caret indicator pointing to the trigger */
.breadcrumb-dropdown::after {
  content: '';
  position: absolute;
  top: 100%;
  right: 14px;
  border-width: 6px;
  border-style: solid;
  border-color: var(--theme-popup-bg, var(--bg, #ffffff)) transparent transparent transparent;
}

.breadcrumb-dropdown::before {
  content: '';
  position: absolute;
  top: 100%;
  right: 13px;
  border-width: 7px;
  border-style: solid;
  border-color: var(--theme-popup-border, #cccccc) transparent transparent transparent;
  z-index: -1;
}

/* Dropdown items */
.breadcrumb-dropdown a {
  color: var(--fg) !important;
  padding: 8px 16px;
  text-decoration: none !important;
  font-size: 11px;
  font-weight: normal;
  white-space: nowrap;
  text-align: left;
  display: block;
  line-height: 1.4;
  transition: background-color 0.15s, color 0.15s;
}

.breadcrumb-dropdown a:hover {
  background-color: var(--theme-hover);
  color: var(--sidebar-active, var(--links)) !important;
}

.breadcrumb-dropdown a.active-link {
  font-weight: bold;
  color: var(--sidebar-active, var(--links)) !important;
  background-color: var(--theme-hover);
}
`;

  // Write central theme once in source for mdBook compiler
  const centralThemeDir = "./posts/__shared_theme";
  await mkdir(centralThemeDir, { recursive: true });
  await safeWriteFile(join(centralThemeDir, "custom-mdbook.css"), customCss);

  // Write central theme to public folder for deployment at runtime
  const publicThemeDir = "./public/books/__shared_theme";
  await mkdir(publicThemeDir, { recursive: true });
  await safeWriteFile(join(publicThemeDir, "custom-mdbook.css"), customCss);

  const customJs = `window.addEventListener('DOMContentLoaded', async () => {
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

  // 2. Add floating breadcrumbs
  try {
    const [articlesRes, taxonomyRes] = await Promise.all([
      fetch('/api/articles.json'),
      fetch('/api/taxonomy.json')
    ]);
    if (!articlesRes.ok) throw new Error("Failed to load articles list");
    if (!taxonomyRes.ok) throw new Error("Failed to load taxonomy");
    const articles = await articlesRes.json();
    const taxonomy = await taxonomyRes.json();
    
    // Find matching article based on pathname (normalize both to support Cloudflare Pretty URLs)
    const pathname = window.location.pathname.replace(/\\\\index\\\\.html$/, '').replace(/\\\\$/, '');
    const article = articles.find(a => {
      const cleanPath = a.path.replace(/\\\\index\\\\.html$/, '').replace(/\\\\$/, '');
      return pathname === cleanPath || pathname.endsWith(cleanPath) || pathname.includes(cleanPath);
    });
    if (!article) return; // Not a registered article book page
    
    const category = article.category;
    const subcat = article.subcategory;
    const subtopic = article.subtopic;
    
    const separatorSVG = \`<svg class="breadcrumb-separator-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>\`;
    const arrowSVG = \`<svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>\`;

    const container = document.createElement('div');
    container.className = 'mdbook-custom-breadcrumbs';
    
    // HOME item
    let html = \`
      <div class="breadcrumb-item">
        <a href="/" target="_parent">HOME</a>
      </div>
    \`;
    
    // Category dropdown
    const categories = (taxonomy.categories || []).map(cat => cat.key);
    const categoryDropdownHTML = categories.map(cat => {
      const activeClass = cat === category ? 'active-link' : '';
      return \`<a href="/#/category/\${cat}?subcat=all&subtopic=all" target="_parent" class="\${activeClass}">\${cat.toUpperCase()}</a>\`;
    }).join('');
    
    html += \`
      \${separatorSVG}
      <div class="breadcrumb-item dropdown-trigger">
        <span class="segment-label">\${category.toUpperCase()}</span>
        \${arrowSVG}
        <div class="breadcrumb-dropdown">\${categoryDropdownHTML}</div>
      </div>
    \`;
    
    // Subcategory dropdown
    if (subcat) {
      const categoryEntry = (taxonomy.categories || []).find(c => c.key === category);
      const subcategories = (categoryEntry?.subcategories || []).map(sub => sub.key);
      const subcatDropdownHTML = subcategories.map(sub => {
        const activeClass = sub === subcat ? 'active-link' : '';
        return \`<a href="/#/category/\${category}?subcat=\${sub}&subtopic=all" target="_parent" class="\${activeClass}">\${sub.toUpperCase()}</a>\`;
      }).join('');
      
      html += \`
        \${separatorSVG}
        <div class="breadcrumb-item dropdown-trigger">
          <span class="segment-label">\${subcat.toUpperCase()}</span>
          \${arrowSVG}
          <div class="breadcrumb-dropdown">\${subcatDropdownHTML}</div>
        </div>
      \`;
    }
    
    // Subtopic dropdown
    if (subtopic) {
      const categoryEntry = (taxonomy.categories || []).find(c => c.key === category);
      const subcatEntry = (categoryEntry?.subcategories || []).find(s => s.key === subcat);
      const subtopics = (subcatEntry?.subtopics || []).map(topic => topic.key);
      const subtopicDropdownHTML = subtopics.map(topic => {
        const activeClass = topic === subtopic ? 'active-link' : '';
        return \`<a href="/#/category/\${category}?subcat=\${subcat}&subtopic=\${topic}" target="_parent" class="\${activeClass}">\${topic.toUpperCase()}</a>\`;
      }).join('');
      
      if (subtopics.length > 0) {
        html += \`
          \${separatorSVG}
          <div class="breadcrumb-item dropdown-trigger">
            <span class="segment-label">\${subtopic.toUpperCase()}</span>
            \${arrowSVG}
            <div class="breadcrumb-dropdown">\${subtopicDropdownHTML}</div>
          </div>
        \`;
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
    
  } catch (err) {
    console.error("Failed to build custom breadcrumbs:", err);
  }
});`;

  await safeWriteFile(join(centralThemeDir, "custom-mdbook.js"), customJs);
  await safeWriteFile(join(publicThemeDir, "custom-mdbook.js"), customJs);
  console.log("Generated central custom-mdbook.js");

  // Compile each book automatically
  // Collect unique books based on bookSrc to prevent redundant compilations
  const uniqueBookSrcs = new Set<string>();
  for (const art of articles) {
    if (art.bookSrc) {
      uniqueBookSrcs.add(art.bookSrc);
    }
  }

  for (const bookSrc of uniqueBookSrcs) {
    // Locate and read book.toml to find its build-dir output directory
    const bookTomlPath = join(bookSrc, "book.toml");
    if (!existsSync(bookTomlPath)) {
      console.warn(`[Build] book.toml not found at ${bookSrc}, skipping compile`);
      continue;
    }
    
    let bookToml = await safeReadFile(bookTomlPath);
    const match = bookToml.match(/build-dir\s*=\s*"([^"]+)"/);
    if (!match) {
      console.error(`[Build] Missing build-dir in ${bookTomlPath}, skipping compile`);
      continue;
    }
    
    const buildDir = match[1];
    const destDir = join(bookSrc, buildDir).replace(/\\/g, "/");
    let updated = false;
    
    // Ensure book.toml contains theme path pointing to central posts/theme relatively
    const hasSrcFolder = existsSync(join(bookSrc, "src"));
    if (hasSrcFolder) {
      if (bookToml.includes('src = "."')) {
        bookToml = bookToml.replace(/src\s*=\s*"\."\r?\n?/g, "");
        updated = true;
      }
    } else {
      if (!bookToml.includes('src = "."')) {
        const srcLinePattern = /src\s*=\s*"[^"]+"\r?\n?/g;
        if (srcLinePattern.test(bookToml)) {
          bookToml = bookToml.replace(srcLinePattern, 'src = "."\n');
        } else {
          bookToml = bookToml.replace("[book]", '[book]\nsrc = "."');
        }
        updated = true;
      }
    }
    
    // Ensure [output.html] section exists
    if (!bookToml.includes("[output.html]")) {
      bookToml += "\n\n[output.html]\n";
      updated = true;
    }
    
    // Remove theme configuration if it exists
    if (bookToml.includes("theme = ")) {
      bookToml = bookToml.replace(/theme\s*=\s*"[^"]+"\r?\n?/g, "");
      updated = true;
    }
    
    // Dynamically calculate theme paths relative to the book's root
    const relCss = relative(bookSrc, "posts/__shared_theme/custom-mdbook.css").replace(/\\/g, "/");
    const relJs = relative(bookSrc, "posts/__shared_theme/custom-mdbook.js").replace(/\\/g, "/");

    // Ensure additional-css = ["${relCss}"]
    if (!bookToml.includes(`additional-css = ["${relCss}"]`)) {
      const cssLinePattern = /additional-css\s*=\s*\[[^\]]+\]\r?\n?/g;
      if (cssLinePattern.test(bookToml)) {
        bookToml = bookToml.replace(cssLinePattern, `additional-css = ["${relCss}"]\n`);
      } else {
        bookToml = bookToml.replace("[output.html]", `[output.html]\nadditional-css = ["${relCss}"]`);
      }
      updated = true;
    }
    
    // Ensure additional-js = ["${relJs}"]
    if (!bookToml.includes(`additional-js = ["${relJs}"]`)) {
      const jsLinePattern = /additional-js\s*=\s*\[[^\]]+\]\r?\n?/g;
      if (jsLinePattern.test(bookToml)) {
        bookToml = bookToml.replace(jsLinePattern, `additional-js = ["${relJs}"]\n`);
      } else {
        bookToml = bookToml.replace("[output.html]", `[output.html]\nadditional-js = ["${relJs}"]`);
      }
      updated = true;
    }
    
    if (updated) {
      await safeWriteFile(bookTomlPath, bookToml);
    }

    // Cleanup duplicated files at book root and remove local theme folder
    await rm(join(bookSrc, "custom-mdbook.css"), { force: true });
    await rm(join(bookSrc, "custom-mdbook.js"), { force: true });
    await rm(join(bookSrc, "theme"), { recursive: true, force: true });
    await rm(join(bookSrc, "__shared_theme"), { recursive: true, force: true });
    await rm(join(bookSrc, "book"), { recursive: true, force: true });

    console.log(`Compiling mdbook: "${bookSrc}" -> "${destDir}"`);
    try {
      await rm(destDir, { recursive: true, force: true });
      execSync(`"${mdbookCmd}" build "${bookSrc}" --dest-dir "${destDir}"`, { stdio: "inherit" });
    } catch (err) {
      console.error(`Error compiling mdbook at ${bookSrc}:`, err);
      throw err;
    }
  }
  
  console.log("Static site build completed successfully!");
}

buildStatic().catch(err => {
  console.error(err);
  process.exit(1);
});
