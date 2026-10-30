// This device's side of notifications (Web Push; src/push.js on the server, sw.js to show them):
// whether it can have them, and its subscription. One subscription serves every poll on this device.

/** { ios, app, supported }: an iPhone or iPad; opened from the Home Screen; can be notified. */
export function pushSupport() {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const app = matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { ios, app, supported };
}

/** This device's subscription, if it has one. */
export async function currentSub() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg?.pushManager.getSubscription();
}

/** Ask, then subscribe with the server's public key (base64url); resolves to the subscription. */
export async function subscribe(key) {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications weren’t allowed');
  const reg = await navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready);
  return (
    (await reg.pushManager.getSubscription()) ||
    reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
    })
  );
}
