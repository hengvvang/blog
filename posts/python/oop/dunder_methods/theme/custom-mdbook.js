window.addEventListener('DOMContentLoaded', () => {
  const category = "lang";
  const subcat = "python";
  const subtopic = "oop";

  if (category && subcat) {
    const breadcrumbs = [
      { label: 'HOME', url: '/' }
    ];

    breadcrumbs.push({
      label: category.toUpperCase(),
      url: `/#/category/${category}`
    });

    breadcrumbs.push({
      label: subcat.toUpperCase(),
      url: `/#/category/${category}?subcat=${subcat}&subtopic=all`
    });

    if (subtopic && subtopic !== 'all' && subtopic !== 'others') {
      breadcrumbs.push({
        label: subtopic.toUpperCase(),
        url: `/#/category/${category}?subcat=${subcat}&subtopic=${subtopic}`
      });
    }

    const breadcrumbHTML = breadcrumbs.map(b => `<a href="${b.url}" target="_parent">${b.label}</a>`).join('<span>&gt;</span>');

    const container = document.createElement('div');
    container.className = 'mdbook-custom-breadcrumbs';
    container.innerHTML = breadcrumbHTML;
    document.body.appendChild(container);
  }
});