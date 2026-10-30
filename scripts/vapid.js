// Prints a new key pair for phone notifications (Web Push): `npm run vapid`. Set both on the server
// (see docs/NOTIFICATIONS.md). Keep the private key secret; the public one is shared with browsers.
import { vapidKeys } from '../src/push.js';

const { publicKey, privateKey } = await vapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}`);
