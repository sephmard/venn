// Landing page for calendar sign-in popups. Hands the result (from the URL) back to the
// Venn page that opened it, then closes. Tokens never reach the server: they are in the
// URL fragment (Google) or exchanged by the opener using PKCE (Microsoft).
(function () {
  const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
  const result = Object.fromEntries(params);
  history.replaceState(null, '', location.pathname); // keep tokens out of history
  const channel = new BroadcastChannel('venn-oauth');
  channel.postMessage(result);
  channel.close();
  document.getElementById('msg').textContent = result.error
    ? 'Calendar access was not granted. You can close this window.'
    : 'Connected. You can close this window.';
  setTimeout(() => window.close(), 300);
})();
