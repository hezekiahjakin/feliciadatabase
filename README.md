# F.E.L.I.C.I.A.
**Fireteam Evaluation & Logistics Intelligence Construct for Interactive Analysis**

> *"All right, Guardian. F.E.L.I.C.I.A. online and calibrated. Diagnostics are green across the board and systems are running clean. Tell me what we are tackling today—no nonsense!"*

An interactive tactical Destiny 2 web intelligence assistant powered by **Google Gemini API** with an authentic, grounded **Scottish personality**, real-time Destiny 2 build crafting across specific stat categories and weapon slots, catalyst ('catty') quest guides, and a custom **Wiki & Archival Import Hub**.

---

## 🚀 Quick Launch

To run F.E.L.I.C.I.A. locally:

```bash
cd C:\Users\kingh\.gemini\antigravity\scratch\felicia-destiny-ai
python run.py
```

### Accessing Across Your Devices:
- **Desktop / Laptop:** [http://localhost:8000](http://localhost:8000)
- **iPhone / iPad / Mobile Devices:** [http://192.168.50.6:8000](http://192.168.50.6:8000)
  - *Tip:* Click the **"Connect Mobile"** button in the top navigation bar to display an on-screen QR code you can scan with your iPad or iPhone camera!
  - *Pro-Tip for iPad / iPhone:* Tap the Share button in Safari and select **"Add to Home Screen"** to run F.E.L.I.C.I.A. as a full-screen, native-feeling tactical app!

---

## 🔥 Firebase Authentication & Cloud Firestore (`ping-vault-matrix`)

F.E.L.I.C.I.A. is configured to use your Firebase project **`ping-vault-matrix`** as the backend database and user management system:

### 1. Authentication Providers
- **Google Sign-In:** One-click OAuth 2.0 popup via the Firebase Web SDK v10.
- **Email & Password:** Full registration and sign-in with client-side credential verification.
- **Phone Authentication:** SMS one-time passcode (OTP) verification with reCAPTCHA.

### 2. Cloud Firestore Loadouts Schema
All user builds are stored under `/users/{userId}/loadouts/{loadoutId}` tracking:
- **5 Core Stat Categories:**
  - **Health (Resilience):** Tier 1–10 / 0–100 (30% PVE damage reduction threshold)
  - **Melee (Strength):** Tier 1–10 / 0–100 (Powered melee recharge)
  - **Grenade (Discipline):** Tier 1–10 / 0–100 (Grenade cooldown loops)
  - **Super (Intellect):** Tier 1–10 / 0–100 (Passive Super uptime)
  - **Class (Recovery):** Tier 1–10 / 0–100 (Rift/Barricade/Dodge & health regen rate)
- **3 Weapon Slots:**
  - **Kinetic Slot:** Weapon name, frame archetype, and perks/god rolls
  - **Energy Slot:** Weapon name, frame archetype, and perks/god rolls
  - **Heavy Slot:** Weapon name, frame archetype, and perks/god rolls
- **Aspects, Fragments & Mods:** Full loadout mod synergy and tactical combat notes.

### 3. Deploying Rules via Firebase CLI
The repository contains complete configuration files:
- [`.firebaserc`](.firebaserc) - Configured for `ping-vault-matrix`
- [`firebase.json`](firebase.json) - Auth and Firestore rules configuration
- [`firestore.rules`](firestore.rules) - Granular user security rules protecting `/users/{userId}`

To deploy or configure via Firebase CLI on this machine:
```bash
# 1. Login to Firebase
npx -y firebase-tools@latest login

# 2. Register Web App in ping-vault-matrix
npx -y firebase-tools@latest apps:create web felicia-web --project ping-vault-matrix

# 3. Retrieve Web SDK Config
npx -y firebase-tools@latest apps:sdkconfig WEB --project ping-vault-matrix

# 4. Deploy Firestore Rules
npx -y firebase-tools@latest deploy --only firestore:rules,auth --project ping-vault-matrix
```

---

## 🎨 Visual Construct Design (V1)
- **V1 Active Design:** **Vanguard Tactical Ghost Shell**
  - Interactive 60fps canvas simulation with floating geometric polyhedral shell wings.
  - Interactive ocular core with real-time cursor/touch eye tracking (F.E.L.I.C.I.A. looks directly at where your finger or mouse is pointing!).
  - Dynamic animations when thinking (rapid orbital flare) and speaking (aperture pulsing to Scottish voice cadence).
  - Shaders available: Vanguard Amber, Void Amethyst, Arc Sky, Solar Blaze, Strand Jade.
- **Alternative Design:** **Exo Tactical Construct** (switchable in the Logistics tab!).

---

## 📚 Destiny 2 Wiki & Archival Data Ingestion
You can import any Destiny 2 wiki guides, armor sets, weapon rolls, or clan raid notes:
1. Open the **"Wiki & Intel"** tab.
2. **Add Single Intel:** Click `+ Add Intel Entry` to paste guide text, drop locations, or perk tables.
3. **Bulk Import Files:** Click `Import Wiki File` and upload any `.txt`, `.md`, `.json`, or `.csv` file.
4. F.E.L.I.C.I.A. will automatically index the imported knowledge and reference your exact clan notes and custom wiki data when answering!

---

## 🧠 Gemini AI Engine
- **Active Key:** Configured via `GEMINI_API_KEY` environment variable or HUD Settings.
- **Resilient Model Cascade:** Automatically uses `gemini-3.5-flash` and `gemini-3.8-flash` with automatic demand-spike retry logic for 100% uptime and zero latency.
