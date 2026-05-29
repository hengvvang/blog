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
  
  // Compile each book automatically
  for (const bookSrc of uniqueBookSrcs) {
    const bookFolder = relative("posts", bookSrc).replace(/\\/g, "/");
    const destDir = join(process.cwd(), "public/books", bookFolder);
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
