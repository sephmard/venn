// The home page's "Ideas and questions": a dialog that any link to /#contact (Contact, in the menu
// and the footer) opens. Its form sends a feature request or a message, emailed to the people who run this Venn
// (POST /api/contact); the form shows only when the server has that set up.

const form = document.querySelector('.contact-form');

const kind = () => form.elements.kind.value;

function showKind() {
  for (const el of form.querySelectorAll('[data-for]')) el.hidden = el.dataset.for !== kind();
  // A reply needs somewhere to go.
  form.elements.email.required = kind() === 'contact';
}

async function send(e) {
  e.preventDefault();
  const status = form.querySelector('.contact-status');
  const button = form.querySelector('button');
  if (!form.reportValidity()) return;
  button.disabled = true;
  status.textContent = 'Sending…';
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: kind(),
        message: form.elements.message.value,
        email: form.elements.email.value.trim(),
        website: form.elements.website.value,
      }),
    });
    if (!res.ok)
      throw new Error((await res.json().catch(() => ({}))).error || "Your message didn't send. Try again in a minute.");
    const thanks = kind() === 'feature' ? 'Thanks for the idea!' : 'Thanks! We’ll get back to you soon.';
    form.reset();
    showKind();
    status.textContent = thanks;
  } catch (err) {
    status.textContent = err.message === 'Failed to fetch' ? "You're offline. Try again in a minute." : err.message;
  } finally {
    button.disabled = false;
  }
}

if (form) {
  fetch('/api/config')
    .then((r) => r.json())
    .then((config) => {
      if (!config.contact) return;
      form.hidden = false;
      form.addEventListener('change', (e) => e.target.name === 'kind' && showKind());
      form.addEventListener('submit', send);
      showKind();
    })
    .catch(() => {});
}

const dialog = document.querySelector('dialog.ask');

if (dialog) {
  const open = () => dialog.open || dialog.showModal();
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-contact], a[href="/#contact"], a[href="#contact"]')) return;
    e.preventDefault();
    open();
  });
  // A tap on the backdrop closes it, like Escape and ×.
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  // Closed, it shouldn't open again on a reload.
  dialog.addEventListener(
    'close',
    () => location.hash === '#contact' && history.replaceState(null, '', location.pathname + location.search),
  );
  if (location.hash === '#contact') open();
}
