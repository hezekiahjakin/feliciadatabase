import os
import re
import json
import time
import base64
import shutil
import zipfile
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Any, Set, Tuple
import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

BUNGIE_SECRETS_PATH = os.path.join(DATA_DIR, "bungie_secrets.json")
MANIFEST_DB_PATH = os.path.join(DATA_DIR, "bungie_manifest.sqlite")
MANIFEST_META_PATH = os.path.join(DATA_DIR, "bungie_manifest_meta.json")

BUNGIE_API_BASE = "https://www.bungie.net/Platform"
BUNGIE_OAUTH_AUTHORIZE = "https://www.bungie.net/en/OAuth/Authorize"
BUNGIE_OAUTH_TOKEN = "https://www.bungie.net/Platform/App/OAuth/token/"

# Known Destiny 2 Bucket Hashes
BUCKET_KINETIC = 1498876634
BUCKET_ENERGY = 2465295065
BUCKET_POWER = 953998645
BUCKET_HELMET = 3448274439
BUCKET_GAUNTLETS = 3551918588
BUCKET_CHEST = 14239492
BUCKET_LEGS = 20886954
BUCKET_CLASS_ITEM = 1585787867
BUCKET_SUBCLASS = 3284755031
BUCKET_VAULT_GENERAL = 138197802
BUCKET_POSTMASTER = 215593132

WEAPON_BUCKETS = {
    BUCKET_KINETIC: "Kinetic",
    BUCKET_ENERGY: "Energy",
    BUCKET_POWER: "Heavy",
}

ARMOR_BUCKETS = {
    BUCKET_HELMET: "Helmet",
    BUCKET_GAUNTLETS: "Gauntlets",
    BUCKET_CHEST: "Chest Armor",
    BUCKET_LEGS: "Leg Armor",
    BUCKET_CLASS_ITEM: "Class Armor",
}

ALL_GEAR_BUCKETS = {**WEAPON_BUCKETS, **ARMOR_BUCKETS}

DAMAGE_TYPE_MAP = {
    0: "Kinetic",
    1: "Kinetic",
    2: "Arc",
    3: "Solar",
    4: "Void",
    5: "Kinetic",
    6: "Stasis",
    7: "Strand",
}

CLASS_TYPE_MAP = {
    0: "Titan",
    1: "Hunter",
    2: "Warlock",
    3: "Any",
}

PLATFORM_NAMES = {
    1: "Xbox",
    2: "PlayStation",
    3: "Steam",
    4: "Blizzard",
    5: "Stadia",
    6: "Epic Games",
    10: "Demon",
    254: "BungieNext",
}

# Socket Category Hashes from DestinySocketCategoryDefinition
SOCKET_CAT_INTRINSIC = 3956125808
SOCKET_CAT_WEAPON_PERKS = {4241085061, 3410521964}
SOCKET_CAT_WEAPON_MODS = 2685412949
SOCKET_CAT_ARMOR_PERKS = {2518356196, 3154740035}
SOCKET_CAT_ARMOR_MODS = 590099826

# Modern 6-Stat Hashes + Weapon Stat Hashes
ARMOR_STAT_ORDER = [
    (392767087, "Health"),
    (4244567218, "Melee"),
    (1735777505, "Grenade"),
    (144602215, "Super"),
    (1943323491, "Class"),
    (2996146975, "Weapons"),
]

WEAPON_STAT_ORDER = [
    (4043523819, "Impact"),
    (1240592695, "Range"),
    (155624089, "Stability"),
    (943549884, "Handling"),
    (4188031367, "Reload Speed"),
    (3614673599, "Blast Radius"),
    (2523465841, "Velocity"),
    (1345609583, "Aim Assistance"),
    (2715839340, "Recoil Direction"),
    (4284893193, "RPM"),
    (2961396640, "Charge Time"),
    (447667954, "Draw Time"),
    (3871231066, "Magazine"),
]

_manifest_lock = threading.Lock()
_item_mem_cache: Dict[int, dict] = {}
_loadout_defs_cache: Dict[str, Dict[int, str]] = {}
_recent_code_cache: Dict[str, Tuple[float, dict]] = {}

# Built-in server fallback credentials (obfuscated) so every clan member & device works automatically out of the box
_ORBITAL_MASK = b"FELICIA_VANGUARD_ORBITAL_KEY_2026"
_DEFAULT_AK_ENC = "JCN4eXssczwzJCxzYXYxdGd2ayd4ZCMqbC93O20KCFc="
_DEFAULT_CS_ENC = "CHE6Owo7dy5hMHgyDSwdMxYDH3FxHXR1aXMXb3JkAUNCJBYBIXs7C20FIg=="


def _decode_orbital(b64_val: str) -> str:
    try:
        xored = base64.b64decode(b64_val.encode("ascii"))
        raw = bytes(b ^ _ORBITAL_MASK[i % len(_ORBITAL_MASK)] for i, b in enumerate(xored))
        return raw.decode("utf-8")
    except Exception:
        return ""


def _to_sqlite_id(uint_hash: int) -> int:
    h = int(uint_hash) & 0xFFFFFFFF
    return h - 4294967296 if h >= 2147483648 else h


def _from_sqlite_id(sint_id: int) -> int:
    return sint_id + 4294967296 if sint_id < 0 else sint_id


def get_bungie_credentials() -> Dict[str, str]:
    saved = {}
    if os.path.exists(BUNGIE_SECRETS_PATH):
        try:
            with open(BUNGIE_SECRETS_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
        except Exception:
            saved = {}

    api_key = os.environ.get("BUNGIE_API_KEY") or saved.get("bungie_api_key") or _decode_orbital(_DEFAULT_AK_ENC)
    client_id = os.environ.get("BUNGIE_CLIENT_ID") or saved.get("bungie_client_id") or "56157"
    client_secret = os.environ.get("BUNGIE_CLIENT_SECRET") or saved.get("bungie_client_secret") or _decode_orbital(_DEFAULT_CS_ENC)

    return {
        "api_key": api_key.strip(),
        "client_id": str(client_id).strip(),
        "client_secret": client_secret.strip(),
    }


def save_bungie_credentials(api_key: str = "", client_id: str = "", client_secret: str = "") -> Dict[str, str]:
    current = get_bungie_credentials()
    updated = {
        "bungie_api_key": api_key.strip() if api_key.strip() else current["api_key"],
        "bungie_client_id": client_id.strip() if client_id.strip() else (current["client_id"] or "56157"),
        "bungie_client_secret": client_secret.strip() if client_secret.strip() else current["client_secret"],
    }
    with open(BUNGIE_SECRETS_PATH, "w", encoding="utf-8") as f:
        json.dump(updated, f, indent=2)
    return get_bungie_credentials()


def build_authorize_url(state_token: str = "") -> str:
    creds = get_bungie_credentials()
    client_id = creds["client_id"] or "56157"
    url = f"{BUNGIE_OAUTH_AUTHORIZE}?client_id={client_id}&response_type=code"
    if state_token:
        url += f"&state={requests.utils.quote(state_token)}"
    return url


def exchange_code_for_tokens(code: str) -> dict:
    # Guard against mobile/in-app browsers double-fetching the single-use OAuth callback URL
    now_f = time.time()
    cached = _recent_code_cache.get(code)
    if cached and (now_f - cached[0] < 60):
        return cached[1]

    creds = get_bungie_credentials()
    if not creds["client_id"]:
        raise ValueError("Bungie OAuth Client ID is not configured.")

    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
    }
    if creds["api_key"]:
        headers["X-API-Key"] = creds["api_key"]

    if creds["client_secret"]:
        raw_basic = f"{creds['client_id']}:{creds['client_secret']}".encode("utf-8")
        headers["Authorization"] = "Basic " + base64.b64encode(raw_basic).decode("ascii")

    data = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": creds["client_id"],
    }

    resp = requests.post(BUNGIE_OAUTH_TOKEN, headers=headers, data=data, timeout=15)
    if resp.status_code != 200:
        raise RuntimeError(f"Bungie token exchange failed (HTTP {resp.status_code}): {resp.text[:300]}")

    tok = resp.json()
    now = int(time.time())
    session_obj = {
        "access_token": tok.get("access_token"),
        "token_type": tok.get("token_type", "Bearer"),
        "expires_in": tok.get("expires_in", 3600),
        "expires_at": now + int(tok.get("expires_in", 3600)) - 60,
        "refresh_token": tok.get("refresh_token", ""),
        "refresh_expires_in": tok.get("refresh_expires_in", 0),
        "refresh_expires_at": (now + int(tok.get("refresh_expires_in", 0)) - 60) if tok.get("refresh_token") else 0,
        "membership_id": str(tok.get("membership_id", "")),
    }
    # Prune old cache entries and store current
    for k in list(_recent_code_cache.keys()):
        if now_f - _recent_code_cache[k][0] >= 60:
            _recent_code_cache.pop(k, None)
    _recent_code_cache[code] = (now_f, session_obj)
    return session_obj


def refresh_bungie_tokens(refresh_token: str) -> dict:
    creds = get_bungie_credentials()
    if not refresh_token or not creds["client_secret"]:
        raise RuntimeError("Refresh token or Bungie Client Secret unavailable; please re-authenticate.")

    raw_basic = f"{creds['client_id']}:{creds['client_secret']}".encode("utf-8")
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + base64.b64encode(raw_basic).decode("ascii"),
    }
    if creds["api_key"]:
        headers["X-API-Key"] = creds["api_key"]

    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": creds["client_id"],
    }

    resp = requests.post(BUNGIE_OAUTH_TOKEN, headers=headers, data=data, timeout=15)
    if resp.status_code != 200:
        raise RuntimeError(f"Token refresh failed (HTTP {resp.status_code}): {resp.text[:250]}")

    tok = resp.json()
    now = int(time.time())
    return {
        "access_token": tok.get("access_token"),
        "token_type": tok.get("token_type", "Bearer"),
        "expires_in": tok.get("expires_in", 3600),
        "expires_at": now + int(tok.get("expires_in", 3600)) - 60,
        "refresh_token": tok.get("refresh_token", refresh_token),
        "refresh_expires_in": tok.get("refresh_expires_in", 7776000),
        "refresh_expires_at": now + int(tok.get("refresh_expires_in", 7776000)) - 60,
        "membership_id": str(tok.get("membership_id", "")),
    }


def ensure_manifest_db(api_key: str) -> str:
    """Ensures the Destiny 2 SQLite Manifest is downloaded locally using low-memory chunked streaming."""
    if os.path.exists(MANIFEST_DB_PATH) and os.path.getsize(MANIFEST_DB_PATH) > 10_000_000:
        # Refresh check at most once every 24h
        try:
            if time.time() - os.path.getmtime(MANIFEST_DB_PATH) < 86400:
                return MANIFEST_DB_PATH
        except Exception:
            return MANIFEST_DB_PATH

    with _manifest_lock:
        if os.path.exists(MANIFEST_DB_PATH) and os.path.getsize(MANIFEST_DB_PATH) > 10_000_000:
            if time.time() - os.path.getmtime(MANIFEST_DB_PATH) < 86400:
                return MANIFEST_DB_PATH

        headers = {"X-API-Key": api_key} if api_key else {}
        r = requests.get(f"{BUNGIE_API_BASE}/Destiny2/Manifest/", headers=headers, timeout=15)
        r.raise_for_status()
        manifest_info = r.json().get("Response", {})
        sqlite_rel_path = manifest_info.get("mobileWorldContentPaths", {}).get("en", "")
        if not sqlite_rel_path:
            raise RuntimeError("Bungie Manifest missing English SQLite path.")

        # Check if version already matches
        if os.path.exists(MANIFEST_META_PATH) and os.path.exists(MANIFEST_DB_PATH):
            try:
                with open(MANIFEST_META_PATH, "r", encoding="utf-8") as mf:
                    meta = json.load(mf)
                if meta.get("sqlite_path") == sqlite_rel_path and os.path.getsize(MANIFEST_DB_PATH) > 10_000_000:
                    os.utime(MANIFEST_DB_PATH, None)
                    return MANIFEST_DB_PATH
            except Exception:
                pass

        zip_tmp = os.path.join(DATA_DIR, "manifest_download.zip")
        db_tmp = os.path.join(DATA_DIR, "bungie_manifest_tmp.sqlite")

        with requests.get(f"https://www.bungie.net{sqlite_rel_path}", stream=True, timeout=45) as dl:
            dl.raise_for_status()
            with open(zip_tmp, "wb") as f_out:
                shutil.copyfileobj(dl.raw, f_out, length=1024 * 1024)

        with zipfile.ZipFile(zip_tmp, "r") as zf:
            inner_name = zf.namelist()[0]
            with zf.open(inner_name) as z_in, open(db_tmp, "wb") as db_out:
                shutil.copyfileobj(z_in, db_out, length=1024 * 1024)

        try:
            os.remove(zip_tmp)
        except Exception:
            pass

        os.replace(db_tmp, MANIFEST_DB_PATH)
        with open(MANIFEST_META_PATH, "w", encoding="utf-8") as mf:
            json.dump({"sqlite_path": sqlite_rel_path, "updated_at": int(time.time())}, mf)

        _item_mem_cache.clear()
        _loadout_defs_cache.clear()
        return MANIFEST_DB_PATH


def _slim_item_def(raw: dict) -> dict:
    """Extracts only the lightweight fields needed for inventory, sockets, perks, and stats."""
    dp = raw.get("displayProperties", {})
    inv = raw.get("inventory", {})
    plug = raw.get("plug", {})
    sockets_raw = raw.get("sockets", {})

    socket_cats = []
    for sc in sockets_raw.get("socketCategories", []):
        socket_cats.append({
            "hash": sc.get("socketCategoryHash"),
            "indexes": sc.get("socketIndexes", []),
        })

    return {
        "hash": raw.get("hash"),
        "name": dp.get("name", ""),
        "description": dp.get("description", ""),
        "icon": dp.get("icon", ""),
        "hasIcon": dp.get("hasIcon", False),
        "watermark": raw.get("iconWatermark") or raw.get("iconWatermarkShelved") or "",
        "screenshot": raw.get("screenshot", ""),
        "itemType": raw.get("itemType", 0),
        "itemSubType": raw.get("itemSubType", 0),
        "itemTypeDisplayName": raw.get("itemTypeDisplayName", ""),
        "classType": raw.get("classType", 3),
        "defaultDamageType": raw.get("defaultDamageType", 0),
        "bucketTypeHash": inv.get("bucketTypeHash", 0),
        "tierTypeName": inv.get("tierTypeName", ""),
        "tierType": inv.get("tierType", 0),
        "isInstanceItem": inv.get("isInstanceItem", False),
        "plugCategoryIdentifier": plug.get("plugCategoryIdentifier", "") if plug else "",
        "socketCategories": socket_cats,
    }


def resolve_item_definitions(hashes: Set[int], api_key: str) -> Dict[int, dict]:
    if not hashes:
        return {}

    result: Dict[int, dict] = {}
    missing: List[int] = []
    for h in hashes:
        if not h:
            continue
        uh = int(h) & 0xFFFFFFFF
        if uh in _item_mem_cache:
            result[uh] = _item_mem_cache[uh]
        else:
            missing.append(uh)

    if not missing:
        return result

    db_path = ensure_manifest_db(api_key)
    conn = sqlite3.connect(db_path)
    try:
        # Query in chunks of 500 to stay well below SQLite parameter limits
        for i in range(0, len(missing), 500):
            chunk = missing[i : i + 500]
            sids = [_to_sqlite_id(uh) for uh in chunk]
            placeholders = ",".join("?" for _ in sids)
            rows = conn.execute(
                f"SELECT id, json FROM DestinyInventoryItemDefinition WHERE id IN ({placeholders})",
                sids,
            ).fetchall()
            for sid, raw_json in rows:
                uh = _from_sqlite_id(sid)
                slim = _slim_item_def(json.loads(raw_json))
                if len(_item_mem_cache) < 6000:
                    _item_mem_cache[uh] = slim
                result[uh] = slim
    finally:
        conn.close()

    return result


def resolve_loadout_definitions(api_key: str) -> Dict[str, Dict[int, str]]:
    """Loads & caches Destiny 2 Loadout Name, Icon, and Color manifest tables (~65 rows total)."""
    if _loadout_defs_cache.get("names"):
        return _loadout_defs_cache

    db_path = ensure_manifest_db(api_key)
    names_map: Dict[int, str] = {}
    icons_map: Dict[int, str] = {}
    colors_map: Dict[int, str] = {}

    conn = sqlite3.connect(db_path)
    try:
        for sid, raw_json in conn.execute("SELECT id, json FROM DestinyLoadoutNameDefinition").fetchall():
            uh = _from_sqlite_id(sid)
            obj = json.loads(raw_json)
            if obj.get("name"):
                names_map[uh] = obj["name"]

        for sid, raw_json in conn.execute("SELECT id, json FROM DestinyLoadoutIconDefinition").fetchall():
            uh = _from_sqlite_id(sid)
            obj = json.loads(raw_json)
            if obj.get("iconImagePath"):
                icons_map[uh] = obj["iconImagePath"]

        for sid, raw_json in conn.execute("SELECT id, json FROM DestinyLoadoutColorDefinition").fetchall():
            uh = _from_sqlite_id(sid)
            obj = json.loads(raw_json)
            if obj.get("colorImagePath"):
                colors_map[uh] = obj["colorImagePath"]
    except Exception:
        pass
    finally:
        conn.close()

    _loadout_defs_cache["names"] = names_map
    _loadout_defs_cache["icons"] = icons_map
    _loadout_defs_cache["colors"] = colors_map
    return _loadout_defs_cache


def _bungie_get(path: str, api_key: str, access_token: str = "") -> dict:
    headers = {"X-API-Key": api_key}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    resp = requests.get(f"{BUNGIE_API_BASE}{path}", headers=headers, timeout=20)
    if resp.status_code == 401:
        raise PermissionError("BUNGIE_TOKEN_EXPIRED")
    data = resp.json()
    if data.get("ErrorCode", 1) != 1:
        raise RuntimeError(f"Bungie API Error ({data.get('ErrorStatus')}): {data.get('Message')}")
    return data.get("Response", {})


def _bungie_post(path: str, payload: dict, api_key: str, access_token: str) -> dict:
    headers = {
        "X-API-Key": api_key,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    resp = requests.post(f"{BUNGIE_API_BASE}{path}", headers=headers, json=payload, timeout=20)
    if resp.status_code == 401:
        raise PermissionError("BUNGIE_TOKEN_EXPIRED")
    data = resp.json()
    if data.get("ErrorCode", 1) != 1:
        raise RuntimeError(f"{data.get('Message', 'Bungie transfer error')} ({data.get('ErrorStatus')})")
    return data.get("Response", {})


def get_active_destiny_membership(api_key: str, access_token: str) -> dict:
    mem_data = _bungie_get("/User/GetMembershipsForCurrentUser/", api_key, access_token)
    memberships = mem_data.get("destinyMemberships", [])
    if not memberships:
        raise RuntimeError("No Destiny 2 characters/accounts found linked to this Bungie.net profile.")

    primary_id = str(mem_data.get("primaryMembershipId", ""))
    chosen = None
    if primary_id:
        chosen = next((m for m in memberships if str(m.get("membershipId")) == primary_id), None)
    if not chosen:
        chosen = next((m for m in memberships if len(m.get("applicableMembershipTypes", [])) > 0), None)
    if not chosen:
        chosen = memberships[0]

    bnet_user = mem_data.get("bungieNetUser", {})
    global_name = chosen.get("bungieGlobalDisplayName") or bnet_user.get("uniqueName") or chosen.get("displayName") or "Guardian"
    global_code = chosen.get("bungieGlobalDisplayNameCode")
    full_name = f"{global_name}#{global_code:04d}" if isinstance(global_code, int) else str(global_name)

    return {
        "membershipType": int(chosen["membershipType"]),
        "destinyMembershipId": str(chosen["membershipId"]),
        "displayName": global_name,
        "fullBungieName": full_name,
        "platformName": PLATFORM_NAMES.get(int(chosen["membershipType"]), "Destiny 2"),
        "avatar": bnet_user.get("profilePicturePath", ""),
    }


def _enrich_item(
    raw_item: dict,
    defs: Dict[int, dict],
    instances: dict,
    stats_map: dict,
    sockets_map: dict,
    reusable_map: dict,
    location: str,
    owner_char_id: str = "",
    is_equipped: bool = False,
) -> Optional[dict]:
    item_hash = int(raw_item.get("itemHash", 0))
    d = defs.get(item_hash)
    if not d:
        return None

    item_type = d.get("itemType", 0)
    # 3 = Weapon, 2 = Armor
    if item_type not in (2, 3):
        return None

    equip_bucket = int(d.get("bucketTypeHash", 0))
    if equip_bucket not in ALL_GEAR_BUCKETS:
        return None

    instance_id = str(raw_item.get("itemInstanceId", ""))
    inst = instances.get(instance_id, {}) if instance_id else {}
    state_bits = int(raw_item.get("state", 0))

    dmg_enum = inst.get("damageType") or d.get("defaultDamageType") or 1
    element = DAMAGE_TYPE_MAP.get(int(dmg_enum), "Kinetic")
    power = inst.get("primaryStat", {}).get("value", 0)

    category = "Weapon" if item_type == 3 else "Armor"
    slot_name = ALL_GEAR_BUCKETS.get(equip_bucket, "Gear")
    tier_name = d.get("tierTypeName", "Legendary")

    # Parse sockets (Intrinsic frame, Perks, Masterwork, Mods)
    frame_info = None
    perk_columns: List[List[dict]] = []
    trait_col_indexes: List[int] = []
    active_perks: List[dict] = []
    masterwork_info = None
    mods_list: List[dict] = []

    item_sockets = sockets_map.get(instance_id, {}).get("sockets", []) if instance_id else []
    item_reusable = reusable_map.get(instance_id, {}).get("plugs", {}) if instance_id else {}

    if item_sockets and d.get("socketCategories"):
        for sc in d["socketCategories"]:
            sc_hash = sc["hash"]
            indexes = sc["indexes"]

            if sc_hash == SOCKET_CAT_INTRINSIC:
                for idx in indexes:
                    if idx < len(item_sockets):
                        ph = item_sockets[idx].get("plugHash")
                        pdef = defs.get(int(ph)) if ph else None
                        if pdef and pdef.get("name"):
                            frame_info = {
                                "name": pdef["name"],
                                "description": pdef.get("description", ""),
                                "icon": pdef.get("icon", ""),
                            }
                            break

            elif sc_hash in SOCKET_CAT_WEAPON_PERKS or sc_hash in SOCKET_CAT_ARMOR_PERKS:
                for idx in indexes:
                    if idx >= len(item_sockets):
                        continue
                    sock = item_sockets[idx]
                    active_hash = sock.get("plugHash")
                    active_def = defs.get(int(active_hash)) if active_hash else None
                    if not active_def or not active_def.get("name"):
                        continue

                    pcat = active_def.get("plugCategoryIdentifier", "").lower()
                    pname_low = active_def["name"].lower()
                    if "tracker" in pcat or "memento" in pcat or "empty" in pname_low or "default ornament" in pname_low:
                        continue
                    if sc_hash in SOCKET_CAT_ARMOR_PERKS and ("stat." in pcat or "tier" in pcat or "upgrade" in pname_low):
                        continue

                    col_options: List[dict] = []
                    reusable_list = item_reusable.get(str(idx), [])
                    seen_names = set()
                    if reusable_list:
                        for rp in reusable_list:
                            rph = rp.get("plugItemHash")
                            rpdef = defs.get(int(rph)) if rph else None
                            if rpdef and rpdef.get("name") and rpdef["name"] not in seen_names:
                                seen_names.add(rpdef["name"])
                                col_options.append({
                                    "name": rpdef["name"],
                                    "description": rpdef.get("description", ""),
                                    "icon": rpdef.get("icon", ""),
                                    "selected": int(rph) == int(active_hash),
                                    "enhanced": "enhanced" in rpdef.get("tierTypeName", "").lower() or "enhanced" in rpdef.get("plugCategoryIdentifier", "").lower(),
                                })

                    if not col_options:
                        col_options.append({
                            "name": active_def["name"],
                            "description": active_def.get("description", ""),
                            "icon": active_def.get("icon", ""),
                            "selected": True,
                            "enhanced": "enhanced" in active_def.get("tierTypeName", "").lower(),
                        })

                    col_idx_now = len(perk_columns)
                    perk_columns.append(col_options)
                    if sc_hash in SOCKET_CAT_WEAPON_PERKS and "frames" in pcat and "origin" not in pcat:
                        trait_col_indexes.append(col_idx_now)
                    active_perks.append({
                        "name": active_def["name"],
                        "description": active_def.get("description", ""),
                        "icon": active_def.get("icon", ""),
                    })

            elif sc_hash in (SOCKET_CAT_WEAPON_MODS, SOCKET_CAT_ARMOR_MODS):
                for idx in indexes:
                    if idx >= len(item_sockets):
                        continue
                    ph = item_sockets[idx].get("plugHash")
                    pdef = defs.get(int(ph)) if ph else None
                    if not pdef or not pdef.get("name"):
                        continue
                    pcat = pdef.get("plugCategoryIdentifier", "").lower()
                    pname = pdef["name"]
                    if "masterworks.stat" in pcat or "masterwork" in pname.lower():
                        # Clean e.g. 'Tier 10: Range' or 'Masterworked: Range'
                        mw_clean = pname.replace("Masterworked:", "").strip()
                        masterwork_info = {
                            "name": mw_clean,
                            "description": pdef.get("description", ""),
                            "icon": pdef.get("icon", ""),
                        }
                    elif "empty" not in pname.lower() and "default" not in pname.lower() and "tracker" not in pcat:
                        mods_list.append({
                            "name": pname,
                            "icon": pdef.get("icon", ""),
                        })

    # Parse Item Stats
    raw_stats = stats_map.get(instance_id, {}).get("stats", {}) if instance_id else {}
    ordered_stats: List[dict] = []
    stat_template = WEAPON_STAT_ORDER if category == "Weapon" else ARMOR_STAT_ORDER
    total_armor_stats = 0

    for shash, sname in stat_template:
        s_obj = raw_stats.get(str(shash))
        if s_obj and "value" in s_obj:
            val = int(s_obj["value"])
            ordered_stats.append({"name": sname, "value": val})
            if category == "Armor":
                total_armor_stats += val

    return {
        "itemInstanceId": instance_id,
        "itemHash": item_hash,
        "name": d["name"],
        "icon": d.get("icon", ""),
        "watermark": d.get("watermark", ""),
        "screenshot": d.get("screenshot", ""),
        "category": category,
        "slot": slot_name,
        "bucketHash": equip_bucket,
        "currentBucketHash": int(raw_item.get("bucketHash", equip_bucket)),
        "typeName": d.get("itemTypeDisplayName", category),
        "tierName": tier_name,
        "isExotic": tier_name == "Exotic",
        "isMasterworked": bool(state_bits & 4),
        "isCrafted": bool(state_bits & 8),
        "isLocked": bool(state_bits & 1),
        "power": power,
        "element": element if category == "Weapon" else "Armor",
        "classRestriction": CLASS_TYPE_MAP.get(int(d.get("classType", 3)), "Any"),
        "classType": int(d.get("classType", 3)),
        "location": location,  # 'character' | 'vault' | 'postmaster'
        "characterId": owner_char_id,
        "isEquipped": is_equipped,
        "transferStatus": int(raw_item.get("transferStatus", 0)),
        "frame": frame_info,
        "perkColumns": perk_columns,
        "traitColIndexes": trait_col_indexes,
        "activePerks": active_perks,
        "masterwork": masterwork_info,
        "mods": mods_list,
        "stats": ordered_stats,
        "totalStats": total_armor_stats if category == "Armor" else 0,
    }


def fetch_guardian_inventory(access_token: str) -> dict:
    creds = get_bungie_credentials()
    if not creds["api_key"]:
        raise RuntimeError("Bungie API Key is not configured on the server.")

    membership = get_active_destiny_membership(creds["api_key"], access_token)
    m_type = membership["membershipType"]
    m_id = membership["destinyMembershipId"]

    profile = _bungie_get(
        f"/Destiny2/{m_type}/Profile/{m_id}/?components=100,102,200,201,205,206,300,304,305,310",
        creds["api_key"],
        access_token,
    )

    chars_raw = profile.get("characters", {}).get("data", {})
    char_equip_raw = profile.get("characterEquipment", {}).get("data", {})
    char_inv_raw = profile.get("characterInventories", {}).get("data", {})
    char_loadouts_raw = profile.get("characterLoadouts", {}).get("data", {})
    vault_raw = profile.get("profileInventory", {}).get("data", {}).get("items", [])

    instances = profile.get("itemComponents", {}).get("instances", {}).get("data", {})
    stats_map = profile.get("itemComponents", {}).get("stats", {}).get("data", {})
    sockets_map = profile.get("itemComponents", {}).get("sockets", {}).get("data", {})
    reusable_map = profile.get("itemComponents", {}).get("reusablePlugs", {}).get("data", {})

    # Gather every item hash and socket plug hash for 1-shot SQLite batch resolution
    all_hashes: Set[int] = set()

    def _collect_item_hashes(items_list: List[dict]):
        for it in items_list:
            ih = it.get("itemHash")
            if ih:
                all_hashes.add(int(ih))
            iid = str(it.get("itemInstanceId", ""))
            if iid:
                for sk in sockets_map.get(iid, {}).get("sockets", []):
                    if sk.get("plugHash"):
                        all_hashes.add(int(sk["plugHash"]))
                for _, rlist in reusable_map.get(iid, {}).get("plugs", {}).items():
                    for rp in rlist:
                        if rp.get("plugItemHash"):
                            all_hashes.add(int(rp["plugItemHash"]))

    for cid in chars_raw:
        _collect_item_hashes(char_equip_raw.get(cid, {}).get("items", []))
        _collect_item_hashes(char_inv_raw.get(cid, {}).get("items", []))

    vault_gear_candidates = [it for it in vault_raw if int(it.get("bucketHash", 0)) == BUCKET_VAULT_GENERAL]
    _collect_item_hashes(vault_gear_candidates)

    defs = resolve_item_definitions(all_hashes, creds["api_key"])

    # Build character summaries & inventories
    characters_list = []
    subclass_by_instance: Dict[str, dict] = {}
    gear_by_instance: Dict[str, dict] = {}

    # Sort characters consistently: Hunter, Warlock, Titan or by last played
    for cid, cinfo in sorted(chars_raw.items(), key=lambda kv: kv[1].get("dateLastPlayed", ""), reverse=True):
        c_type = int(cinfo.get("classType", 0))
        c_name = CLASS_TYPE_MAP.get(c_type, "Guardian")

        # Extract character stats (modern 6-stat hashes)
        c_stats_raw = cinfo.get("stats", {})
        c_stats = {}
        for shash, sname in ARMOR_STAT_ORDER:
            if str(shash) in c_stats_raw:
                c_stats[sname] = int(c_stats_raw[str(shash)])

        equipped_items = []
        equipped_subclass = None
        for raw_eq in char_equip_raw.get(cid, {}).get("items", []):
            ehash = int(raw_eq.get("itemHash", 0))
            edef = defs.get(ehash)
            if edef and int(edef.get("bucketTypeHash", 0)) == BUCKET_SUBCLASS:
                sub_iid = str(raw_eq.get("itemInstanceId", ""))
                equipped_subclass = {
                    "itemInstanceId": sub_iid,
                    "name": edef.get("name", ""),
                    "icon": edef.get("icon", ""),
                }
                if sub_iid:
                    subclass_by_instance[sub_iid] = equipped_subclass
                continue
            enriched = _enrich_item(raw_eq, defs, instances, stats_map, sockets_map, reusable_map, "character", cid, True)
            if enriched:
                equipped_items.append(enriched)
                if enriched.get("itemInstanceId"):
                    gear_by_instance[enriched["itemInstanceId"]] = enriched

        bag_items = []
        postmaster_items = []
        for raw_inv in char_inv_raw.get(cid, {}).get("items", []):
            ihash = int(raw_inv.get("itemHash", 0))
            idef = defs.get(ihash)
            if idef and int(idef.get("bucketTypeHash", 0)) == BUCKET_SUBCLASS:
                sub_iid = str(raw_inv.get("itemInstanceId", ""))
                if sub_iid:
                    subclass_by_instance[sub_iid] = {
                        "itemInstanceId": sub_iid,
                        "name": idef.get("name", ""),
                        "icon": idef.get("icon", ""),
                    }
                continue

            is_pm = int(raw_inv.get("bucketHash", 0)) == BUCKET_POSTMASTER
            loc = "postmaster" if is_pm else "character"
            enriched = _enrich_item(raw_inv, defs, instances, stats_map, sockets_map, reusable_map, loc, cid, False)
            if enriched:
                if is_pm:
                    postmaster_items.append(enriched)
                else:
                    bag_items.append(enriched)
                if enriched.get("itemInstanceId"):
                    gear_by_instance[enriched["itemInstanceId"]] = enriched

        characters_list.append({
            "characterId": cid,
            "classType": c_type,
            "className": c_name,
            "light": int(cinfo.get("light", 0)),
            "emblemPath": cinfo.get("emblemPath", ""),
            "emblemBackgroundPath": cinfo.get("emblemBackgroundPath", ""),
            "emblemColor": cinfo.get("emblemColor", {}),
            "dateLastPlayed": cinfo.get("dateLastPlayed", ""),
            "subclass": equipped_subclass,
            "stats": c_stats,
            "equipment": equipped_items,
            "inventory": bag_items,
            "postmaster": postmaster_items,
            "loadouts": [],
        })

    # Build Vault items
    vault_items = []
    for raw_v in vault_gear_candidates:
        enriched = _enrich_item(raw_v, defs, instances, stats_map, sockets_map, reusable_map, "vault", "", False)
        if enriched:
            vault_items.append(enriched)
            if enriched.get("itemInstanceId"):
                gear_by_instance[enriched["itemInstanceId"]] = enriched

    # Sort Vault items: Exotics & highest power weapons first, then armor
    vault_items.sort(key=lambda x: (0 if x["category"] == "Weapon" else 1, -int(x["power"] or 0), x["name"]))

    # Resolve saved in-game Character Loadouts (Component 206) across all characters + vault
    loadout_defs = resolve_loadout_definitions(creds["api_key"])
    ld_names_map = loadout_defs.get("names", {})
    ld_icons_map = loadout_defs.get("icons", {})
    ld_colors_map = loadout_defs.get("colors", {})
    weapon_slot_order = {"Kinetic": 0, "Energy": 1, "Heavy": 2}
    armor_slot_order = {"Helmet": 0, "Gauntlets": 1, "Chest Armor": 2, "Leg Armor": 3, "Class Armor": 4}

    for ch_obj in characters_list:
        cid = ch_obj["characterId"]
        raw_lds = char_loadouts_raw.get(cid, {}).get("loadouts", [])
        saved_lds = []
        for idx, ld in enumerate(raw_lds):
            ld_items = ld.get("items", []) or []
            active_refs = [li for li in ld_items if str(li.get("itemInstanceId", "0")) not in ("", "0")]
            if not active_refs:
                continue

            n_hash = int(ld.get("nameHash", 0)) & 0xFFFFFFFF
            i_hash = int(ld.get("iconHash", 0)) & 0xFFFFFFFF
            c_hash = int(ld.get("colorHash", 0)) & 0xFFFFFFFF

            ld_name = ld_names_map.get(n_hash) or f"Loadout {idx + 1}"
            ld_icon = ld_icons_map.get(i_hash, "")
            ld_color = ld_colors_map.get(c_hash, "")

            ld_subclass = None
            ld_weapons = []
            ld_armor = []
            exotic_armor = None
            exotic_weapon = None
            missing_count = 0

            for li in active_refs:
                iid = str(li.get("itemInstanceId", ""))
                if iid in subclass_by_instance:
                    ld_subclass = subclass_by_instance[iid]
                elif iid in gear_by_instance:
                    g = gear_by_instance[iid]
                    slim_g = {
                        "itemInstanceId": g["itemInstanceId"],
                        "itemHash": g["itemHash"],
                        "name": g["name"],
                        "icon": g["icon"],
                        "slot": g["slot"],
                        "category": g["category"],
                        "typeName": g["typeName"],
                        "tierName": g["tierName"],
                        "isExotic": g["isExotic"],
                        "element": g["element"],
                        "power": g["power"],
                    }
                    if g["category"] == "Weapon":
                        ld_weapons.append(slim_g)
                        if g["isExotic"] and not exotic_weapon:
                            exotic_weapon = slim_g
                    else:
                        ld_armor.append(slim_g)
                        if g["isExotic"] and not exotic_armor:
                            exotic_armor = slim_g
                else:
                    missing_count += 1

            ld_weapons.sort(key=lambda w: weapon_slot_order.get(w["slot"], 99))
            ld_armor.sort(key=lambda a: armor_slot_order.get(a["slot"], 99))

            saved_lds.append({
                "loadoutIndex": idx,
                "slotNumber": idx + 1,
                "name": ld_name,
                "iconPath": ld_icon,
                "colorPath": ld_color,
                "subclass": ld_subclass,
                "exoticItem": exotic_armor or exotic_weapon,
                "weapons": ld_weapons,
                "armor": ld_armor,
                "missingCount": missing_count,
            })

        ch_obj["loadouts"] = saved_lds

    return {
        "player": membership,
        "characters": characters_list,
        "vault": {
            "count": len(vault_gear_candidates),
            "gearCount": len(vault_items),
            "capacity": 1300,
            "items": vault_items,
        },
    }


def transfer_guardian_item(
    access_token: str,
    membership_type: int,
    item_instance_id: str,
    item_hash: int,
    source_location: str,
    source_character_id: str,
    target_type: str,  # 'vault' | 'character' | 'equip'
    target_character_id: str = "",
    is_equipped: bool = False,
    fallback_equip_instance_id: str = "",
) -> dict:
    creds = get_bungie_credentials()
    api_key = creds["api_key"]
    if not api_key:
        raise RuntimeError("Bungie API Key is not configured.")

    # Step 0: If item is currently equipped on source character and leaving that slot, equip a fallback item first
    if is_equipped and source_character_id and not (target_type == "equip" and target_character_id == source_character_id):
        if not fallback_equip_instance_id:
            raise RuntimeError(
                "This item is currently equipped! Move or keep at least one unequipped item in that slot on this character so Destiny 2 lets us unequip it."
            )
        _bungie_post(
            "/Destiny2/Actions/Items/EquipItem/",
            {
                "itemId": str(fallback_equip_instance_id),
                "characterId": str(source_character_id),
                "membershipType": int(membership_type),
            },
            api_key,
            access_token,
        )

    # Step 0b: If item is in Postmaster, pull from Postmaster first
    if source_location == "postmaster" and source_character_id:
        _bungie_post(
            "/Destiny2/Actions/Items/PullFromPostmaster/",
            {
                "itemReferenceHash": int(item_hash),
                "stackSize": 1,
                "itemId": str(item_instance_id),
                "characterId": str(source_character_id),
                "membershipType": int(membership_type),
            },
            api_key,
            access_token,
        )
        source_location = "character"

    # Case 1: Move to Vault
    if target_type == "vault":
        if source_location == "vault":
            return {"status": "already_in_vault", "message": "Item is already stored in your Vault."}
        _bungie_post(
            "/Destiny2/Actions/Items/TransferItem/",
            {
                "itemReferenceHash": int(item_hash),
                "stackSize": 1,
                "transferToVault": True,
                "itemId": str(item_instance_id),
                "characterId": str(source_character_id),
                "membershipType": int(membership_type),
            },
            api_key,
            access_token,
        )
        return {"status": "transferred", "destination": "Vault"}

    # Case 2: Move to Target Character (or Equip on Target Character)
    if not target_character_id:
        raise ValueError("Target character ID is required.")

    if source_location == "character" and source_character_id != target_character_id:
        # Step 1: Source Character -> Vault
        _bungie_post(
            "/Destiny2/Actions/Items/TransferItem/",
            {
                "itemReferenceHash": int(item_hash),
                "stackSize": 1,
                "transferToVault": True,
                "itemId": str(item_instance_id),
                "characterId": str(source_character_id),
                "membershipType": int(membership_type),
            },
            api_key,
            access_token,
        )
        source_location = "vault"

    if source_location == "vault":
        # Step 2: Vault -> Target Character
        _bungie_post(
            "/Destiny2/Actions/Items/TransferItem/",
            {
                "itemReferenceHash": int(item_hash),
                "stackSize": 1,
                "transferToVault": False,
                "itemId": str(item_instance_id),
                "characterId": str(target_character_id),
                "membershipType": int(membership_type),
            },
            api_key,
            access_token,
        )

    if target_type == "equip":
        _bungie_post(
            "/Destiny2/Actions/Items/EquipItem/",
            {
                "itemId": str(item_instance_id),
                "characterId": str(target_character_id),
                "membershipType": int(membership_type),
            },
            api_key,
            access_token,
        )
        return {"status": "equipped", "destination": target_character_id}

    return {"status": "transferred", "destination": target_character_id}


def set_item_lock_state(
    access_token: str,
    membership_type: int,
    item_instance_id: str,
    character_id: str,
    lock_state: bool = True,
) -> dict:
    """Locks or unlocks a single Destiny 2 instanced item via Bungie SetLockState."""
    creds = get_bungie_credentials()
    api_key = creds["api_key"]
    if not api_key:
        raise RuntimeError("Bungie API Key is not configured.")
    if not character_id:
        raise ValueError("A valid characterId is required by Bungie API to lock/unlock items.")

    _bungie_post(
        "/Destiny2/Actions/Items/SetLockState/",
        {
            "state": bool(lock_state),
            "itemId": str(item_instance_id),
            "characterId": str(character_id),
            "membershipType": int(membership_type),
        },
        api_key,
        access_token,
    )
    return {"status": "ok", "itemInstanceId": str(item_instance_id), "isLocked": bool(lock_state)}


def batch_lock_guardian_items(
    access_token: str,
    membership_type: int,
    default_character_id: str,
    items_to_lock: List[dict],
    lock_state: bool = True,
) -> dict:
    """Locks (or unlocks) multiple God Roll items across Characters and Vault safely."""
    creds = get_bungie_credentials()
    api_key = creds["api_key"]
    if not api_key:
        raise RuntimeError("Bungie API Key is not configured.")
    if not items_to_lock:
        return {"status": "ok", "lockedIds": [], "lockedCount": 0, "failed": []}

    locked_ids: List[str] = []
    failed: List[dict] = []

    def _lock_one(entry: dict) -> Tuple[str, Optional[str], str]:
        iid = str(entry.get("itemInstanceId", ""))
        cid = str(entry.get("characterId") or default_character_id or "")
        nm = str(entry.get("name", "Item"))
        if not iid or not cid:
            return iid, "Missing instance or character ID", nm
        try:
            _bungie_post(
                "/Destiny2/Actions/Items/SetLockState/",
                {
                    "state": bool(lock_state),
                    "itemId": iid,
                    "characterId": cid,
                    "membershipType": int(membership_type),
                },
                api_key,
                access_token,
            )
            return iid, None, nm
        except PermissionError:
            raise
        except Exception as exc:
            return iid, str(exc), nm

    # Test first item synchronously so an expired OAuth token raises PermissionError cleanly for auto-refresh
    first_iid, first_err, first_nm = _lock_one(items_to_lock[0])
    if first_err is None:
        locked_ids.append(first_iid)
    else:
        failed.append({"itemInstanceId": first_iid, "name": first_nm, "reason": first_err})

    remaining = items_to_lock[1:]
    if remaining:
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(_lock_one, it) for it in remaining]
            for fut in as_completed(futures):
                iid, err, nm = fut.result()
                if err is None:
                    locked_ids.append(iid)
                else:
                    failed.append({"itemInstanceId": iid, "name": nm, "reason": err})

    return {
        "status": "ok",
        "lockedIds": locked_ids,
        "lockedCount": len(locked_ids),
        "failed": failed,
        "isLocked": bool(lock_state),
    }


def equip_guardian_loadout(
    access_token: str,
    membership_type: int,
    character_id: str,
    loadout_index: int,
) -> dict:
    """Equips a saved in-game Destiny 2 character loadout (requires character in Orbit, Tower/Social, or Offline)."""
    creds = get_bungie_credentials()
    api_key = creds["api_key"]
    if not api_key:
        raise RuntimeError("Bungie API Key is not configured.")

    _bungie_post(
        "/Destiny2/Actions/Loadouts/EquipLoadout/",
        {
            "loadoutIndex": int(loadout_index),
            "characterId": str(character_id),
            "membershipType": int(membership_type),
        },
        api_key,
        access_token,
    )
    return {"status": "equipped", "characterId": str(character_id), "loadoutIndex": int(loadout_index)}


def _norm_text(s: str) -> str:
    s = re.sub(r"\(.*?\)", "", s or "")
    s = s.lower().replace("enhanced ", "").strip()
    return re.sub(r"[^a-z0-9]", "", s)


def _split_godroll_options(spec_str: str) -> List[str]:
    if not spec_str:
        return []
    parts = re.split(r"\s*(?:/|,|\bor\b)\s*", spec_str, flags=re.IGNORECASE)
    return [_norm_text(p) for p in parts if _norm_text(p)]


# Curated S-Tier Destiny 2 Trait-Column Synergy Pools for weapons not manually listed in God Roll Finder yet
_PVE_SETUP_TRAITS = {
    "healclip", "enviousassassin", "enviousarsenal", "reconstruction", "rewindrounds",
    "repulsorbrace", "rimestealer", "attritionorbs", "demolitionist", "subsistence",
    "airtrigger", "leadfromgold", "autoloadingholster", "relentlessstrikes",
    "fourthtimesthecharm", "tripletap", "shoottoloot", "impulseamplifier",
    "beaconrounds", "slice", "overflow", "clowncartridge", "fieldprep", "rapidhit",
    "outlaw", "statsforall", "eddycurrent", "loosechange", "tirelessblade",
    "ambitiousassassin", "pugilist", "witheringgaze",
}

_PVE_PAYOFF_TRAITS = {
    "incandescent", "baitandswitch", "voltshot", "joltingfeedback", "chillclip",
    "destabilizingrounds", "headstone", "kinetictremors", "explosivepayload",
    "frenzy", "chaosreshaped", "oneforall", "surrounded", "eageredge",
    "whirlwindblade", "coldsteel", "controlledburst", "reservoirburst",
    "chainreaction", "hatchling", "firefly", "dragonfly", "desperatemeasures",
    "masterofarms", "killingtally", "goldentricorn", "aggregatecharge",
    "elementalhoning", "reaperstithe", "detonatorbeam", "rollingstorm",
    "attritionorbs", "witheringgaze",
}

_PVP_CONSISTENCY_TRAITS = {
    "lonewolf", "keepaway", "slideshot", "slideways", "zenmoment",
    "dynamicswayreduction", "perpetualmotion", "rapidhit", "movingtarget",
    "snapshotsights", "quickdraw", "tothepain", "encore", "fragilefocus",
    "elementalcapacitor", "rangefinder", "surplus", "threatdetector",
    "tunnelvision", "killingwind", "nodistractions", "hipfiregrip",
}

_PVP_LETHALITY_TRAITS = {
    "openingshot", "eyeofthestorm", "headseeker", "precisioninstrument",
    "killclip", "closingtime", "magnificenthowl", "targetlock", "desperado",
    "swordlogic", "tapthetrigger", "explosivepayload", "timedpayload",
    "snapshotsights", "rangefinder", "zenmoment", "masterofarms", "boxbreathing",
    "lonewolf", "keepaway",
}


def evaluate_item_against_godrolls(item: dict, god_rolls: List[dict]) -> dict:
    """Evaluates a weapon against My God Rolls (God Roll Finder DB) + F.E.L.I.C.I.A.'s 2-column PVE/PVP Synergy Matrix."""
    item_norm = _norm_text(item.get("name", ""))
    matched_entry = None
    for gr in god_rolls:
        gr_norm = _norm_text(gr.get("name", ""))
        if gr_norm and (gr_norm == item_norm or gr_norm in item_norm or item_norm in gr_norm):
            matched_entry = gr
            break

    # Map normalized perk -> display name rolled on this weapon
    norm_to_display: Dict[str, str] = {}
    all_item_perk_norms: Set[str] = set()
    perk_cols = item.get("perkColumns", []) or []
    for col in perk_cols:
        for opt in col:
            pname = opt.get("name", "")
            if pname:
                pn = _norm_text(pname)
                all_item_perk_norms.add(pn)
                norm_to_display.setdefault(pn, pname)
    for ap in item.get("activePerks", []) or []:
        pname = ap.get("name", "")
        if pname:
            pn = _norm_text(pname)
            all_item_perk_norms.add(pn)
            norm_to_display.setdefault(pn, pname)

    mw_name = (item.get("masterwork") or {}).get("name", "")
    mw_norm = _norm_text(mw_name)

    # Exotic weapons have fixed/catalyst perks rather than random legendary rolls (unless manually entered in God Roll Finder)
    if (item.get("isExotic") and not matched_entry) or item.get("category") != "Weapon":
        return {
            "in_database": False,
            "match_source": "none",
            "entry": None,
            "pve_trait_hits": 0,
            "pvp_trait_hits": 0,
            "pve_matches": [],
            "pve_matched_perks": [],
            "pvp_matches": [],
            "pvp_matched_perks": [],
            "verdict_code": "EXOTIC" if item.get("isExotic") else "AI_EVAL",
        }

    # Compute F.E.L.I.C.I.A. 2-Column Combat Trait Synergy across distinct trait columns
    pve_pair: List[str] = []
    pvp_pair: List[str] = []
    if not item.get("isExotic"):
        t_indexes = item.get("traitColIndexes") or []
        trait_cols = [perk_cols[i] for i in t_indexes if 0 <= i < len(perk_cols)]
        if len(trait_cols) < 2 and len(perk_cols) >= 4:
            trait_cols = perk_cols[2:4]

        if len(trait_cols) >= 2:
            col_a = [(_norm_text(o.get("name", "")), o.get("name", "")) for o in trait_cols[0] if o.get("name")]
            col_b = [(_norm_text(o.get("name", "")), o.get("name", "")) for o in trait_cols[1] if o.get("name")]

            for na, da in col_a:
                for nb, db in col_b:
                    if not na or not nb or na == nb:
                        continue
                    if not pve_pair:
                        if (
                            (na in _PVE_SETUP_TRAITS and nb in _PVE_PAYOFF_TRAITS)
                            or (na in _PVE_PAYOFF_TRAITS and nb in _PVE_SETUP_TRAITS)
                            or (na in _PVE_PAYOFF_TRAITS and nb in _PVE_PAYOFF_TRAITS)
                        ):
                            pve_pair = [da, db]
                    if not pvp_pair:
                        if (
                            (na in _PVP_CONSISTENCY_TRAITS and nb in _PVP_LETHALITY_TRAITS)
                            or (na in _PVP_LETHALITY_TRAITS and nb in _PVP_CONSISTENCY_TRAITS)
                            or (na in _PVP_LETHALITY_TRAITS and nb in _PVP_LETHALITY_TRAITS)
                        ):
                            pvp_pair = [da, db]

    # Case 1: Weapon is in our God Roll Finder database (supplemented by F.E.L.I.C.I.A. 2-col synergy for alternate meta rolls)
    if matched_entry:
        def _score_mode(mode_spec: dict) -> Tuple[int, int, List[str], List[str]]:
            trait_hits = 0
            bonus_hits = 0
            matched_labels: List[str] = []
            matched_perks: List[str] = []

            for key, label in [("perk1", "Trait 1"), ("perk2", "Trait 2")]:
                wanted = _split_godroll_options(mode_spec.get(key, ""))
                hit = next((w for w in wanted if w in all_item_perk_norms), None)
                if hit:
                    trait_hits += 1
                    matched_labels.append(f"{label}: {mode_spec.get(key)}")
                    matched_perks.append(norm_to_display.get(hit, mode_spec.get(key, "")))

            for key, label in [("barrel", "Barrel"), ("mag", "Magazine")]:
                wanted = _split_godroll_options(mode_spec.get(key, ""))
                hit = next((w for w in wanted if w in all_item_perk_norms), None)
                if hit:
                    bonus_hits += 1
                    matched_labels.append(f"{label}: {mode_spec.get(key)}")

            wanted_mw = _split_godroll_options(mode_spec.get("masterwork", ""))
            if mw_norm and any(w in mw_norm or mw_norm in w for w in wanted_mw):
                bonus_hits += 1
                matched_labels.append(f"MW: {mode_spec.get('masterwork')}")

            return trait_hits, bonus_hits, matched_labels, matched_perks

        pve_traits, pve_bonus, pve_matches, pve_perk_names = _score_mode(matched_entry.get("pve", {}))
        pvp_traits, pvp_bonus, pvp_matches, pvp_perk_names = _score_mode(matched_entry.get("pvp", {}))

        used_db = (pve_traits == 2) or (pvp_traits == 2)
        if pve_traits < 2 and pve_pair:
            pve_traits = 2
            pve_perk_names = pve_pair
            pve_matches = [f"Synergy: {' + '.join(pve_pair)}"]
        if pvp_traits < 2 and pvp_pair:
            pvp_traits = 2
            pvp_perk_names = pvp_pair
            pvp_matches = [f"Synergy: {' + '.join(pvp_pair)}"]

        if pve_traits == 2 and pvp_traits == 2:
            verdict = "DUAL_GOD_ROLL"
        elif pve_traits == 2:
            verdict = "PVE_GOD_ROLL"
        elif pvp_traits == 2:
            verdict = "PVP_GOD_ROLL"
        elif pve_traits == 1 or pvp_traits == 1:
            verdict = "SOLID_KEEP"
        else:
            verdict = "SHARD_CANDIDATE"

        return {
            "in_database": used_db,
            "match_source": "database" if used_db else ("felicia_ai" if verdict in ("DUAL_GOD_ROLL", "PVE_GOD_ROLL", "PVP_GOD_ROLL") else "database"),
            "entry": matched_entry,
            "pve_trait_hits": pve_traits,
            "pve_bonus_hits": pve_bonus,
            "pve_matches": pve_matches,
            "pve_matched_perks": pve_perk_names,
            "pvp_trait_hits": pvp_traits,
            "pvp_bonus_hits": pvp_bonus,
            "pvp_matches": pvp_matches,
            "pvp_matched_perks": pvp_perk_names,
            "verdict_code": verdict,
        }

    # Case 2: Legendary Weapon evaluated by F.E.L.I.C.I.A. 2-Column Synergy Matrix
    if pve_pair and pvp_pair:
        verdict = "DUAL_GOD_ROLL"
    elif pve_pair:
        verdict = "PVE_GOD_ROLL"
    elif pvp_pair:
        verdict = "PVP_GOD_ROLL"
    else:
        verdict = "AI_EVAL"

    return {
        "in_database": False,
        "match_source": "felicia_ai" if verdict in ("DUAL_GOD_ROLL", "PVE_GOD_ROLL", "PVP_GOD_ROLL") else "none",
        "entry": None,
        "pve_trait_hits": 2 if pve_pair else 0,
        "pvp_trait_hits": 2 if pvp_pair else 0,
        "pve_matches": [f"Synergy: {' + '.join(pve_pair)}"] if pve_pair else [],
        "pve_matched_perks": pve_pair,
        "pvp_matches": [f"Synergy: {' + '.join(pvp_pair)}"] if pvp_pair else [],
        "pvp_matched_perks": pvp_pair,
        "verdict_code": verdict,
    }
