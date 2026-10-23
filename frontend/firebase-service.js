/**
 * F.E.L.I.C.I.A. // Firebase Modular Web Service (v10)
 * Project: ping-vault-matrix
 * Features: Firebase Auth (Google, Email/Password, Phone) + Cloud Firestore
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Default Project Configuration for ping-vault-matrix
const DEFAULT_CONFIG = {
  apiKey: "AIzaSyD-XZwCw2uncP0xmcUoVXjSQ_scsFYor8M",
  authDomain: "ping-vault-matrix.firebaseapp.com",
  databaseURL: "https://ping-vault-matrix-default-rtdb.firebaseio.com",
  projectId: "ping-vault-matrix",
  storageBucket: "ping-vault-matrix.firebasestorage.app",
  messagingSenderId: "306532505507",
  appId: "1:306532505507:web:8400fcebe0746c51ef6c16",
  measurementId: "G-V17Y87T532"
};

let app = null;
let auth = null;
let db = null;
let recaptchaVerifier = null;
let phoneConfirmationResult = null;

export function getFirebaseConfig() {
  const saved = localStorage.getItem("felicia_firebase_config");
  if (saved) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch (e) {}
  }
  return DEFAULT_CONFIG;
}

export function saveFirebaseConfig(cfg) {
  const merged = { ...getFirebaseConfig(), ...cfg };
  localStorage.setItem("felicia_firebase_config", JSON.stringify(merged));
  if (cfg.apiKey) localStorage.setItem("felicia_firebase_apiKey", cfg.apiKey);
  if (cfg.appId) localStorage.setItem("felicia_firebase_appId", cfg.appId);
  return initFirebase(merged);
}

// Fetch host configuration from backend server so members connect automatically!
export async function fetchServerFirebaseConfig() {
  try {
    const res = await fetch("/api/firebase/web-config");
    if (res.ok) {
      const serverCfg = await res.json();
      if (serverCfg.apiKey) {
        saveFirebaseConfig(serverCfg);
        return serverCfg;
      }
    }
  } catch (e) {
    console.warn("[Firebase] Could not fetch server config:", e);
  }
  return getFirebaseConfig();
}

export function initFirebase(cfg = null) {
  const config = cfg || getFirebaseConfig();
  
  // If no apiKey is set, provide a placeholder or return uninitialized state
  if (!config.apiKey) {
    console.warn("[Firebase] No apiKey set for project ping-vault-matrix yet. Using offline/local storage fallback.");
    return { initialized: false, projectId: config.projectId };
  }

  try {
    if (!getApps().length) {
      app = initializeApp(config);
    } else {
      app = getApps()[0];
    }
    auth = getAuth(app);
    db = getFirestore(app);
    return { initialized: true, app, auth, db, projectId: config.projectId };
  } catch (err) {
    console.error("[Firebase] Initialization error:", err);
    return { initialized: false, error: err.message, projectId: config.projectId };
  }
}

// Ensure initialized
initFirebase();

/* ==========================================================================
   AUTHENTICATION WORKFLOWS (Google, Email/Password, Phone)
   ========================================================================== */

export function subscribeAuth(callback) {
  if (!auth) {
    const res = initFirebase();
    if (!res.initialized) {
      callback(null);
      return () => {};
    }
  }
  return onAuthStateChanged(auth, (user) => {
    callback(user);
  });
}

// 1. Google Sign-In with Popup
export async function loginWithGoogle() {
  if (!auth) initFirebase();
  if (!auth) throw new Error("Firebase Auth not initialized. Please enter your Firebase Web Config in Logistics.");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

// 2. Email & Password Sign-In
export async function loginWithEmail(email, password) {
  if (!auth) initFirebase();
  if (!auth) throw new Error("Firebase Auth not initialized. Please enter your Firebase Web Config in Logistics.");
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// 2b. Email & Password Sign-Up
export async function signUpWithEmail(email, password) {
  if (!auth) initFirebase();
  if (!auth) throw new Error("Firebase Auth not initialized. Please enter your Firebase Web Config in Logistics.");
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// 3. Phone Authentication (Recaptcha + SMS Code)
export async function setupPhoneRecaptcha(containerId) {
  if (!auth) initFirebase();
  if (!auth) throw new Error("Firebase Auth not initialized.");
  
  if (recaptchaVerifier) {
    recaptchaVerifier.clear();
  }
  
  recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: "normal",
    callback: () => {
      console.log("[Firebase Auth] Recaptcha verified successfully.");
    },
    "expired-callback": () => {
      console.warn("[Firebase Auth] Recaptcha expired. Please verify again.");
    }
  });
  await recaptchaVerifier.render();
  return recaptchaVerifier;
}

export async function sendPhoneVerificationCode(phoneNumber, containerId = "recaptcha-container") {
  if (!auth) initFirebase();
  if (!auth) throw new Error("Firebase Auth not initialized.");
  
  const verifier = await setupPhoneRecaptcha(containerId);
  phoneConfirmationResult = await signInWithPhoneNumber(auth, phoneNumber, verifier);
  return phoneConfirmationResult;
}

export async function verifyPhoneSmsCode(verificationCode) {
  if (!phoneConfirmationResult) {
    throw new Error("No pending SMS confirmation request. Please send verification code first.");
  }
  const result = await phoneConfirmationResult.confirm(verificationCode);
  return result.user;
}

// 4. Sign Out
export async function logoutUser() {
  if (!auth) return;
  await signOut(auth);
}

// 5. Update Profile Display Name / Call-Sign
export async function updateUserCallsign(newDisplayName) {
  if (!auth) initFirebase();
  if (!auth || !auth.currentUser) throw new Error("No Guardian is currently signed in.");
  
  await updateProfile(auth.currentUser, { displayName: newDisplayName });
  
  if (db) {
    try {
      const userDoc = doc(db, "users", auth.currentUser.uid);
      await setDoc(userDoc, { displayName: newDisplayName, updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) {
      console.warn("[Firestore] Profile doc update warning:", e);
    }
  }
  return auth.currentUser;
}

/* ==========================================================================
   CLOUD FIRESTORE // USER LOADOUTS & BUILD CRAFTING
   Tracking modern 6-stat system (0-200 scale):
   Health, Melee, Grenade, Super, Class, and Weapons.
   ========================================================================== */

export async function getFirestoreLoadouts(userId) {
  if (!db) initFirebase();
  if (!db || !userId) return null;

  try {
    const loadoutsCol = collection(db, "users", userId, "loadouts");
    const q = query(loadoutsCol, orderBy("updatedAt", "desc"));
    const snapshot = await getDocs(q);
    const list = [];
    snapshot.forEach((d) => {
      list.push({ id: d.id, ...d.data() });
    });
    return list;
  } catch (err) {
    console.error("[Firestore] Error fetching loadouts:", err);
    throw err;
  }
}

export async function saveFirestoreLoadout(userId, loadoutData) {
  if (!db) initFirebase();
  if (!db || !userId) throw new Error("Firestore not initialized or user not logged in.");

  const loadoutPayload = {
    name: loadoutData.name || loadoutData.title || "Custom Loadout",
    guardianClass: loadoutData.guardianClass || loadoutData.guardian_class || "Warlock",
    subclass: loadoutData.subclass || "Solar 3.0",
    exoticArmor: loadoutData.exoticArmor || loadoutData.exotic_armor || "None",
    
    // Modern Stat System (Health, Melee, Grenade, Super, Class, Weapons) scaling 0-200
    stats: {
      health: Number(loadoutData.stats?.health ?? loadoutData.health ?? 100),
      melee: Number(loadoutData.stats?.melee ?? loadoutData.melee ?? 60),
      grenade: Number(loadoutData.stats?.grenade ?? loadoutData.grenade ?? 100),
      super: Number(loadoutData.stats?.super ?? loadoutData.super ?? 40),
      classStat: Number(loadoutData.stats?.classStat ?? loadoutData.classStat ?? 80),
      weapons: Number(loadoutData.stats?.weapons ?? loadoutData.weapons ?? 100)
    },

    // Weapons (Kinetic, Energy, Heavy)
    weapons: {
      kinetic: {
        name: loadoutData.weapons?.kinetic?.name || loadoutData.kinetic_weapon || "Witherhoard",
        archetype: loadoutData.weapons?.kinetic?.archetype || "Special Grenade Launcher",
        perks: loadoutData.weapons?.kinetic?.perks || "Auto-Loading Holster",
        notes: loadoutData.weapons?.kinetic?.notes || ""
      },
      energy: {
        name: loadoutData.weapons?.energy?.name || loadoutData.energy_weapon || "Sunshot",
        archetype: loadoutData.weapons?.energy?.archetype || "150 RPM Solar Hand Cannon",
        perks: loadoutData.weapons?.energy?.perks || "Sun Blast + Explosive Payload",
        notes: loadoutData.weapons?.energy?.notes || ""
      },
      heavy: {
        name: loadoutData.weapons?.heavy?.name || loadoutData.heavy_weapon || "Apex Predator",
        archetype: loadoutData.weapons?.heavy?.archetype || "Adaptive Rocket Launcher",
        perks: loadoutData.weapons?.heavy?.perks || "Reconstruction + Bait and Switch",
        notes: loadoutData.weapons?.heavy?.notes || ""
      }
    },

    keyAspects: loadoutData.keyAspects || loadoutData.key_aspects_fragments || "",
    notes: loadoutData.notes || "",
    userId: userId,
    updatedAt: serverTimestamp()
  };

  if (loadoutData.id && !loadoutData.id.startsWith("build-")) {
    // Update existing
    const docRef = doc(db, "users", userId, "loadouts", loadoutData.id);
    await setDoc(docRef, loadoutPayload, { merge: true });
    return { id: loadoutData.id, ...loadoutPayload };
  } else {
    // Add new document
    loadoutPayload.createdAt = serverTimestamp();
    const docRef = await addDoc(collection(db, "users", userId, "loadouts"), loadoutPayload);
    return { id: docRef.id, ...loadoutPayload };
  }
}

export async function deleteFirestoreLoadout(userId, loadoutId) {
  if (!db) initFirebase();
  if (!db || !userId) throw new Error("Firestore not initialized.");
  const docRef = doc(db, "users", userId, "loadouts", loadoutId);
  await deleteDoc(docRef);
  return { id: loadoutId, deleted: true };
}
