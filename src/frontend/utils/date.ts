// Date formatting helpers
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
