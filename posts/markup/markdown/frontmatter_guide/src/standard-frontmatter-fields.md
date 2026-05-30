# 标准字段定义与 SEO 最佳实践

Markdown 本质上是一种非结构化的排版格式，而 Frontmatter 则为其注入了半结构化的灵魂。在大规模静态网站开发中，规范元数据字段的命名、类型，并配合自动化的 Schema 校验与 SEO 注入，是确保内容质量与搜索排名的核心关键。

---

## 核心 Frontmatter 字段规范

为了保持跨平台、跨框架的通用性，推荐采用以下经过业界验证的标准字段集合。

### 1. 基础文档元数据
*   `title` (string): 页面标题。应简明扼要，控制在 60 个字符以内以利于 SEO。
*   `description` (string): 页面描述。通常作为 HTML 的 `<meta name="description">`，建议字数 120-150 字。
*   `summary` (string): 文章摘要。用于在文章列表页展示，如未设置则默认截取正文前 100 字。
*   `date` (ISO 8601 DateTime): 原始发布时间。格式应为 `YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm:ssZ`。
*   `lastmod` (ISO 8601 DateTime): 最近更新时间。搜索引擎（如 Google）非常关注此字段，用于判断内容时效性。
*   `draft` (boolean): 草稿状态。若为 `true`，生产环境构建时将忽略此文件。
*   `author` (string | object): 作者信息。推荐定义为对象以容纳多维度信息：
    ```yaml
    author:
      name: "hengvvang"
      avatar: "/images/authors/hengvvang.png"
      twitter: "@hengvvang"
    ```

### 2. 分类与归档 (Taxonomy)
*   `tags` (array of strings): 标签。扁平化的关键字集合，用于内容过滤。
*   `categories` (array of strings): 分类。具层次结构的目录归属。
*   `series` (string | object): 系列专题。用于关联一组有序的相关文章。

### 3. 系统与排版控制 (UI & System)
*   `layout` (string): 指定渲染该文章所使用的模板或 React/Vue/Astro 组件。
*   `permalink` (string): 强行覆盖默认的路由生成规则，指定自定义的 URL 路径。
*   `toc` (boolean): 是否在页面侧边栏生成并显示“目录导航”。
*   `featured_image` 或 `image` (string): 特色封面图路径，用于列表卡片和社交媒体分享卡片。

---

## 数据验证与 Schema 设计

在没有约束的情况下，团队协作极易产生类似 `dratf: true`（拼写错误）或 `date: 2026/05/30`（格式错误）的问题，导致构建挂掉或页面行为异常。因此，使用 **Schema 校验库** 势在必行。

### 基于 Zod 的强类型 Frontmatter 定义
Zod 是当前 Node.js/TypeScript 生态中最主流的 Schema 验证库。以下是一套适用于企业级博客的 Frontmatter 验证 Schema 示例：

```typescript
import { z } from 'zod';

// 定义作者对象的 Schema
const AuthorSchema = z.object({
  name: z.string({
    required_error: "作者姓名是必填项",
  }),
  avatar: z.string().url().optional(),
  twitter: z.string().startsWith('@').optional(),
});

// 定义核心 Frontmatter Schema
export const BlogFrontmatterSchema = z.object({
  title: z.string()
    .min(5, "标题长度不能少于 5 个字符")
    .max(80, "标题长度不能超过 80 个字符"),
  
  description: z.string()
    .min(10, "SEO 描述信息过短")
    .max(200, "SEO 描述不能超过 200 个字符")
    .optional(),
  
  // 预处理：将 YAML 传入的字符串或原生 Date 对象统一转换为 Date 实例
  date: z.preprocess((val) => {
    if (typeof val === 'string' || val instanceof Date) return new Date(val);
    return val;
  }, z.date({ invalid_type_error: "发布日期格式非法 (需符合 ISO 8601)" })),
  
  lastmod: z.preprocess((val) => {
    if (typeof val === 'string' || val instanceof Date) return new Date(val);
    return val;
  }, z.date()).optional(),
  
  draft: z.boolean().default(false),
  
  tags: z.array(z.string()).default([]),
  
  categories: z.array(z.string()).default(["Uncategorized"]),
  
  // 支持传入作者名称字符串，或者完整的作者信息对象
  author: z.union([z.string(), AuthorSchema]).default("Anonymous"),
  
  layout: z.string().default("post"),
  
  image: z.string().optional(),
  
  // 针对搜索引擎爬虫的定制化配置
  sitemap: z.object({
    changefreq: z.enum(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']).default('weekly'),
    priority: z.number().min(0.0).max(1.0).default(0.5),
  }).optional(),
});

// 提取 TypeScript 类型定义
export type BlogFrontmatter = z.infer<typeof BlogFrontmatterSchema>;
```

---

## SEO 与社交媒体卡片注入

当静态生成器将 Markdown 转换为 HTML 时，Frontmatter 的数据应该被读取并自动转译为 `<head>` 区域的 SEO 标签。

### 1. Meta 标签映射矩阵

| Frontmatter 字段 | 生成的 HTML Meta 标签 | 作用与目的 |
| :--- | :--- | :--- |
| `title` | `<title>{title}</title>` | 浏览器标签栏及搜索引擎搜索结果主标题 |
| `description` | `<meta name="description" content="{description}">` | 搜索引擎结果列表中的摘要介绍 |
| `author.name` | `<meta name="author" content="{author.name}">` | 标明文档版权归属 |
| `image` | `<meta property="og:image" content="{image}">` | 微信、Slack、Twitter 转发时显示的预览大图 |
| `title` | `<meta property="og:title" content="{title}">` | Open Graph 社交分享主标题 |
| `description` | `<meta property="og:description" content="{description}">` | Open Graph 社交分享摘要 |
| `date` | `<meta property="article:published_time" content="{date}">` | 标记文章发布的标准 ISO 时间戳 |

### 2. JSON-LD 结构化数据动态生成
JSON-LD (JavaScript Object Notation for Linked Data) 是 Google 等搜索引擎极力推荐的结构化数据表达方式。通过读取 Frontmatter，我们可以在页面中动态嵌入符合 `Schema.org` 规范的 `BlogPosting` 脚本，从而在搜索结果中获得“富媒体卡片（Rich Results）”展示资格。

以下是动态生成 JSON-LD 的逻辑实现示例：

```javascript
/**
 * 根据 Frontmatter 数据生成 Google 认可的 JSON-LD 结构化数据
 * @param {Object} frontmatter 经过校验的 Frontmatter 对象
 * @param {string} pageUrl 当前页面的绝对 URL
 * @returns {string} 注入到 HTML 中的 <script> 标签内容
 */
function generateJsonLd(frontmatter, pageUrl) {
  const authorName = typeof frontmatter.author === 'object' 
    ? frontmatter.author.name 
    : frontmatter.author;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": frontmatter.title,
    "description": frontmatter.description || frontmatter.summary,
    "image": frontmatter.image ? [frontmatter.image] : [],
    "datePublished": frontmatter.date.toISOString(),
    "dateModified": frontmatter.lastmod ? frontmatter.lastmod.toISOString() : frontmatter.date.toISOString(),
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": pageUrl
    },
    "author": {
      "@type": "Person",
      "name": authorName,
      // 如果配置了 twitter 则写入
      "sameAs": frontmatter.author?.twitter ? [`https://twitter.com/${frontmatter.author.twitter.replace('@', '')}`] : []
    },
    "publisher": {
      "@type": "Organization",
      "name": "我的技术博客",
      "logo": {
        "@type": "ImageObject",
        "url": "https://example.com/logo.png"
      }
    }
  };

  return `<script type="application/ld+json">\n${JSON.stringify(structuredData, null, 2)}\n</script>`;
}
```

通过这一层转换，Markdown 文件不仅可以生成人类易读的排版页面，还能为搜索引擎机器人提供完美的语义化数据流，从而极大地提升网站的 SEO 竞争力。
