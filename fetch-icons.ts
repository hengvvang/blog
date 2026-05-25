const slugs = [
  // Categories / Main
  "rust",
  "c",
  // RTOS
  "freertos",
  "zephyr",
  "eclipsethreadx",
  "threadx",
  "micrium", // for uCOS (Micrium uC/OS)
  "renesas", // fallback for RT-Thread or similar
  
  // MCU
  "stmicroelectronics", // STM32
  "espressif", // ESP32
  "arduino", // AVR/general
  "texasinstruments", // MSP430
  "gd32",
  "nxp",
  "microchip",
  "microchiptechnology",

  // Markup
  "markdown",
  "html5",
  "css3",
  "latex",
  "w3c", // for XML/HTML standard
  
  // Toolchain
  "cmake",
  "gcc",
  "gnudebugger",
  "git",
  "llvm",
  "gnu",
  "clang"
];

async function fetchIcon(slug: string) {
  const url = `https://cdn.jsdelivr.net/npm/simple-icons@v14/icons/${slug}.svg`;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const svg = await res.text();
      return svg;
    }
  } catch (e) {
    // Ignore error and try next
  }
  return null;
}

async function run() {
  console.log("Fetching icons from Simple Icons CDN...");
  const results: Record<string, string> = {};
  for (const slug of slugs) {
    const svg = await fetchIcon(slug);
    if (svg) {
      console.log(`Successfully fetched icon: ${slug}`);
      results[slug] = svg;
    } else {
      console.log(`Failed to fetch icon: ${slug} (might not exist)`);
    }
  }
  
  // Write to a temporary JSON file
  await Bun.write("./fetched-icons.json", JSON.stringify(results, null, 2));
  console.log("Done! Results written to ./fetched-icons.json");
}

run();
