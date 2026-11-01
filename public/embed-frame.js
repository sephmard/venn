// A poll in another website's frame (/embed/<id>, docs/EMBED.md). It tells the page around it how
// tall it is, so the frame fits it, and when someone answers or the date is picked. Messages go only
// to the template's own websites, the ones allowed to frame it. Venn's credit unless it's white label.
// The website can add to the frame's address, after #: `name=` (who's answering, when it knows),
// `head=off` (it shows the poll's heading itself) and `share=off` (it invites people itself).

export function connect(poll, brand, hash = new URLSearchParams()) {
  const root = document.documentElement.classList;
  root.toggle('embed-no-head', hash.get('head') === 'off');
  root.toggle('embed-no-share', hash.get('share') === 'off');
  const sites = brand?.embedSites || [];
  const tell = (type, data = {}) => {
    if (parent === window) return;
    for (const site of sites) parent.postMessage({ venn: 1, type, poll, ...data }, site);
  };
  if (!brand?.hideVenn && !document.querySelector('.embed-credit'))
    document.body.insertAdjacentHTML(
      'beforeend',
      '<p class="embed-credit" style="text-align:center;font-size:.8125rem;margin:0;padding:4px 16px 12px"><a href="/" target="_blank" rel="noopener" style="color:var(--muted)">Made with Venn</a></p>',
    );
  let last = 0;
  const size = () => {
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    if (height && height !== last) tell('height', { height: (last = height) });
  };
  const watch = new ResizeObserver(size);
  watch.observe(document.body);
  tell('ready');
  size();
  return { tell, name: (hash.get('name') || '').trim().slice(0, 80) };
}
