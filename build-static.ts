import { mkdir } from "node:fs/promises";
import { loadArticles } from "./src/backend/parser";
import { execSync } from "node:child_process";
import { relative, join } from "node:path";

async function buildStatic() {
  console.log("Starting static site generation...");
  const articles = await loadArticles();
  
  // Create output API directories inside public/
  await mkdir("./public/api", { recursive: true });
  
  // Write articles list JSON (exclude filePath and bookSrc from client payload)
  const clientList = articles.map(({ filePath, bookSrc, ...rest }) => rest);
  await Bun.write("./public/api/articles.json", JSON.stringify(clientList));
  console.log(`Generated: public/api/articles.json (${clientList.length} articles)`);
  
  // Aggregate unique books to compile
  const uniqueBookSrcs = new Set<string>();
  for (const art of articles) {
    if (art.bookSrc) {
      uniqueBookSrcs.add(art.bookSrc);
    }
  }
  
  const customCss = `/* Custom mdbook themes to align with the premium blog design */
:root {
  --sidebar-width: 250px;
}

#sidebar {
  background-color: #1a1a1a;
  border-right: 1px solid #2e2e2e;
}

#sidebar a {
  color: #c9c9c9;
}

#sidebar a.active {
  color: #b79773; /* complementary gold */
}

.left-buttons i {
  transition: color 0.2s ease;
}

.left-buttons a:hover i {
  color: #b79773 !important;
}

/* Floating breadcrumbs in bottom-right corner */
.mdbook-custom-breadcrumbs {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background-color: #ffffff;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  padding: 8px 14px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  z-index: 1000;
  font-size: 11px;
  font-family: system-ui, -apple-system, sans-serif;
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1;
}

.mdbook-custom-breadcrumbs a {
  color: #b79773 !important;
  font-weight: 600;
  text-decoration: none;
  transition: opacity 0.2s ease;
}

.mdbook-custom-breadcrumbs a:hover {
  opacity: 0.8;
}

.mdbook-custom-breadcrumbs span {
  color: #888;
  opacity: 0.6;
}

/* Dark mode adjustments */
html.dark .mdbook-custom-breadcrumbs,
html.navy .mdbook-custom-breadcrumbs,
html.ayu .mdbook-custom-breadcrumbs,
html.coal .mdbook-custom-breadcrumbs {
  background-color: #1a1a1a;
  border-color: #2e2e2e;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}
`;

  // Compile each book automatically
  for (const bookSrc of uniqueBookSrcs) {
    const bookFolder = relative("posts", bookSrc).replace(/\\/g, "/");
    const destDir = join(process.cwd(), "public/books", bookFolder);
    
    // Find corresponding article metadata
    const art = articles.find(a => a.bookSrc === bookSrc);
    if (art) {
      const category = art.category || "";
      const subcat = art.subcategory || "";
      const subtopic = art.subtopic || "";
      
      const themeDir = join(bookSrc, "theme");
      await mkdir(themeDir, { recursive: true });

      const customJs = `window.addEventListener('DOMContentLoaded', () => {
  const category = "${category}";
  const subcat = "${subcat}";
  const subtopic = "${subtopic}";

  if (category && subcat) {
    const breadcrumbs = [
      { label: 'HOME', url: '/' }
    ];

    breadcrumbs.push({
      label: category.toUpperCase(),
      url: \`/#/category/\${category}\`
    });

    breadcrumbs.push({
      label: subcat.toUpperCase(),
      url: \`/#/category/\${category}?subcat=\${subcat}&subtopic=all\`
    });

    if (subtopic && subtopic !== 'all' && subtopic !== 'others') {
      breadcrumbs.push({
        label: subtopic.toUpperCase(),
        url: \`/#/category/\${category}?subcat=\${subcat}&subtopic=\${subtopic}\`
      });
    }

    const breadcrumbHTML = breadcrumbs.map(b => \`<a href="\${b.url}" target="_parent">\${b.label}</a>\`).join('<span>&gt;</span>');

    const container = document.createElement('div');
    container.className = 'mdbook-custom-breadcrumbs';
    container.innerHTML = breadcrumbHTML;
    document.body.appendChild(container);
  }
});`;

      await Bun.write(join(themeDir, "custom-mdbook.js"), customJs);
      await Bun.write(join(themeDir, "custom-mdbook.css"), customCss);
    }

    console.log(`Compiling mdbook: "${bookSrc}" -> "${destDir}"`);
    try {
      execSync(`mdbook build "${bookSrc}" --dest-dir "${destDir}"`, { stdio: "inherit" });
    } catch (err) {
      console.error(`Error compiling mdbook at ${bookSrc}:`, err);
    }
  }
  
  console.log("Static site build completed successfully!");
}

buildStatic().catch(console.error);
