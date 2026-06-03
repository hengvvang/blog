export function renderSidebarMetaHTML(
  author: string,
  formattedDate: string,
  tagsHtml: string,
  readingTime: string,
  wordCount: number,
  lastUpdatedHtml: string
): string {
  return `
    <div class="meta-row meta-tags">
      ${tagsHtml}
    </div>
    <div class="meta-row meta-metrics">
      <span class="meta-value">${readingTime || '10 min'} read</span>
      <span class="meta-divider">·</span>
      <span class="meta-value">${wordCount.toLocaleString()} words</span>
    </div>
    <div class="meta-row meta-pubdate">
      on ${formattedDate}
    </div>
    ${lastUpdatedHtml}
    <div class="meta-row meta-author">
      by <span class="meta-author-name">${author}</span>
    </div>
  `;
}
