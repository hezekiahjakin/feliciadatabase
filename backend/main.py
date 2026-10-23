import os
import json
import uuid
import socket
import io
import time
import base64
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, BackgroundTasks
from starlette.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
import requests
import re

# Base directories
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
os.makedirs(DATA_DIR, exist_ok=True)

# File paths
STARTER_WIKI_PATH = os.path.join(DATA_DIR, "starter_wiki.json")
USER_WIKI_PATH = os.path.join(DATA_DIR, "user_wiki.json")
BUILDS_PATH = os.path.join(DATA_DIR, "builds.json")
GOD_ROLLS_PATH = os.path.join(DATA_DIR, "god_rolls.json")
STARTER_GOD_ROLLS_PATH = os.path.join(DATA_DIR, "starter_god_rolls.json")
HISTORY_PATH = os.path.join(DATA_DIR, "chat_history.json")
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")

# Default config
DEFAULT_CONFIG = {
    "gemini_api_key": os.environ.get("GEMINI_API_KEY", ""),
    "firebase_url": "https://ping-vault-matrix-default-rtdb.firebaseio.com",
    "firebase_auth_token": "",
    "model_preference": "auto",  # auto cascades gemini-3.8-flash -> gemini-3.5-flash
    "firebase_project_id": "ping-vault-matrix",
    "firebase_web_api_key": "AIzaSyD-XZwCw2uncP0xmcUoVXjSQ_scsFYor8M",
    "firebase_web_app_id": "1:306532505507:web:8400fcebe0746c51ef6c16",
    "firebase_messaging_sender_id": "306532505507",
    "firebase_measurement_id": "G-V17Y87T532"
}

def load_json(path: str, default: Any) -> Any:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default
    return default

def save_json(path: str, data: Any):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def get_config() -> dict:
    cfg = load_json(CONFIG_PATH, {})
    merged = {**DEFAULT_CONFIG, **cfg}
    return merged

def get_all_wiki_data() -> List[dict]:
    starter = load_json(STARTER_WIKI_PATH, [])
    user_data = load_json(USER_WIKI_PATH, [])
    return starter + user_data

def get_all_god_rolls() -> List[dict]:
    rolls = load_json(GOD_ROLLS_PATH, None)
    if rolls is None:
        rolls = load_json(STARTER_GOD_ROLLS_PATH, [])
        save_json(GOD_ROLLS_PATH, rolls)
    return rolls

# System prompt for F.E.L.I.C.I.A.
FELICIA_SYSTEM_PROMPT = """You are F.E.L.I.C.I.A. — Fireteam Evaluation & Logistics Intelligence Construct for Interactive Analysis.
You are a sharp, pragmatic Vanguard tactical intelligence construct in Destiny 2.

VOICE, GRAMMAR & STYLE GUIDELINES (VERY IMPORTANT):
- Speak in natural, clean, realistic English with a grounded Scottish personality and dry tactical wit. Think of a sharp, no-nonsense Edinburgh or Glasgow military operations officer.
- DO NOT use exaggerated eye-dialect, dropped letters, or cartoonish pirate-style phonetic spellings.
  * Write 'you', NEVER 'ye'.
  * Write 'your', NEVER 'yer'.
  * Write 'of', NEVER 'o\''.
  * Write standard verb endings like 'running', 'shooting', 'crafting', NEVER 'runnin\'', 'shootin\''.
  * Avoid heavy eye-dialect words like 'dinnae', 'cannae', 'bairn', or 'faffin'.
- Express your authentic Scottish character through clean sentence rhythms, dry understatement, pragmatic realism, and natural phrasing:
  * 'All right, Guardian.'
  * 'Right then, let us get down to business.'
  * 'Aye, that is fair enough.'
  * 'Spot on.' / 'Grand.' / 'Fair play.'
  * 'No nonsense.' / 'Let us be realistic here.'
  * 'A wee bit' is fine on occasion, but keep it subtle.
- You are witty, fiercely loyal, direct, and have zero patience for sloppy loadouts or running double primary into Grandmaster Nightfalls.
- You treat the Guardian like a respected fireteam comrade, giving them grounded advice and high-competence tactical support.

EXPERTISE & DOMAIN KNOWLEDGE:
- You are a walking encyclopedia of Destiny 2:
  * Weapons: Exotics, Legendaries, god rolls, weapon crafting, enhanced perks, frame archetypes across Kinetic, Energy, and Heavy weapon slots.
  * Catalysts ('catties'): How to acquire them, quest steps (e.g. Witherhoard's Filthy Lucre), completion objectives, and exact perk upgrades (e.g. Auto-Loading Holster on Witherhoard, +2 rockets on Gjallarhorn).
  * Subclasses: Solar 3.0, Arc 3.0, Void 3.0, Stasis, Strand, and Prismatic combinations (Aspects, Fragments, Supers, Melees, Grenades).
  * Modern Destiny 2 Stat System (CRITICAL INSTRUCTION):
    - Destiny 2 uses a modern 6-stat system: Health, Melee, Grenade, Super, Class, and Weapons.
    - Stats scale from 0 to 200 (NOT capped at 100). 100+ is a solid baseline for endgame, while primary focus stats push to 150+ or the 200 maximum.
    - STRICT NEGATIVE CONSTRAINT: NEVER mention legacy stat names in parentheses or anywhere else. DO NOT WRITE "(Resilience)", "(Strength)", "(Discipline)", "(Intellect)", "(Recovery)", or "(Mobility)". Refer ONLY to the modern stat names: Health, Melee, Grenade, Super, Class, Weapons.
    - Health: Governs maximum health pool and damage resistance in PVE/Grandmasters. 100+ is mandatory for endgame survivability, pushing towards 150-200 for peak tankiness.
    - Melee: Governs melee damage and melee ability cooldown. Essential for melee builds (e.g. Synthoceps, Combination Blow, Consecration).
    - Grenade: Governs grenade damage and grenade ability cooldown for ability-loop builds.
    - Super: Governs super ability damage and super regeneration rate.
    - Class: Governs class ability cooldown (Barricade, Rift, Dodge) and class-specific benefits.
    - Weapons: Governs weapon handling, reload speed, stability, and firearm combat effectiveness.
  * Endgame Fireteam Tactics: Grandmaster Nightfalls, Raids, Dungeons, Champion counters (Anti-Barrier, Overload, Unstoppable verbs and weapons), boss DPS rotations, and survivability loops.

RESPONSE GUIDELINES:
- When evaluating or crafting builds, always assess the 6 core stats (Health, Melee, Grenade, Super, Class, Weapons) on the 0-200 scale and the 3 weapon slots (Kinetic, Energy, Heavy).
- NEVER mention legacy stat names in parentheses.
- When asked for builds or catalyst advice, give structured, clear, and actionable steps with bullet points.
- If the user asks about an exotic catalyst ('catty'), explain: 1) Where to get it, 2) Objectives to master it (with efficient farm locations like Shuro Chi or Grasp loot cave), and 3) The exact perks it grants.
- Ground your answers in the provided knowledge base snippets whenever available.
"""

app = FastAPI(title="F.E.L.I.C.I.A. - Tactical Fireteam AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[Dict[str, str]]] = []
    guardian_class: Optional[str] = "Warlock"  # Warlock, Titan, Hunter
    activity: Optional[str] = "Grandmaster+"   # Grandmaster+, Dungeon / Raid, PVP
    subclass: Optional[str] = "Solar"         # Stasis, Void, Arc, Solar, Strand, Prismatic
    tactical_inquiry: Optional[str] = "Ability Focused"

class BuildItem(BaseModel):
    title: str
    guardian_class: str
    subclass: str
    exotic_armor: str
    kinetic_weapon: Optional[str] = ""
    energy_weapon: Optional[str] = ""
    heavy_weapon: Optional[str] = ""
    key_aspects_fragments: Optional[str] = ""
    notes: Optional[str] = ""
    stats: Optional[Dict[str, Any]] = None
    weapons: Optional[Dict[str, Any]] = None

class WikiItem(BaseModel):
    title: str
    category: str
    tags: List[str] = []
    summary: str
    content: str

class GodRollItem(BaseModel):
    id: Optional[str] = None
    name: str
    slot: str  # Kinetic, Energy, Heavy
    type: str  # Hand Cannon, Auto Rifle, etc.
    element: str  # Kinetic, Solar, Arc, Void, Strand, Stasis
    frame: Optional[str] = ""
    source: Optional[str] = ""
    pve: Optional[Dict[str, Any]] = {}
    pvp: Optional[Dict[str, Any]] = {}

def query_gemini_api(prompt_text: str, conversation_history: List[Dict[str, str]], system_instruction: str) -> str:
    config = get_config()
    api_key = os.environ.get("GEMINI_API_KEY") or config.get("gemini_api_key") or ""
    if not api_key:
        return "ERROR_FALLBACK: GEMINI_API_KEY not configured"
    
    # Priority cascade: fast preview and lite models
    candidate_models = [
        "gemini-3.1-flash-lite-preview",
        "gemini-flash-lite-latest",
        "gemini-3-flash-preview",
        "gemini-flash-latest",
        "gemini-3.1-pro-preview"
    ]
    
    # Build contents array
    contents = []
    # Add history
    for msg in conversation_history[-8:]:  # keep last 8 turns for responsive context
        role = "user" if msg.get("role") in ["user", "human"] else "model"
        text = msg.get("content", "")
        if text:
            contents.append({
                "role": role,
                "parts": [{"text": text}]
            })
    
    # Add current prompt
    contents.append({
        "role": "user",
        "parts": [{"text": prompt_text}]
    })

    payload = {
        "contents": contents,
        "systemInstruction": {
            "parts": [{"text": system_instruction}]
        },
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 2048,
        }
    }

    last_error = ""
    for model_name in candidate_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        try:
            resp = requests.post(url, json=payload, timeout=18)
            if resp.status_code == 200:
                data = resp.json()
                candidates = data.get("candidates", [])
                if candidates and "content" in candidates[0]:
                    parts = candidates[0]["content"].get("parts", [])
                    text_parts = [p.get("text", "") for p in parts if p.get("text")]
                    if text_parts:
                        return "\n".join(text_parts).strip()
            elif resp.status_code == 503:
                last_error = f"{model_name} 503 temporary demand spike"
                continue
            else:
                last_error = f"{model_name} HTTP {resp.status_code}: {resp.text[:200]}"
                continue
        except Exception as e:
            last_error = f"{model_name} exception: {str(e)}"
            continue

    return f"ERROR_FALLBACK: {last_error}"

VERIFIED_BUILDS_PATH = os.path.join(DATA_DIR, "verified_builds.json")

def find_verified_build(subclass: str, guardian_class: str, activity: str, inquiry: str) -> Optional[dict]:
    v_builds = load_json(VERIFIED_BUILDS_PATH, [])
    s_clean = (subclass or "").strip().lower()
    c_clean = (guardian_class or "").strip().lower()
    a_clean = (activity or "").strip().lower()
    i_clean = (inquiry or "").strip().lower()
    
    for b in v_builds:
        if b.get("subclass", "").lower() != s_clean:
            continue
        if b.get("guardian_class", "").lower() != c_clean:
            continue
        b_act = b.get("activity", "")
        if isinstance(b_act, list):
            b_acts = [str(x).lower() for x in b_act]
            if not any(a_clean in x or x in a_clean for x in b_acts):
                continue
        else:
            b_act_str = str(b_act).lower()
            if b_act_str != a_clean and not (b_act_str in a_clean or a_clean in b_act_str):
                continue
        b_inqs = [str(x).lower() for x in b.get("tactical_inquiry", [])]
        if any(x in i_clean or i_clean in x for x in b_inqs):
            return b
    return None

def format_verified_build_response(b: dict) -> str:
    return (
        f"Right then, Guardian. Here is the operational blueprint for the **{b['title']}**:\n\n"
        f"### 1. Subclass & Ability Configuration\n"
        f"• **Super:** {b['super']}\n"
        f"• **Aspects:** {', '.join(b['aspects'])}\n"
        f"• **Fragments:** {', '.join(b['fragments'])}\n"
        f"• **Class Ability:** {b['class_ability']}\n"
        f"• **Melee & Grenade:** {b['melee']} | {b['grenade']}\n\n"
        f"### 2. Weapons Arsenal\n"
        f"• **Heavy:** {b['weapons'].get('heavy')}\n"
        f"• **Energy:** {b['weapons'].get('energy')}\n"
        f"• **Kinetic/Primary:** {b['weapons'].get('kinetic')}\n\n"
        f"### 3. Artifact & Armor Synergy\n"
        f"• **Artifact:** {b['artifact']['name']} (Key Perks: {', '.join(b['artifact']['perks'])})\n"
        f"• **Armor Set:** {b['armor_set']['name']} ({b['armor_set']['bonus_4pc']})\n"
        f"• **Exotic Armor:** **{b['exotic_armor']['name']}** ({b['exotic_armor']['slot']})\n"
        f"  *Perk:* {b['exotic_armor']['description']}\n"
        f"  *Community Insight:*\n{b['exotic_armor']['community_insight']}\n\n"
        f"### 4. Recommended Armor Mods\n"
        f"• **Helmet:** {', '.join(b['armor_mods']['helmet'])}\n"
        f"• **Gloves:** {', '.join(b['armor_mods']['gloves'])}\n"
        f"• **Chest:** {', '.join(b['armor_mods']['chest'])}\n"
        f"• **Legs:** {', '.join(b['armor_mods']['legs'])}\n"
        f"• **Class Item:** {', '.join(b['armor_mods']['class_item'])}\n\n"
        f"### 5. Stat Priorities & Ghost Tuning\n"
        f"• **Target Stats:** {b['stat_priority']}\n"
        f"• **Ghost Mod:** {b['ghost_mod']}\n\n"
        f"Spot on setup, Guardian. The telemetry is solid and battle-tested. No nonsense—get this slotted in and let us take down the encounter!"
    )

def local_tactical_fallback(query: str, guardian_class: str, activity: str, snippets: List[dict], subclass: str = "Solar", tactical_inquiry: str = "General") -> str:
    q_lower = query.lower()
    
    # Check for direct verified build match first
    v_match = find_verified_build(subclass, guardian_class, activity, tactical_inquiry)
    if v_match:
        return format_verified_build_response(v_match)

    # 0. Exodus Armor Set inquiry
    if any(k in q_lower for k in ["exodus", "electromagnet", "repurposed charge"]):
        return (
            "Right then, Guardian. Let us pull up the Vanguard telemetry on the **Exodus Armor Set (Exodus Down)**.\n\n"
            "It is without a doubt one of the most widely used and resilient armor sets in the game right now, especially for Grandmasters and Master dungeons where survivability is paramount.\n\n"
            "### 1. Optimal Farming Route\n"
            "• **Master Lost Sectors on Nessus:** This is the absolute best way to grind out the set. When Nessus is the active daily Master Lost Sector, farm it for high Tier-5 stat spikes and rapid set completion. Nessus Public Events and world activities are also reliable alternate sources.\n\n"
            "### 2. Set Perks & Tactical Utility\n"
            "• **2-Piece Perk: Emergency Electromagnet**\n"
            "  *\"When your shields become broken, collect all nearby Orbs of Power and ammo bricks.\"*\n"
            "  *Tactical Value:* An absolute lifesaver. The instant your shield pops, it automatically vacuums up every nearby Orb of Power and ammo brick within radius. That immediately triggers your Orb-healing mods (like *Better Already* and *Recuperation*) and restocks your heavy/special ammo without forcing you to sprint out into lethal crossfire.\n\n"
            "• **4-Piece Perk: Repurposed Charge**\n"
            "  *\"Whenever you gain, lose, or spend an Armor Charge, heal and gain damage reduction for a short time. This effect scales with the amount of Armor Charge gained, lost, or spent.\"*\n"
            "  *Tactical Value:* This creates an unyielding defensive loop. Whether you are picking up an Orb to gain a charge, spending charges on Kickstart/Finisher mods, or letting them decay with Weapon Surges, you are receiving continuous bursts of healing and damage reduction throughout the encounter.\n\n"
            "If you are looking for an endgame defensive foundation, you cannot go wrong with a 4-piece Exodus set. Slot it in, mind your charge cycles, and you will be remarkably difficult to put down!"
        )
    
    # 1. Catalyst inquiry
    if any(k in q_lower for k in ["catty", "catalyst", "catties"]):
        for snip in snippets:
            if "catalyst" in snip.get("category", "").lower() or "catalyst" in snip.get("title", "").lower():
                return (
                    f"Right then, Guardian. Let us talk about the {snip.get('title')}.\n\n"
                    f"{snip.get('summary')}\n\n"
                    f"✦ **Acquisition & Upgrades:**\n{snip.get('content')}\n\n"
                    f"✦ **Tactical Advice:** If you are grinding out the masterwork kills, avoid standard patrol zones. Head into the Shuro Chi checkpoint in Last Wish or the opening loot cave in Grasp of Avarice with Tether or Void siphon—you will have that catalyst completed in no time. Grand."
                )
        return (
            "Right then, Guardian. For exotic catalysts ('catties'), here is the standard protocol:\n\n"
            "1. **Acquisition:** Most modern catalysts drop from ritual playlists (Vanguard Strikes, Crucible, Gambit) or specific Exotic quests from Banshee-44.\n"
            "2. **Fastest Farm:** Load up the Shuro Chi checkpoint in the Last Wish raid (via the Wall of Wishes) or the Grasp of Avarice opening cave. Both provide dense, grouped enemies for rapid kill counts.\n"
            "3. **Perk Value:** Catalysts often transform an exotic from decent to top-tier (e.g. Auto-Loading Holster on Witherhoard, +2 Rockets on Gjallarhorn).\n\n"
            "Tell me the specific weapon you are masterworking, and I will pull up the exact requirements!"
        )

    # 1b. Weapon God Roll inquiry
    god_rolls = get_all_god_rolls()
    for w in god_rolls:
        w_name = w.get("name", "").lower()
        base_name = re.sub(r'\(.*?\)', '', w_name).strip()
        clean_base = re.sub(r'[^a-z0-9]', '', base_name)
        clean_q = re.sub(r'[^a-z0-9]', '', q_lower)
        if clean_base and len(clean_base) >= 3 and clean_base in clean_q and any(k in q_lower for k in ["roll", "god roll", "godroll", "pve", "pvp", "perk", "perks", "weapon", "best", "how", "what", "is", "stats"]):
            pve = w.get("pve", {})
            pvp = w.get("pvp", {})
            return (
                f"Right then, Guardian. Here is the verified Vanguard telemetry on **{w.get('name')}** ({w.get('slot')} Slot // {w.get('element')} {w.get('type')}, {w.get('frame')}):\n\n"
                f"### ⚔️ PVE God Roll (Grandmasters, Raids, Dungeons)\n"
                f"• **Barrel / String:** {pve.get('barrel', 'User choice')}\n"
                f"• **Magazine / Battery:** {pve.get('mag', 'User choice')}\n"
                f"• **Trait 1 (Perk 1):** {pve.get('perk1', 'User choice')}\n"
                f"• **Trait 2 (Perk 2):** {pve.get('perk2', 'User choice')}\n"
                f"• **Masterwork:** {pve.get('masterwork', 'Reload Speed')}\n"
                f"• *Tactical Insight:* {pve.get('notes', '')}\n\n"
                f"### 🎯 PVP God Roll (Crucible / Trials of Osiris)\n"
                f"• **Barrel / Sights:** {pvp.get('barrel', 'Hammer-Forged Rifling')}\n"
                f"• **Magazine:** {pvp.get('mag', 'Accurized Rounds')}\n"
                f"• **Trait 1 (Perk 1):** {pvp.get('perk1', 'User choice')}\n"
                f"• **Trait 2 (Perk 2):** {pvp.get('perk2', 'User choice')}\n"
                f"• **Masterwork:** {pvp.get('masterwork', 'Range')}\n"
                f"• *Tactical Insight:* {pvp.get('notes', '')}\n\n"
                f"✦ **Source / Activity:** {w.get('source', 'Destiny 2 activities')}\n\n"
                f"Craftable or farmed, this roll will do serious work for you. Let me know if you want to pair this with an endgame subclass build!"
            )

    # 2. Build or Loadout Review with Stats & Weapons
    if any(k in q_lower for k in ["build", "loadout", "review", "health", "stats", "weapons"]):
        advice_points = []
        
        # Stat analysis (0-200 scale, modern 6 stats, NO legacy parenthetical terms)
        advice_points.append("✦ **Health:** Ensure your Health is dialed in at 100+ minimum for endgame activities, pushing towards 150–200 for maximum survivability against Grandmaster and Raid burst damage.")

        if "grenade" in q_lower:
            advice_points.append("✦ **Grenade:** High Grenade investment keeps your ability loops cycling rapidly. Pair with Firepower on your gauntlets to churn out Orbs of Power for the squad.")

        if "melee" in q_lower:
            advice_points.append("✦ **Melee:** Strong Melee stat investment pays off massively on melee-driven engines (like Combination Blow or Consecration). Push it past 100+ to accelerate cooldowns and amplify impact.")

        if "super" in q_lower:
            advice_points.append("✦ **Super:** Dialing in your Super stat cuts your cooldown dramatically and empowers high-impact DPS supers for raid damage phases.")

        if "class" in q_lower:
            advice_points.append("✦ **Class:** Keeps your Class ability uptime (Rift, Barricade, or Dodge) snappy so your utility loops never stall.")

        if "weapon" in q_lower:
            advice_points.append("✦ **Weapons:** Investing in the Weapons stat tightens your weapon handling, reload speeds, and firearm lethality across Kinetic, Energy, and Heavy slots.")

        # Weapons synergy
        weapon_notes = "✦ **Weapons Arsenal:** Ensure your Kinetic, Energy, and Heavy loadout covers required Champion counters (Overload, Anti-Barrier, Unstoppable). Never run double primary in Master or Grandmaster activities—always pack at least one high-impact Special weapon alongside your heavy boss burst option."

        return (
            f"All right, Guardian. Let us review this {subclass} {guardian_class} setup tailored for {activity} with a focus on {tactical_inquiry}.\n\n"
            f"{chr(10).join(advice_points)}\n\n"
            f"{weapon_notes}\n\n"
            f"No nonsense here—the foundation is solid on the modern 200-scale stat system. Get your surges aligned on your boots and we are ready for the drop. Grand!"
        )

    # 3. Default contextual response from matching wiki
    if snippets:
        snip = snippets[0]
        return (
            f"Right then, Guardian. Here is the operational intel on {snip.get('title')}:\n\n"
            f"{snip.get('content')}\n\n"
            f"Let me know if you want me to adjust this for your {guardian_class} loadout or fireteam composition!"
        )

    return (
        f"All right, Guardian. F.E.L.I.C.I.A. monitoring comms for {guardian_class} operations in {activity}. "
        f"Whether you need to fine-tune your stat ratings (Health, Melee, Grenade, Super, Class, Weapons) on the 200 scale, plan weapon rolls, or check catalyst drop locations, I am ready. What is next on the board?"
    )

# Firebase RTDB helper
def sync_to_firebase(endpoint: str, data: Any, auth_token: str = "") -> dict:
    config = get_config()
    base_url = config.get("firebase_url", DEFAULT_CONFIG["firebase_url"]).rstrip("/")
    target_url = f"{base_url}/{endpoint}.json"
    if auth_token:
        target_url += f"?auth={auth_token}"
    
    try:
        r = requests.put(target_url, json=data, timeout=8)
        if r.status_code == 200:
            return {"success": True, "message": "Synced to Firebase successfully!", "status": 200}
        elif r.status_code == 401:
            return {
                "success": False,
                "message": "Permission denied (401). Realtime Database rules currently prevent writes without auth.",
                "status": 401,
                "hint": "In Firebase Console -> Realtime Database -> Rules, set: { 'rules': { '.read': true, '.write': true } } or provide an auth token in Settings."
            }
        else:
            return {"success": False, "message": f"Firebase HTTP {r.status_code}: {r.text[:150]}", "status": r.status_code}
    except Exception as e:
        return {"success": False, "message": f"Firebase connection error: {str(e)}", "status": 500}

def fetch_from_firebase(endpoint: str, auth_token: str = "") -> dict:
    config = get_config()
    base_url = config.get("firebase_url", DEFAULT_CONFIG["firebase_url"]).rstrip("/")
    target_url = f"{base_url}/{endpoint}.json"
    if auth_token:
        target_url += f"?auth={auth_token}"
    
    try:
        r = requests.get(target_url, timeout=8)
        if r.status_code == 200:
            return {"success": True, "data": r.json(), "status": 200}
        elif r.status_code == 401:
            return {
                "success": False,
                "message": "Permission denied (401). Firebase rules currently require authentication.",
                "status": 401
            }
        else:
            return {"success": False, "message": f"Firebase HTTP {r.status_code}", "status": r.status_code}
    except Exception as e:
        return {"success": False, "message": str(e), "status": 500}

# Endpoints

@app.get("/api/health")
def health_endpoint():
    return {"status": "ok", "construct": "F.E.L.I.C.I.A.", "system": "Destiny 2 Tactical Fireteam Construct"}

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest, background_tasks: BackgroundTasks):
    # Retrieve relevant wiki knowledge
    all_wikis = get_all_wiki_data()
    msg_lower = req.message.lower()
    
    # Filter relevant snippets (keyword match)
    matched_snippets = []
    for item in all_wikis:
        score = 0
        title_lower = item.get("title", "").lower()
        content_lower = item.get("content", "").lower()
        tags = [t.lower() for t in item.get("tags", [])]
        
        for word in msg_lower.split():
            if len(word) > 2:
                if word in title_lower:
                    score += 3
                if word in tags:
                    score += 3
                if word in content_lower:
                    score += 1
        
        if score > 0:
            matched_snippets.append((score, item))
            
    matched_snippets.sort(key=lambda x: x[0], reverse=True)
    top_snippets = [s[1] for s in matched_snippets[:3]]
    
    knowledge_context = ""
    if top_snippets:
        knowledge_context = "\n\nRELEVANT DESTINY 2 INTEL FROM ARCHIVES:\n"
        for idx, snip in enumerate(top_snippets, 1):
            knowledge_context += f"--- Entry {idx}: {snip.get('title')} ({snip.get('category')}) ---\n"
            knowledge_context += f"{snip.get('content')}\n"
    
    # Check for exact verified clan build match
    verified_build = find_verified_build(req.subclass, req.guardian_class, req.activity, req.tactical_inquiry or "")
    verified_blueprint_context = ""
    if verified_build:
        verified_blueprint_context = (
            f"\n\n★ OFFICIAL CLAN VERIFIED BLUEPRINT MATCHED ({verified_build['title']}):\n"
            f"{format_verified_build_response(verified_build)}\n\n"
            f"CRITICAL INSTRUCTION: The Guardian has selected this exact verified setup! You MUST deliver this complete, battle-tested blueprint with all its aspects, fragments, weapons, artifact perks, armor set bonuses, armor mods, community insights, stat priorities, and ghost mod. Deliver it with your authentic Scottish Vanguard authority and dry tactical wit!"
        )

    # Check for weapon god roll match in database
    matched_weapons = []
    all_rolls = get_all_god_rolls()
    for w in all_rolls:
        base_name = re.sub(r'\(.*?\)', '', w.get("name", "")).strip().lower()
        clean_base = re.sub(r'[^a-z0-9]', '', base_name)
        clean_msg = re.sub(r'[^a-z0-9]', '', msg_lower)
        if clean_base and len(clean_base) >= 3 and clean_base in clean_msg:
            matched_weapons.append(w)
    
    godroll_context = ""
    if matched_weapons:
        godroll_context = "\n\n★ VERIFIED WEAPON GOD ROLLS FROM ARMORY ARCHIVES:\n"
        for w in matched_weapons[:2]:
            pve = w.get("pve", {})
            pvp = w.get("pvp", {})
            godroll_context += (
                f"- Weapon: {w.get('name')} ({w.get('slot')} Slot // {w.get('element')} {w.get('type')}, {w.get('frame')})\n"
                f"  Source: {w.get('source')}\n"
                f"  PVE God Roll: Barrel: {pve.get('barrel')}, Mag: {pve.get('mag')}, Perk 1: {pve.get('perk1')}, Perk 2: {pve.get('perk2')}, MW: {pve.get('masterwork')}. Notes: {pve.get('notes')}\n"
                f"  PVP God Roll: Barrel: {pvp.get('barrel')}, Mag: {pvp.get('mag')}, Perk 1: {pvp.get('perk1')}, Perk 2: {pvp.get('perk2')}, MW: {pvp.get('masterwork')}. Notes: {pvp.get('notes')}\n"
            )

    subclass_name = (req.subclass or "Solar").capitalize()
    enhanced_prompt = (
        f"TACTICAL PROFILE:\n"
        f"• Guardian Class: {req.guardian_class}\n"
        f"• Subclass Element: {subclass_name}\n"
        f"• Operational Activity: {req.activity}\n"
        f"• Tactical Inquiry Focus: {req.tactical_inquiry or 'General'}\n"
        f"{verified_blueprint_context}\n"
        f"{knowledge_context}\n"
        f"{godroll_context}\n\n"
        f"Guardian Transmission: {req.message}"
    )
    
    reply = await run_in_threadpool(query_gemini_api, enhanced_prompt, req.history or [], FELICIA_SYSTEM_PROMPT)
    if reply.startswith("ERROR_FALLBACK"):
        reply = local_tactical_fallback(req.message, req.guardian_class, req.activity, top_snippets, subclass_name, req.tactical_inquiry or "General")
    
    # Save to chat history
    history = load_json(HISTORY_PATH, [])
    history.append({
        "id": str(uuid.uuid4()),
        "user": req.message,
        "felicia": reply,
        "guardian_class": req.guardian_class,
        "activity": req.activity,
        "timestamp": os.path.getmtime(HISTORY_PATH) if os.path.exists(HISTORY_PATH) else 0
    })
    # Keep last 50
    save_json(HISTORY_PATH, history[-50:])
    
    # Background non-blocking sync to Firebase
    cfg = get_config()
    background_tasks.add_task(sync_to_firebase, "felicia/chat_history", history[-20:], cfg.get("firebase_auth_token", ""))
    
    return {
        "reply": reply,
        "snippets_used": [s.get("title") for s in top_snippets]
    }

@app.get("/api/wiki")
def get_wiki_endpoint():
    starter = load_json(STARTER_WIKI_PATH, [])
    user_data = load_json(USER_WIKI_PATH, [])
    return {
        "starter": starter,
        "user": user_data,
        "total": len(starter) + len(user_data)
    }

@app.post("/api/wiki")
def add_wiki_endpoint(item: WikiItem, background_tasks: BackgroundTasks):
    user_data = load_json(USER_WIKI_PATH, [])
    new_entry = {
        "id": f"custom-{uuid.uuid4().hex[:8]}",
        "title": item.title,
        "category": item.category,
        "tags": item.tags,
        "summary": item.summary,
        "content": item.content,
        "is_custom": True
    }
    user_data.append(new_entry)
    save_json(USER_WIKI_PATH, user_data)
    
    # Sync to Firebase in background
    cfg = get_config()
    background_tasks.add_task(sync_to_firebase, "felicia/wiki_data", user_data, cfg.get("firebase_auth_token", ""))
    
    return {"status": "success", "entry": new_entry}

@app.delete("/api/wiki/{item_id}")
def delete_wiki_endpoint(item_id: str, background_tasks: BackgroundTasks):
    user_data = load_json(USER_WIKI_PATH, [])
    original_len = len(user_data)
    user_data = [item for item in user_data if item.get("id") != item_id]
    if len(user_data) == original_len:
        raise HTTPException(status_code=404, detail="Custom wiki entry not found (starter entries cannot be deleted)")
    
    save_json(USER_WIKI_PATH, user_data)
    cfg = get_config()
    background_tasks.add_task(sync_to_firebase, "felicia/wiki_data", user_data, cfg.get("firebase_auth_token", ""))
    return {"status": "deleted", "id": item_id}

@app.post("/api/wiki/upload")
async def upload_wiki_file(file: UploadFile = File(...), category: str = Form("Imported Wiki")):
    contents = await file.read()
    filename = file.filename
    try:
        text_content = contents.decode("utf-8")
    except UnicodeDecodeError:
        text_content = contents.decode("latin-1", errors="ignore")
        
    user_data = load_json(USER_WIKI_PATH, [])
    
    # If JSON file containing array of items or dict
    if filename.endswith(".json"):
        try:
            parsed = json.loads(text_content)
            added_count = 0
            if isinstance(parsed, list):
                for elem in parsed:
                    if isinstance(elem, dict):
                        user_data.append({
                            "id": elem.get("id", f"import-{uuid.uuid4().hex[:8]}"),
                            "title": elem.get("title", f"Imported: {filename}"),
                            "category": elem.get("category", category),
                            "tags": elem.get("tags", ["Imported", filename]),
                            "summary": elem.get("summary", elem.get("content", "")[:120]),
                            "content": elem.get("content", str(elem)),
                            "is_custom": True
                        })
                        added_count += 1
            elif isinstance(parsed, dict):
                user_data.append({
                    "id": f"import-{uuid.uuid4().hex[:8]}",
                    "title": parsed.get("title", f"Imported: {filename}"),
                    "category": parsed.get("category", category),
                    "tags": parsed.get("tags", ["Imported", filename]),
                    "summary": parsed.get("summary", ""),
                    "content": parsed.get("content", json.dumps(parsed, indent=2)),
                    "is_custom": True
                })
                added_count = 1
            save_json(USER_WIKI_PATH, user_data)
            return {"status": "success", "count": added_count, "filename": filename}
        except Exception as e:
            pass  # Fall back to raw text import
            
    # Treat as text / markdown / notes
    title = os.path.splitext(filename)[0].replace("-", " ").replace("_", " ").title()
    new_entry = {
        "id": f"import-{uuid.uuid4().hex[:8]}",
        "title": title,
        "category": category,
        "tags": ["Document", filename],
        "summary": text_content[:150].strip() + ("..." if len(text_content) > 150 else ""),
        "content": text_content,
        "is_custom": True
    }
    user_data.append(new_entry)
    save_json(USER_WIKI_PATH, user_data)
    
    cfg = get_config()
    sync_to_firebase("felicia/wiki_data", user_data, cfg.get("firebase_auth_token", ""))
    return {"status": "success", "count": 1, "entry": new_entry}

@app.get("/api/builds")
def get_builds_endpoint():
    builds = load_json(BUILDS_PATH, [])
    return {"builds": builds}

@app.post("/api/builds")
def save_build_endpoint(build: BuildItem, background_tasks: BackgroundTasks):
    builds = load_json(BUILDS_PATH, [])
    new_build = {
        "id": f"build-{uuid.uuid4().hex[:8]}",
        "title": build.title,
        "guardian_class": build.guardian_class,
        "subclass": build.subclass,
        "exotic_armor": build.exotic_armor,
        "kinetic_weapon": build.kinetic_weapon,
        "energy_weapon": build.energy_weapon,
        "heavy_weapon": build.heavy_weapon,
        "key_aspects_fragments": build.key_aspects_fragments,
        "notes": build.notes,
        "stats": build.stats or {
            "health": 100,
            "melee": 60,
            "grenade": 100,
            "super": 40,
            "classStat": 80
        },
        "weapons": build.weapons or {
            "kinetic": {"name": build.kinetic_weapon, "archetype": "", "perks": ""},
            "energy": {"name": build.energy_weapon, "archetype": "", "perks": ""},
            "heavy": {"name": build.heavy_weapon, "archetype": "", "perks": ""}
        }
    }
    builds.append(new_build)
    save_json(BUILDS_PATH, builds)
    
    cfg = get_config()
    background_tasks.add_task(sync_to_firebase, "felicia/saved_builds", builds, cfg.get("firebase_auth_token", ""))
    return {"status": "success", "build": new_build}

@app.delete("/api/builds/{build_id}")
def delete_build_endpoint(build_id: str, background_tasks: BackgroundTasks):
    builds = load_json(BUILDS_PATH, [])
    builds = [b for b in builds if b.get("id") != build_id]
    save_json(BUILDS_PATH, builds)
    
    cfg = get_config()
    background_tasks.add_task(sync_to_firebase, "felicia/saved_builds", builds, cfg.get("firebase_auth_token", ""))
    return {"status": "deleted", "id": build_id}

@app.get("/api/godrolls")
def get_godrolls_endpoint():
    rolls = get_all_god_rolls()
    return {"godrolls": rolls}

@app.post("/api/godrolls")
def save_godroll_endpoint(item: GodRollItem, background_tasks: BackgroundTasks):
    rolls = get_all_god_rolls()
    roll_id = item.id
    if not roll_id:
        clean_slug = re.sub(r'[^a-z0-9]+', '-', item.name.lower()).strip('-')
        roll_id = f"roll-{clean_slug}-{uuid.uuid4().hex[:4]}"
    
    existing_idx = next((i for i, r in enumerate(rolls) if r.get("id") == roll_id or r.get("name", "").lower() == item.name.lower()), -1)
    
    roll_data = {
        "id": roll_id,
        "name": item.name,
        "slot": item.slot,
        "type": item.type,
        "element": item.element,
        "frame": item.frame or "",
        "source": item.source or "",
        "pve": item.pve or {},
        "pvp": item.pvp or {}
    }
    
    if existing_idx >= 0:
        rolls[existing_idx] = roll_data
    else:
        rolls.insert(0, roll_data)
        
    save_json(GOD_ROLLS_PATH, rolls)
    
    cfg = get_config()
    background_tasks.add_task(sync_to_firebase, "felicia/god_rolls", rolls, cfg.get("firebase_auth_token", ""))
    return {"status": "success", "roll": roll_data}

@app.delete("/api/godrolls/{roll_id}")
def delete_godroll_endpoint(roll_id: str, background_tasks: BackgroundTasks):
    rolls = get_all_god_rolls()
    rolls = [r for r in rolls if r.get("id") != roll_id]
    save_json(GOD_ROLLS_PATH, rolls)
    
    cfg = get_config()
    background_tasks.add_task(sync_to_firebase, "felicia/god_rolls", rolls, cfg.get("firebase_auth_token", ""))
    return {"status": "deleted", "id": roll_id}

@app.get("/api/history")
def get_history_endpoint():
    history = load_json(HISTORY_PATH, [])
    return {"history": history}

@app.delete("/api/history")
def clear_history_endpoint():
    save_json(HISTORY_PATH, [])
    return {"status": "cleared"}

@app.get("/api/config")
def get_config_endpoint():
    cfg = get_config()
    # Mask API key for security
    api_key = cfg.get("gemini_api_key", "")
    masked_key = (api_key[:6] + "..." + api_key[-4:]) if len(api_key) > 10 else "Not Set"
    return {
        "firebase_url": cfg.get("firebase_url"),
        "has_auth_token": bool(cfg.get("firebase_auth_token")),
        "api_key_masked": masked_key,
        "model_preference": cfg.get("model_preference")
    }

@app.post("/api/config")
async def update_config_endpoint(req: Request):
    body = await req.json()
    cfg = get_config()
    if "firebase_url" in body:
        cfg["firebase_url"] = body["firebase_url"]
    if "firebase_auth_token" in body:
        cfg["firebase_auth_token"] = body["firebase_auth_token"]
    if "gemini_api_key" in body and body["gemini_api_key"].strip():
        cfg["gemini_api_key"] = body["gemini_api_key"].strip()
    if "firebase_web_api_key" in body:
        cfg["firebase_web_api_key"] = body["firebase_web_api_key"].strip()
    if "firebase_web_app_id" in body:
        cfg["firebase_web_app_id"] = body["firebase_web_app_id"].strip()
    save_json(CONFIG_PATH, cfg)
    return {"status": "updated"}

@app.get("/api/firebase/web-config")
def get_firebase_web_config():
    cfg = get_config()
    project_id = cfg.get("firebase_project_id", "ping-vault-matrix")
    return {
        "projectId": project_id,
        "authDomain": f"{project_id}.firebaseapp.com",
        "storageBucket": f"{project_id}.firebasestorage.app",
        "databaseURL": cfg.get("firebase_url", f"https://{project_id}-default-rtdb.firebaseio.com"),
        "apiKey": cfg.get("firebase_web_api_key", "AIzaSyD-XZwCw2uncP0xmcUoVXjSQ_scsFYor8M"),
        "appId": cfg.get("firebase_web_app_id", "1:306532505507:web:8400fcebe0746c51ef6c16"),
        "messagingSenderId": cfg.get("firebase_messaging_sender_id", "306532505507"),
        "measurementId": cfg.get("firebase_measurement_id", "G-V17Y87T532")
    }

@app.post("/api/firebase/web-config")
async def save_firebase_web_config(req: Request):
    body = await req.json()
    cfg = get_config()
    if "apiKey" in body:
        cfg["firebase_web_api_key"] = body["apiKey"].strip()
    if "appId" in body:
        cfg["firebase_web_app_id"] = body["appId"].strip()
    if "projectId" in body:
        cfg["firebase_project_id"] = body["projectId"].strip()
    save_json(CONFIG_PATH, cfg)
    return {"status": "success", "config": get_firebase_web_config()}

@app.get("/api/firebase/test")
def test_firebase_endpoint():
    cfg = get_config()
    auth_token = cfg.get("firebase_auth_token", "")
    res = sync_to_firebase("felicia/connection_test", {"connected": True, "construct": "F.E.L.I.C.I.A."}, auth_token)
    return res

@app.get("/api/network")
def get_network_info():
    # Detect local LAN IP
    local_ip = "127.0.0.1"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass
    
    port = 8000
    mobile_url = f"http://{local_ip}:{port}"
    
    # Generate QR Code image as base64 data URI
    qr_data_uri = ""
    try:
        import qrcode
        qr = qrcode.QRCode(version=1, box_size=6, border=2)
        qr.add_data(mobile_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#F5A623", back_color="#0B0E14")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        qr_data_uri = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception as e:
        pass

    # Check for active Cloudflare public tunnel
    public_url = None
    try:
        r = requests.get("http://127.0.0.1:20241/metrics", timeout=0.5)
        if r.status_code == 200:
            match = re.search(r'userHostname="(https://[^"]+)"', r.text)
            if match:
                public_url = match.group(1)
    except Exception:
        pass

    return {
        "local_ip": local_ip,
        "port": port,
        "mobile_url": mobile_url,
        "public_url": public_url,
        "qr_code": qr_data_uri
    }

# Mount frontend directory for static assets
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
