import { serve } from "bun";

const server = serve({
  port: 9191, // 修改为 6506
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Route root to index.html
    if (path === "/") {
      return new Response(Bun.file("./public/index.html"));
    }
    
    // Serve static css
    if (path === "/style.css") {
      return new Response(Bun.file("./public/style.css"), {
        headers: { "Content-Type": "text/css" }
      });
    }
    
    // On-the-fly bundle main.ts for the browser
    if (path === "/main.js") {
      const build = await Bun.build({
        entrypoints: ["./src/main.ts"],
        minify: true,
      });
      
      if (!build.success) {
        console.error(build.logs);
        return new Response("Build failed", { status: 500 });
      }
      
      return new Response(build.outputs[0], {
        headers: { "Content-Type": "application/javascript" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`🚀 Blog dev server running at: http://localhost:${server.port}`);
