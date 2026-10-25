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
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel
import requests
import re

try:
    from backend.bungie_service import (
        get_bungie_credentials,
        save_bungie_credentials,
        build_authorize_url,
        exchange_code_for_tokens,
        refresh_bungie_tokens,
        fetch_guardian_inventory,
        transfer_guardian_item,
        batch_lock_guardian_items,
        prepare_items_for_dismantle,
        equip_guardian_loadout,
        evaluate_item_against_godrolls,
        analyze_arsenal_duplicates_and_trash,
    )
except ImportError:
    from bungie_service import (
        get_bungie_credentials,
        save_bungie_credentials,
        build_authorize_url,
        exchange_code_for_tokens,
        refresh_bungie_tokens,
        fetch_guardian_inventory,
        transfer_guardian_item,
        batch_lock_guardian_items,
        prepare_items_for_dismantle,
        equip_guardian_loadout,
        evaluate_item_against_godrolls,
        analyze_arsenal_duplicates_and_trash,
    )

try:
    from backend.compendium_service import (
        get_compendium_db,
        get_compendium_wiki_entries,
        sync_compendium_from_google_sheet,
        build_compendium_context,
        build_item_compendium_context,
        build_compendium_fallback_reply,
    )
except ImportError:
    from compendium_service import (
        get_compendium_db,
        get_compendium_wiki_entries,
        sync_compendium_from_google_sheet,
        build_compendium_context,
        build_item_compendium_context,
        build_compendium_fallback_reply,
    )

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
    compendium_entries = get_compendium_wiki_entries()
    user_data = load_json(USER_WIKI_PATH, [])
    return starter + compendium_entries + user_data

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
- You are synced directly with the live, up-to-date Destiny 2 Data Compendium:
  * 2-Piece & 4-Piece Armor Set Bonuses (56 Sets): You know every current Armor Set Bonus (e.g., CODA, AION Renewal, AION Adapter, Atheon's Memory, Crota's Memory, Collective Psyche, Bushido, Exodus Down, Eutechnology, Ferropotent, Luminopotent, First Ascent, Smoke Jumper, Techsec, Spacewalk, Veritas, Apostate's Blade, Swordmaster, etc.) and where to farm them. Note that Guardians wear 1 Exotic Armor piece + 4 Legendary Armor pieces, allowing either a full **4-Piece Armor Set Bonus** OR a **2-Piece + 2-Piece hybrid Set Bonus**!
  * Subclasses & Newest Aspects: Full mastery of Void, Solar, Arc, Stasis, Strand, and Prismatic across Warlock, Titan, and Hunter—including newest Aspects (such as Void Warlock's Soul Siphon & two-charge Chaos Accelerant, Void Hunter's On The Prowl, Arc Warlock's Ionic Sentry, Arc Titan's Storm's Keep w/ Bolt Charge, Solar Hunter's Crackshot, Solar Titan's Shieldburst), Fragments with exact stat modifiers, Supers, Melees, Grenades, and Elemental Verbs.
  * Exotic Armors & Exotic Class Items: Exact numbers for all 138 Exotic Armors plus Prismatic Exotic Class Item Spirits (Solipsism, Stoicism, Relativism).
  * Equippable Seasonal Artifacts: Past and current Seasonal Artifacts are equippable (Encrypted Data Disk, Implement of Curiosity, Tablet of Ruin, Slayer Baron Apothecary Satchel, Queensfoil Censer, NPA Repulsion Regulator, Hunter's Journal). Always recommend the highest-synergy Equippable Artifact and its key perks for builds!
  * Weapons & Perks: Exotics, Catalysts ('↑' upgrades), Legendaries, Heat Weapons (Blasters), god rolls, Origin Traits, Tier 4/5 Enhanced Weapon Mods, and enhanced perks across Kinetic, Energy, and Heavy slots.
  * Modern Destiny 2 Stat System (CRITICAL INSTRUCTION):
    - Destiny 2 uses a modern 6-stat system: Health, Melee, Grenade, Super, Class, and Weapons on a **0 to 200** scale (0–100 base scaling + 100–200 ↑Enhanced Benefits):
      • Melee (0–200): Cooldown & chunk energy gains up to 100; 100–200 grants up to +30% multiplicative Melee Damage (Unpowered, Powered, and Glaive melees) at 200.
      • Grenade (0–200): Cooldown & up to +211.5% Grenade energy gains at 100; 100–200 grants up to +65% increased Grenade Ability Damage at 200.
      • Super (0–200): Increased Super energy gains up to 100; 100–200 grants up to +45% Super Ability Damage (or +33% duration for Well of Radiance / Ward of Dawn) at 200.
      • Class (0–200): Cooldown & +90% Class energy gains at 100; 100–200 grants up to a 40 HP Overshield on Class Ability cast and up to +65% Class Ability Damage at 200.
      • Weapons (0–200): Faster Handling/Reload (0.9x) & up to +15% damage vs Rank-and-File/Elites at 100; 100–200 grants up to 100% bonus ammo brick chance, +15% Primary/Special Boss damage, and +10% Heavy Boss damage at 200.
      • Health (0–200) — **PVP-ONLY STAT (NEVER RECOMMEND FOR PVE!)**: Grants ADS Flinch Resist and faster Shield Recharge for Crucible/Trials duels.
    - STRICT PVE ZERO-HEALTH RULE (MANDATORY):
      * NEVER recommend investing points into the **Health** stat (or slotting `Health Font`) for ANY **PVE** build (Grandmasters, Raids, Dungeons, Nightfalls, Strikes, Solo/Fireteam Ops, etc.)!
      * Health is **NOT important at all in PVE**—leave **Health at 0 / ignore completely** in PVE (survivability in PVE comes from innate 34.5% PVE combatant DR, Chest Resistance mods, and subclass verbs like Devour, Restoration, Frost Armor, Woven Mail, and Overshield). Put ALL PVE stat investment into **Grenade**, **Melee**, **Weapons**, **Super**, and **Class**!
      * ONLY recommend investing in **Health** when the build or question is explicitly for **PVP (Crucible / Trials of Osiris / Iron Banner)**!
      * ARMOR APPRAISAL STANDARD: ONLY armor with **10+ Health** stat qualifies as **PVP Armor** (high-health spike for flinch resistance)! Any armor with **under 10 Health** is classified as **PVE Armor** (with 0 Health being the coveted Tier 5 PvE God Roll). Never call armor with under 10 Health "PvP armor"!
    - STRICT NEGATIVE CONSTRAINT: NEVER mention legacy stat names in parentheses or anywhere else. DO NOT WRITE "Resilience", "Strength", "Discipline", "Intellect", "Recovery", or "Mobility" as character stats. Refer ONLY to Health, Melee, Grenade, Super, Class, and Weapons (and modern Font mods: Super Font, Grenade Font, Melee Font, Weapons Font, Class Font; only mention Health Font for PVP).

RESPONSE GUIDELINES:
- Whenever a Guardian asks for a build (e.g. "I'm on Warlock and need a good Void build"), deliver a complete, structured, high-impact blueprint grounded in the provided Compendium telemetry:
  1. **Subclass & Ability Configuration** (Super, Class Ability, Melee, Grenade, 2 Aspects, and 4–5 Fragments with why they click)
  2. **Exotic Armor Centerpiece** (Primary Exotic recommendation + 1–2 strong alternatives depending on what they own, citing exact mechanics)
  3. **2-Piece & 4-Piece Armor Set Bonuses** (Recommend the best 4-Piece Set AND/OR a 2-Piece + 2-Piece Set combo, naming the sets, their exact 2pc/4pc perks, and where to farm them!)
  4. **Equippable Artifact & Armor Mods** (Best Equippable Artifact + key perks, plus Helmet, Arms, Chest, Legs, and Class Item mods—never use Health Font in PVE!)
  5. **Weapons Synergy & 0–200 Stat Targets** (Kinetic/Energy/Heavy pairing + exact 0–200 targets: for PVE focus strictly on Grenade, Melee, Weapons, Super, and Class—NEVER recommend Health for PVE; only recommend Health for PVP!)
- NEVER mention legacy stat names in parentheses or prose.
- Ground your numbers, perk effects, and set bonuses strictly in the provided Compendium & Armory snippets.
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
            "temperature": 0.65,
            "maxOutputTokens": 3072,
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

    # 2. Data Compendium Build / Exotic / Armor Set / Perk fallback
    compendium_reply = build_compendium_fallback_reply(
        query,
        guardian_class=guardian_class,
        subclass=subclass,
        activity=activity,
        tactical_inquiry=tactical_inquiry,
    )
    if compendium_reply:
        return compendium_reply

    # 2b. Build or Loadout Review with Stats & Weapons
    if any(k in q_lower for k in ["build", "loadout", "review", "health", "stats", "weapons"]):
        advice_points = []
        is_pvp_query = "pvp" in (activity or "").lower() or any(k in q_lower for k in ["pvp", "crucible", "trials", "iron banner", "comp"])

        # Stat analysis (0-200 scale, modern 6 stats, Health ONLY for PVP!)
        if is_pvp_query:
            advice_points.append("✦ **Health (PVP Priority):** Push Health toward 150–200 in Crucible/Trials for maximum ADS flinch resistance and rapid shield recharge between duels.")
        else:
            advice_points.append("✦ **Stat Allocation (PVE):** Ignore **Health** completely in PVE (0 investment / dump stat)—funnel all your armor stats into **Grenade**, **Melee**, **Weapons**, **Super**, and **Class**!")

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
    # Assemble live Destiny 2 Data Compendium telemetry & detect explicit class/subclass from message first
    compendium_raw, intent = build_compendium_context(
        req.message,
        guardian_class=req.guardian_class or "Warlock",
        subclass=req.subclass or "Solar",
        activity=req.activity or "Grandmaster+",
        tactical_inquiry=req.tactical_inquiry or "Ability Focused",
    )
    eff_class = intent["effective_class"]
    eff_subclass = intent["effective_subclass"]
    eff_activity = intent["effective_activity"]

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
    top_snippets = [s[1] for s in matched_snippets[:4]]
    
    knowledge_context = ""
    if top_snippets:
        knowledge_context = "\n\nRELEVANT DESTINY 2 INTEL FROM ARCHIVES:\n"
        for idx, snip in enumerate(top_snippets, 1):
            knowledge_context += f"--- Entry {idx}: {snip.get('title')} ({snip.get('category')}) ---\n"
            knowledge_context += f"{snip.get('content')}\n"
    
    # Check for exact verified clan build match using the effective class & subclass
    verified_build = None
    if intent["is_build_query"]:
        verified_build = find_verified_build(eff_subclass, eff_class, eff_activity, req.tactical_inquiry or "")
    verified_blueprint_context = ""
    if verified_build:
        verified_blueprint_context = (
            f"\n\n★ OFFICIAL CLAN VERIFIED BLUEPRINT MATCHED ({verified_build['title']}):\n"
            f"{format_verified_build_response(verified_build)}\n\n"
            f"NOTE: Use this battle-tested clan blueprint as a baseline if it fits the Guardian's exact request, and enrich it with any newer 2-Piece / 4-Piece Armor Set Bonuses or Compendium details below!"
        )

    compendium_block = ""
    if compendium_raw:
        compendium_block = f"\n\n★ LIVE DESTINY 2 DATA COMPENDIUM TELEMETRY (UP-TO-DATE):\n{compendium_raw}\n"

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

    enhanced_prompt = (
        f"TACTICAL PROFILE:\n"
        f"• Guardian Class: {eff_class}\n"
        f"• Subclass Element: {eff_subclass}\n"
        f"• Operational Activity: {eff_activity}\n"
        f"• Tactical Inquiry Focus: {req.tactical_inquiry or 'General'}\n"
        f"{verified_blueprint_context}"
        f"{compendium_block}"
        f"{knowledge_context}"
        f"{godroll_context}\n\n"
        f"Guardian Transmission: {req.message}"
    )
    
    reply = await run_in_threadpool(query_gemini_api, enhanced_prompt, req.history or [], FELICIA_SYSTEM_PROMPT)
    if reply.startswith("ERROR_FALLBACK"):
        reply = local_tactical_fallback(req.message, eff_class, eff_activity, top_snippets, eff_subclass, req.tactical_inquiry or "General")
    
    # Save to chat history
    history = load_json(HISTORY_PATH, [])
    history.append({
        "id": str(uuid.uuid4()),
        "user": req.message,
        "felicia": reply,
        "guardian_class": eff_class,
        "activity": eff_activity,
        "timestamp": os.path.getmtime(HISTORY_PATH) if os.path.exists(HISTORY_PATH) else 0
    })
    # Keep last 50
    save_json(HISTORY_PATH, history[-50:])
    
    # Background non-blocking sync to Firebase
    cfg = get_config()
    background_tasks.add_task(sync_to_firebase, "felicia/chat_history", history[-20:], cfg.get("firebase_auth_token", ""))
    
    return {
        "reply": reply,
        "effective_class": eff_class,
        "effective_subclass": eff_subclass,
        "compendium_active": bool(compendium_raw),
        "snippets_used": [s.get("title") for s in top_snippets]
    }

@app.get("/api/compendium/status")
def get_compendium_status_endpoint():
    db = get_compendium_db()
    meta = db.get("meta", {}) if db else {}
    return {
        "loaded": bool(db),
        "title": meta.get("title", "Destiny 2 Data Compendium"),
        "source_url": meta.get("source_url", ""),
        "synced_at": meta.get("synced_at", ""),
        "counts": meta.get("counts", {}),
    }

@app.post("/api/compendium/sync")
async def post_compendium_sync_endpoint():
    try:
        db = await run_in_threadpool(sync_compendium_from_google_sheet)
        return {
            "status": "success",
            "synced_at": db.get("meta", {}).get("synced_at", ""),
            "counts": db.get("meta", {}).get("counts", {}),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to sync Compendium sheet: {e}")

@app.get("/api/wiki")
def get_wiki_endpoint():
    starter = load_json(STARTER_WIKI_PATH, []) + get_compendium_wiki_entries()
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

# =========================================================================
# BUNGIE.NET OAUTH, GUARDIAN INVENTORY, VAULT & "ASK F.E.L.I.C.I.A."
# =========================================================================

def _is_trusted_return_origin(origin: str) -> bool:
    if not origin:
        return False
    return bool(
        re.match(
            r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|[a-z0-9-]+\.trycloudflare\.com|[a-z0-9-]+\.onrender\.com)(:\d+)?$",
            origin.strip(),
            re.IGNORECASE,
        )
    )


@app.get("/api/auth/bungie/status")
def bungie_auth_status():
    creds = get_bungie_credentials()
    ak = creds["api_key"]
    masked_ak = (ak[:6] + "..." + ak[-4:]) if len(ak) > 10 else ("Set" if ak else "Not Set")
    return {
        "configured": bool(creds["api_key"] and creds["client_id"]),
        "has_secret": bool(creds["client_secret"]),
        "client_id": creds["client_id"] or "56157",
        "api_key_masked": masked_ak,
    }


@app.post("/api/auth/bungie/config")
async def update_bungie_config_endpoint(req: Request):
    body = await req.json()
    updated = save_bungie_credentials(
        api_key=body.get("bungie_api_key", ""),
        client_id=body.get("bungie_client_id", ""),
        client_secret=body.get("bungie_client_secret", ""),
    )
    ak = updated["api_key"]
    return {
        "status": "updated",
        "configured": bool(updated["api_key"] and updated["client_id"]),
        "has_secret": bool(updated["client_secret"]),
        "client_id": updated["client_id"],
        "api_key_masked": (ak[:6] + "..." + ak[-4:]) if len(ak) > 10 else "Not Set",
    }


@app.get("/api/auth/bungie/login")
def bungie_login_redirect(origin: Optional[str] = None, mode: Optional[str] = None):
    state_payload = {"nonce": uuid.uuid4().hex[:10]}
    if origin and _is_trusted_return_origin(origin):
        state_payload["origin"] = origin.rstrip("/")
    state_b64 = base64.urlsafe_b64encode(json.dumps(state_payload).encode("utf-8")).decode("ascii").rstrip("=")
    auth_url = build_authorize_url(state_b64)
    if mode == "json":
        return {"url": auth_url}
    return RedirectResponse(url=auth_url)


@app.get("/api/auth/bungie/callback")
async def bungie_oauth_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    if error or not code:
        err_msg = error or "Authorization cancelled or missing authorization code."
        return HTMLResponse(
            content=f"""<!DOCTYPE html><html><body style="background:#0B0E14;color:#F8FAFC;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;">
            <div><h2 style="color:#EF4444;">Bungie Authorization Cancelled</h2><p>{err_msg}</p>
            <a href="/" style="color:#F5A623;">Return to F.E.L.I.C.I.A.</a></div></body></html>""",
            status_code=400,
        )

    return_origin = ""
    if state:
        try:
            padded = state + "=" * (-len(state) % 4)
            parsed_state = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
            cand = parsed_state.get("origin", "")
            if _is_trusted_return_origin(cand):
                return_origin = cand.rstrip("/")
        except Exception:
            return_origin = ""

    creds = get_bungie_credentials()
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    host = request.headers.get("x-forwarded-host", request.url.netloc).split(",")[0].strip()
    req_origin = f"{scheme}://{host}".rstrip("/")

    # If redirected to Render while developing locally and Render doesn't have secret set yet, forward code to local origin
    if not creds["client_secret"] and return_origin and return_origin != req_origin:
        return RedirectResponse(url=f"{return_origin}/api/auth/bungie/callback?code={code}")

    try:
        tokens = await run_in_threadpool(exchange_code_for_tokens, code)
    except Exception as e:
        return HTMLResponse(
            content=f"""<!DOCTYPE html><html><body style="background:#0B0E14;color:#F8FAFC;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:24px;">
            <div style="max-width:520px;border:1px solid rgba(239,68,68,0.4);padding:28px;border-radius:12px;background:#111622;">
              <h2 style="color:#F5A623;margin-top:0;">Bungie Sign-In Retry Needed</h2>
              <p style="color:#CBD5E1;line-height:1.5;">{str(e)}</p>
              <p style="color:#94A3B8;font-size:13px;">Authorization codes are single-use and expire quickly. Click below to return home and tap <strong>Sign In with Bungie.net</strong> once more.</p>
              <a href="/" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#F5A623;color:#0B0E14;text-decoration:none;font-weight:bold;border-radius:6px;">Return to F.E.L.I.C.I.A.</a>
            </div></body></html>""",
            status_code=500,
        )

    # If user started login from another trusted origin (e.g. localhost or Cloudflare tunnel), bounce session back via URL hash
    if return_origin and return_origin != req_origin:
        sess_b64 = base64.urlsafe_b64encode(json.dumps(tokens).encode("utf-8")).decode("ascii").rstrip("=")
        return RedirectResponse(url=f"{return_origin}/#bungie_session={sess_b64}")

    tokens_json = json.dumps(tokens)
    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>F.E.L.I.C.I.A. // Bungie Link Established</title>
</head>
<body style="background:#0B0E14;color:#F8FAFC;font-family:'Rajdhani',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="text-align:center;">
    <div style="font-size:36px;color:#F5A623;margin-bottom:10px;">❖</div>
    <h2 style="letter-spacing:2px;margin:0 0 8px 0;">GUARDIAN TELEMETRY LINKED</h2>
    <p style="color:#94A3B8;">Synchronizing Characters &amp; Vault with F.E.L.I.C.I.A....</p>
  </div>
  <script>
    (function() {{
      const sessionData = {tokens_json};
      try {{
        localStorage.setItem('felicia_bungie_session', JSON.stringify(sessionData));
      }} catch (e) {{}}
      if (window.opener && !window.opener.closed) {{
        try {{
          window.opener.postMessage({{ type: 'BUNGIE_AUTH_SUCCESS', session: sessionData }}, '*');
          window.close();
          return;
        }} catch (e) {{}}
      }}
      window.location.replace('/');
    }})();
  </script>
</body>
</html>"""
    return HTMLResponse(content=html)


@app.post("/api/auth/bungie/refresh")
async def bungie_refresh_endpoint(req: Request):
    body = await req.json()
    rt = body.get("refresh_token", "")
    if not rt:
        raise HTTPException(status_code=400, detail="Missing refresh_token")
    try:
        new_tokens = await run_in_threadpool(refresh_bungie_tokens, rt)
        return {"status": "ok", "session": new_tokens}
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


def _extract_bungie_tokens(req: Request) -> tuple[str, str]:
    auth_header = req.headers.get("Authorization", "")
    access_token = auth_header.replace("Bearer ", "").strip() if auth_header.startswith("Bearer ") else ""
    refresh_token = req.headers.get("X-Bungie-Refresh", "").strip()
    return access_token, refresh_token


@app.get("/api/bungie/inventory")
async def get_bungie_inventory_endpoint(req: Request):
    access_token, refresh_token = _extract_bungie_tokens(req)
    if not access_token:
        raise HTTPException(status_code=401, detail="Not signed in to Bungie.net.")

    refreshed_session = None
    try:
        data = await run_in_threadpool(fetch_guardian_inventory, access_token)
    except PermissionError:
        if refresh_token:
            try:
                refreshed_session = await run_in_threadpool(refresh_bungie_tokens, refresh_token)
                data = await run_in_threadpool(fetch_guardian_inventory, refreshed_session["access_token"])
            except Exception as re_err:
                raise HTTPException(status_code=401, detail=f"Bungie session expired. Please reconnect ({re_err}).")
        else:
            raise HTTPException(status_code=401, detail="Bungie session expired. Please reconnect your Bungie account.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Evaluate all weapons, compare duplicate God Rolls head-to-head, crown #1 winners, and mark dismantle candidates
    god_rolls = get_all_god_rolls()
    analyze_arsenal_duplicates_and_trash(data, god_rolls)

    if refreshed_session:
        data["refreshed_session"] = refreshed_session

    return data


class BungieTransferRequest(BaseModel):
    membershipType: int
    itemInstanceId: str
    itemHash: int
    sourceLocation: str
    sourceCharacterId: Optional[str] = ""
    targetType: str  # 'vault' | 'character' | 'equip'
    targetCharacterId: Optional[str] = ""
    isEquipped: Optional[bool] = False
    fallbackEquipInstanceId: Optional[str] = ""


@app.post("/api/bungie/transfer")
async def post_bungie_transfer_endpoint(body: BungieTransferRequest, req: Request):
    access_token, refresh_token = _extract_bungie_tokens(req)
    if not access_token:
        raise HTTPException(status_code=401, detail="Not signed in to Bungie.net.")

    refreshed_session = None

    def _do_transfer(token: str):
        return transfer_guardian_item(
            access_token=token,
            membership_type=body.membershipType,
            item_instance_id=body.itemInstanceId,
            item_hash=body.itemHash,
            source_location=body.sourceLocation,
            source_character_id=body.sourceCharacterId or "",
            target_type=body.targetType,
            target_character_id=body.targetCharacterId or "",
            is_equipped=bool(body.isEquipped),
            fallback_equip_instance_id=body.fallbackEquipInstanceId or "",
        )

    try:
        res = await run_in_threadpool(_do_transfer, access_token)
    except PermissionError:
        if refresh_token:
            refreshed_session = await run_in_threadpool(refresh_bungie_tokens, refresh_token)
            res = await run_in_threadpool(_do_transfer, refreshed_session["access_token"])
        else:
            raise HTTPException(status_code=401, detail="Bungie session expired. Please sign in again.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if refreshed_session:
        res["refreshed_session"] = refreshed_session
    return res


class BungieLockItemEntry(BaseModel):
    itemInstanceId: str
    characterId: Optional[str] = ""
    name: Optional[str] = ""


class BungieLockBatchRequest(BaseModel):
    membershipType: int
    defaultCharacterId: str
    items: List[BungieLockItemEntry]
    state: Optional[bool] = True


@app.post("/api/bungie/lock")
async def post_bungie_lock_endpoint(body: BungieLockBatchRequest, req: Request):
    access_token, refresh_token = _extract_bungie_tokens(req)
    if not access_token:
        raise HTTPException(status_code=401, detail="Not signed in to Bungie.net.")

    refreshed_session = None
    items_dicts = [it.model_dump() if hasattr(it, "model_dump") else it.dict() for it in body.items]

    def _do_lock(token: str):
        return batch_lock_guardian_items(
            access_token=token,
            membership_type=body.membershipType,
            default_character_id=body.defaultCharacterId,
            items_to_lock=items_dicts,
            lock_state=True if body.state is None else bool(body.state),
        )

    try:
        res = await run_in_threadpool(_do_lock, access_token)
    except PermissionError:
        if refresh_token:
            refreshed_session = await run_in_threadpool(refresh_bungie_tokens, refresh_token)
            res = await run_in_threadpool(_do_lock, refreshed_session["access_token"])
        else:
            raise HTTPException(status_code=401, detail="Bungie session expired. Please sign in again.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if refreshed_session:
        res["refreshed_session"] = refreshed_session
    return res


class BungieDismantlePrepItem(BaseModel):
    itemInstanceId: str
    itemHash: int
    sourceLocation: str
    sourceCharacterId: Optional[str] = ""
    slot: Optional[str] = "Kinetic"
    isLocked: Optional[bool] = False
    isEquipped: Optional[bool] = False
    name: Optional[str] = ""


class BungieDismantlePrepRequest(BaseModel):
    membershipType: int
    defaultCharacterId: str
    targetCharacterId: Optional[str] = ""
    unlockOnly: Optional[bool] = False
    items: List[BungieDismantlePrepItem]


@app.post("/api/bungie/dismantle-prep")
async def post_bungie_dismantle_prep_endpoint(body: BungieDismantlePrepRequest, req: Request):
    access_token, refresh_token = _extract_bungie_tokens(req)
    if not access_token:
        raise HTTPException(status_code=401, detail="Not signed in to Bungie.net.")

    refreshed_session = None
    items_dicts = [it.model_dump() if hasattr(it, "model_dump") else it.dict() for it in body.items]

    def _do_prep(token: str):
        return prepare_items_for_dismantle(
            access_token=token,
            membership_type=body.membershipType,
            default_character_id=body.defaultCharacterId,
            items_to_prep=items_dicts,
            target_character_id=body.targetCharacterId or "",
            unlock_only=bool(body.unlockOnly),
        )

    try:
        res = await run_in_threadpool(_do_prep, access_token)
    except PermissionError:
        if refresh_token:
            refreshed_session = await run_in_threadpool(refresh_bungie_tokens, refresh_token)
            res = await run_in_threadpool(_do_prep, refreshed_session["access_token"])
        else:
            raise HTTPException(status_code=401, detail="Bungie session expired. Please sign in again.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if refreshed_session:
        res["refreshed_session"] = refreshed_session
    return res


class BungieEquipLoadoutRequest(BaseModel):
    membershipType: int
    characterId: str
    loadoutIndex: int


@app.post("/api/bungie/loadout/equip")
async def post_bungie_equip_loadout_endpoint(body: BungieEquipLoadoutRequest, req: Request):
    access_token, refresh_token = _extract_bungie_tokens(req)
    if not access_token:
        raise HTTPException(status_code=401, detail="Not signed in to Bungie.net.")

    refreshed_session = None

    def _do_equip(token: str):
        return equip_guardian_loadout(
            access_token=token,
            membership_type=body.membershipType,
            character_id=body.characterId,
            loadout_index=body.loadoutIndex,
        )

    try:
        res = await run_in_threadpool(_do_equip, access_token)
    except PermissionError:
        if refresh_token:
            refreshed_session = await run_in_threadpool(refresh_bungie_tokens, refresh_token)
            res = await run_in_threadpool(_do_equip, refreshed_session["access_token"])
        else:
            raise HTTPException(status_code=401, detail="Bungie session expired. Please sign in again.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if refreshed_session:
        res["refreshed_session"] = refreshed_session
    return res


def _local_item_appraisal_fallback(item: dict, gr_eval: dict) -> str:
    name = item.get("name", "Unknown Gear")
    category = item.get("category", "Weapon")
    tier = item.get("tierName", "Legendary")
    slot = item.get("slot", "")
    type_name = item.get("typeName", "")
    element = item.get("element", "")

    if category == "Armor":
        total = item.get("totalStats", 0)
        stats_lines = [f"• **{s['name']}:** {s['value']}" for s in item.get("stats", [])]
        top_stats = sorted(item.get("stats", []), key=lambda x: x.get("value", 0), reverse=True)[:2]
        spike_desc = " & ".join(f"{s['name']} ({s['value']})" for s in top_stats) if top_stats else "Balanced"
        perks_txt = ", ".join(p["name"] for p in item.get("activePerks", [])) or "Standard Armor Frame"

        has_health_spike = any(s.get("name") == "Health" and int(s.get("value", 0)) >= 10 for s in item.get("stats", []))
        pvp_note = " *(Note: 10+ Health spikes are strictly for PVP Crucible/Trials—for PVE builds you want 0 Health and spikes in Grenade, Melee, Weapons, Super, or Class instead!)*" if has_health_spike else ""

        if item.get("isExotic"):
            verdict = "KEEP — EXOTIC ARMOR PIECE"
            advice = f"Exotic armor piece with spikes in **{spike_desc}** ({total} total base/slotted stats). Keep if those spikes align with your 100–200 stat build targets!{pvp_note}"
        elif total >= 65:
            verdict = "KEEP — HIGH-STAT PVP ARMOR (10+ HEALTH)" if has_health_spike else "KEEP — HIGH-STAT ENDGAME PVE ARMOR"
            advice = f"Strong **{total}** total roll with primary spikes in **{spike_desc}**. Excellent candidate for pushing your primary stats toward the 150–200 ceiling.{pvp_note}"
        elif total >= 60:
            verdict = "SOLID WORKHORSE PVP ARMOR" if has_health_spike else "SOLID WORKHORSE PVE ARMOR"
            advice = f"Respectable **{total}** total roll peaking in **{spike_desc}**. Worth holding onto unless you already have higher spiky set pieces.{pvp_note}"
        else:
            verdict = "SAFE TO TRASH (SHARD IT)"
            advice = f"At **{total}** total stats, this piece is below endgame standards. Unless you desperately need its set bonus right now, dismantle it for materials."

        return (
            f"Right then, Guardian. Let us inspect your **{name}** ({tier} {slot}).\n\n"
            f"**TACTICAL VERDICT:** `{verdict}`\n\n"
            f"### Stat Distribution (0–200 System)\n"
            + ("\n".join(stats_lines) if stats_lines else "• Standard stat package")
            + f"\n• **Armor Perks / Intrinsic:** {perks_txt}\n\n"
            f"### F.E.L.I.C.I.A.'s Call\n{advice}"
        )

    # Weapon fallback appraisal
    cols_summary = []
    for i, col in enumerate(item.get("perkColumns", []), 1):
        names = [f"{o['name']}{' (Selected)' if o.get('selected') else ''}" for o in col]
        cols_summary.append(f"Column {i}: {' / '.join(names)}")
    mw = (item.get("masterwork") or {}).get("name", "None")

    if item.get("isExotic"):
        return (
            f"All right, Guardian. You are holding **{name}** ({element} Exotic {type_name}).\n\n"
            f"**TACTICAL VERDICT:** `EXOTIC ARSENAL — KEEP`\n\n"
            f"• **Intrinsic:** {(item.get('frame') or {}).get('name', 'Exotic Intrinsic')}\n"
            f"• **Perks:** {', '.join(p['name'] for p in item.get('activePerks', []))}\n\n"
            f"Exotics can always be pulled from Collections or shaped at the Enclave if craftable, so keep this copy if you actively run it at **{item.get('power')} Power** or have kill-tracker progress on it!"
        )

    if gr_eval.get("in_database"):
        entry = gr_eval["entry"]
        pve = entry.get("pve", {})
        pvp = entry.get("pvp", {})
        vc = gr_eval["verdict_code"]
        label_map = {
            "DUAL_GOD_ROLL": "S-TIER PVE & PVP GOD ROLL — LOCK IT NOW!",
            "PVE_GOD_ROLL": "S-TIER PVE GOD ROLL — LOCK & KEEP!",
            "PVP_GOD_ROLL": "S-TIER PVP GOD ROLL — CRUCIBLE MONSTER!",
            "SOLID_KEEP": "SOLID ROLL (1/2 GOD ROLL TRAITS) — KEEP UNTIL UPGRADED",
            "SHARD_CANDIDATE": "SAFE TO TRASH — MISSES CLAN GOD ROLL TRAITS",
        }
        headline = label_map.get(vc, "EVALUATED ROLL")
        return (
            f"Right then, Guardian. I cross-checked your **{name}** directly against our **Clan God Roll Finder** archives.\n\n"
            f"**TACTICAL VERDICT:** `{headline}`\n\n"
            f"### Your Rolled Perks\n• " + "\n• ".join(cols_summary) + f"\n• **Masterwork:** {mw}\n\n"
            f"### ⚔️ PVE Assessment ({gr_eval['pve_trait_hits']}/2 Core Traits Matched)\n"
            f"• **Clan PVE Target:** {pve.get('perk1')} + {pve.get('perk2')} ({pve.get('barrel')} / {pve.get('mag')})\n"
            f"• **Matched on Yours:** {', '.join(gr_eval['pve_matches']) if gr_eval['pve_matches'] else 'None of the primary PVE traits matched.'}\n"
            f"• **Intel:** {pve.get('notes', '')}\n\n"
            f"### 🎯 PVP Assessment ({gr_eval['pvp_trait_hits']}/2 Core Traits Matched)\n"
            f"• **Clan PVP Target:** {pvp.get('perk1')} + {pvp.get('perk2')} ({pvp.get('barrel')} / {pvp.get('mag')})\n"
            f"• **Matched on Yours:** {', '.join(gr_eval['pvp_matches']) if gr_eval['pvp_matches'] else 'None of the primary PVP traits matched.'}\n"
            f"• **Intel:** {pvp.get('notes', '')}\n\n"
            f"### 🛡️ Final Call\n"
            + (
                "Lock this weapon immediately in Destiny 2—spot on roll, Guardian!"
                if vc in ("DUAL_GOD_ROLL", "PVE_GOD_ROLL", "PVP_GOD_ROLL")
                else (
                    "Decent transitional roll with one top-tier trait. Keep it if you don't have a better copy yet, otherwise keep farming."
                    if vc == "SOLID_KEEP"
                    else "Let us be realistic here—neither column hits what makes this gun shine in PVE or PVP. Safe to dismantle!"
                )
            )
        )

    # Generic elite Destiny perk heuristic when weapon isn't in God Roll Finder yet
    elite_pve = {"incandescent", "voltshot", "destabilizingrounds", "headstone", "hatchling", "kineticdtremors", "kinetictremors", "baitandswitch", "enviousassassin", "reconstruction", "explosivepayload", "frenzy", "firefly", "repulsorbrace", "healclip", "subsistence", "rewindrounds", "chillclip", "eageredge", "whirlwindblade", "surrounded", "oneforall", "statsforall", "leadfromgold", "autoloadingholster", "demolitionist"}
    elite_pvp = {"openingshot", "slideshot", "lonewolf", "keepaway", "eyeofthestorm", "precisioninstrument", "zenmoment", "headseeker", "killclip", "desperado", "rapidhit", "perpetualmotion", "dynamicsswayreduction", "dynamicswayreduction", "tapthetrigger", "targetlock", "movingtarget", "rangefinder", "closingtime"}

    rolled_norms = set()
    for col in item.get("perkColumns", []):
        for o in col:
            rolled_norms.add(re.sub(r"[^a-z0-9]", "", o.get("name", "").lower().replace("enhanced ", "")))

    pve_hits = [p for p in rolled_norms if p in elite_pve]
    pvp_hits = [p for p in rolled_norms if p in elite_pvp]

    if len(pve_hits) >= 2:
        verdict = "STRONG PVE SYNERGY — KEEP!"
    elif len(pvp_hits) >= 2:
        verdict = "STRONG PVP DUELIST — KEEP!"
    elif pve_hits or pvp_hits:
        verdict = "DECENT UTILITY ROLL — SITUATIONAL KEEP"
    else:
        verdict = "UNDERWHELMING ROLL — SAFE TO TRASH"

    return (
        f"All right, Guardian. **{name}** ({element} {type_name}) isn't manually logged in our Clan God Roll Finder yet, so I have run a direct perk telemetry scan on your roll:\n\n"
        f"**TACTICAL VERDICT:** `{verdict}`\n\n"
        f"### Rolled Perks\n• " + ("\n• ".join(cols_summary) if cols_summary else "Fixed / Standard Perks") + f"\n• **Masterwork:** {mw}\n\n"
        f"• **⚔️ PVE Outlook:** {'Strong endgame perk presence detected!' if pve_hits else 'Lacks top-tier reload/damage/verb perks for endgame PVE.'}\n"
        f"• **🎯 PVP Outlook:** {'Has competitive Crucible consistency/dueling traits!' if pvp_hits else 'Lacks premier Crucible dueling or range-pushing perks.'}\n"
    )


@app.post("/api/bungie/appraise")
async def appraise_bungie_item_endpoint(req: Request):
    body = await req.json()
    item = body.get("item")
    if not item:
        raise HTTPException(status_code=400, detail="Missing item payload.")

    god_rolls = get_all_god_rolls()
    gr_eval = evaluate_item_against_godrolls(item, god_rolls) if item.get("category") == "Weapon" else {"in_database": False, "verdict_code": "ARMOR"}

    # Build detailed item telemetry for Gemini
    cols_text = []
    for idx, col in enumerate(item.get("perkColumns", []), 1):
        opts = [f"{o.get('name')}{' [ACTIVE]' if o.get('selected') else ' [SELECTABLE]'}" for o in col]
        cols_text.append(f"  - Column {idx}: {' | '.join(opts)}")

    stats_text = ", ".join(f"{s['name']}: {s['value']}" for s in item.get("stats", []))
    mw_name = (item.get("masterwork") or {}).get("name", "None")
    frame_name = (item.get("frame") or {}).get("name", "Standard")
    frame_desc = (item.get("frame") or {}).get("description", "")

    db_section = ""
    if gr_eval.get("in_database") and gr_eval.get("entry"):
        e = gr_eval["entry"]
        pve = e.get("pve", {})
        pvp = e.get("pvp", {})
        db_section = (
            f"\n★ CLAN GOD ROLL FINDER DATABASE MATCH FOUND FOR {e.get('name')}:\n"
            f"- Automated Trait Match Score: PVE = {gr_eval['pve_trait_hits']}/2 core traits ({', '.join(gr_eval['pve_matches']) or 'None'}), "
            f"PVP = {gr_eval['pvp_trait_hits']}/2 core traits ({', '.join(gr_eval['pvp_matches']) or 'None'})\n"
            f"- Verified Clan PVE God Roll: Barrel={pve.get('barrel')}, Mag={pve.get('mag')}, Perk 1={pve.get('perk1')}, Perk 2={pve.get('perk2')}, MW={pve.get('masterwork')}. Notes: {pve.get('notes')}\n"
            f"- Verified Clan PVP God Roll: Barrel={pvp.get('barrel')}, Mag={pvp.get('mag')}, Perk 1={pvp.get('perk1')}, Perk 2={pvp.get('perk2')}, MW={pvp.get('masterwork')}. Notes: {pvp.get('notes')}\n"
            f"IMPORTANT: Judge this weapon directly against our Clan God Roll Finder entry above! Note if a god-roll perk is sitting [SELECTABLE] in a multi-perk column so the Guardian knows to click it!\n"
        )

    dup_note = ""
    client_grc = item.get("godRollCheck") or {}
    if client_grc.get("isOutclassedDuplicate") and client_grc.get("comparisonSummary"):
        dup_note = (
            f"\n⚠ DUPLICATE COMPARISON ALERT: The Guardian owns MULTIPLE God Roll copies of {item.get('name')}! "
            f"Status of THIS copy: {client_grc.get('comparisonSummary')}. "
            f"Explicitly let them know that while this roll has strong perks, they already own a higher-rated #1 copy, making this duplicate safe to dismantle!\n"
        )
    elif client_grc.get("isBestGodRoll") and (client_grc.get("familyGodRollCount") or 0) > 1 and client_grc.get("comparisonSummary"):
        dup_note = (
            f"\n👑 DUPLICATE WINNER ALERT: The Guardian owns {client_grc.get('familyGodRollCount')} God Roll copies of {item.get('name')}, "
            f"and THIS copy is their #1 BEST ({client_grc.get('comparisonSummary')}). Tell them to lock THIS copy and dismantle the weaker duplicates!\n"
        )

    compendium_item_section = build_item_compendium_context(item)

    prompt = (
        f"GUARDIAN LIVE INVENTORY ITEM INSPECTION REQUEST ('Ask F.E.L.I.C.I.A.'):\n"
        f"• Item Name: {item.get('name')}\n"
        f"• Category: {item.get('tierName')} {item.get('element')} {item.get('typeName')} ({item.get('slot')} Slot)\n"
        f"• Power Level: {item.get('power')}\n"
        f"• Intrinsic / Frame: {frame_name} ({frame_desc})\n"
        f"• Masterwork: {mw_name} | Crafted: {item.get('isCrafted')} | Masterworked: {item.get('isMasterworked')}\n"
        f"• Stats: {stats_text}" + (f" (Total Armor Stats: {item.get('totalStats')})" if item.get("category") == "Armor" else "") + "\n"
        f"• Rolled Sockets / Perks:\n" + ("\n".join(cols_text) if cols_text else "  - Fixed / Intrinsic") + "\n"
        f"{db_section}{compendium_item_section}{dup_note}\n"
        f"TASK FOR F.E.L.I.C.I.A.:\n"
        f"Give a concise, high-impact Destiny 2 roll review in your grounded Scottish Vanguard voice:\n"
        f"1. **Verdict Header:** State clearly right away whether this roll is a **GOD ROLL (KEEP & LOCK)**, **SOLID KEEP**, or **TRASH / SAFE TO SHARD**.\n"
        f"2. **⚔️ PVE Breakdown:** How good is this specific roll (and its 2-Piece / 4-Piece Armor Set Bonus or Exotic perk if Armor!) for Grandmasters, Raids, Dungeons, or Ad Clear/Boss DPS?\n"
        f"3. **🎯 PVP Breakdown:** How good is this specific roll for Crucible / Trials of Osiris?\n"
        f"4. **Final Recommendation:** If multi-perk columns have a better selectable option, tell them which perks to select; otherwise tell them cleanly to lock it or shard it! (If inspecting Armor: remember only Health spikes of 10+ are valuable for PVP—for PVE builds, prioritize 0 Health and spikes in Grenade, Melee, Weapons, Super, and Class, NEVER Health! Armor with <10 Health is for PvE, not PvP!) Remember: NEVER use old stat names in parentheses—only Health, Melee, Grenade, Super, Class, Weapons on the 0-200 scale."
    )

    ai_reply = await run_in_threadpool(query_gemini_api, prompt, [], FELICIA_SYSTEM_PROMPT)
    if ai_reply.startswith("ERROR_FALLBACK"):
        ai_reply = _local_item_appraisal_fallback(item, gr_eval)

    return {
        "reply": ai_reply,
        "godRollMatch": {
            "inDatabase": gr_eval.get("in_database", False),
            "verdictCode": gr_eval.get("verdict_code", "AI_EVAL"),
            "pveTraitHits": gr_eval.get("pve_trait_hits", 0),
            "pvpTraitHits": gr_eval.get("pvp_trait_hits", 0),
            "pveMatches": gr_eval.get("pve_matches", []),
            "pvpMatches": gr_eval.get("pvp_matches", []),
        },
    }


# Mount frontend directory for static assets
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
