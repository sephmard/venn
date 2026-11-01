// For websites that show Venn polls (docs/EMBED.md). Add it once, after your frames:
//   <iframe src="https://venn.day/embed/<poll>" title="Poll" allow="clipboard-write; web-share"></iframe>
//   <script src="https://venn.day/embed.js" async></script>
// Each Venn frame then grows to fit its poll, and fires a `venn` event ({ type, poll, ... }) when
// someone answers or the date is picked. Only messages from Venn, about its own frames, count.
(() => {
  const origin = new URL(document.currentScript.src).origin;
  addEventListener('message', (e) => {
    if (e.origin !== origin || !e.data || e.data.venn !== 1) return;
    const frame = [...document.querySelectorAll('iframe')].find((f) => f.contentWindow === e.source);
    if (!frame) return;
    const { type, height } = e.data;
    if (type === 'height' && height > 0) frame.style.height = `${Math.min(height, 20000)}px`;
    frame.dispatchEvent(new CustomEvent('venn', { bubbles: true, detail: e.data }));
  });
})();
