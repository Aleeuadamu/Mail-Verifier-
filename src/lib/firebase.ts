import { initializeApp } from 'firebase/app';
import { 
  initializeAuth, 
  browserLocalPersistence, 
  browserSessionPersistence, 
  inMemoryPersistence,
  getAuth,
  browserPopupRedirectResolver
} from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Avoid IndexedDB-based local persistence in sandboxed preview iframes,
// which triggers "Pending promise was never set" assertion failures.
let firebaseAuth;
try {
  firebaseAuth = initializeAuth(app, {
    persistence: [browserLocalPersistence, browserSessionPersistence, inMemoryPersistence],
    popupRedirectResolver: browserPopupRedirectResolver
  });
} catch (e) {
  // Fallback in case initializeAuth was already called
  firebaseAuth = getAuth(app);
}

export const auth = firebaseAuth;

// Configure Firestore with long-polling to work reliably in sandboxed/preview iframes.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});
