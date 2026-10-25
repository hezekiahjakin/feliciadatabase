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
BUCKET_SEASONAL_ARTIFACT = 1506418338
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

ARTIFACT_BUCKETS = {
    BUCKET_SEASONAL_ARTIFACT: "Artifact",
}

ALL_GEAR_BUCKETS = {**WEAPON_BUCKETS, **ARMOR_BUCKETS, **ARTIFACT_BUCKETS}

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
        "preview": raw.get("preview", {}),
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
    equip_bucket = int(d.get("bucketTypeHash", 0))
    # 3 = Weapon, 2 = Armor, 28 = Seasonal Artifact
    is_artifact = (item_type == 28) or (equip_bucket == BUCKET_SEASONAL_ARTIFACT)
    if item_type not in (2, 3) and not is_artifact:
        return None

    if equip_bucket not in ALL_GEAR_BUCKETS and not is_artifact:
        return None

    instance_id = str(raw_item.get("itemInstanceId", ""))
    inst = instances.get(instance_id, {}) if instance_id else {}
    state_bits = int(raw_item.get("state", 0))

    dmg_enum = inst.get("damageType") or d.get("defaultDamageType") or 1
    element = DAMAGE_TYPE_MAP.get(int(dmg_enum), "Kinetic")
    power = inst.get("primaryStat", {}).get("value", 0)

    if is_artifact:
        category = "Artifact"
        slot_name = "Artifact"
    elif item_type == 3:
        category = "Weapon"
        slot_name = ALL_GEAR_BUCKETS.get(equip_bucket, "Kinetic")
    else:
        category = "Armor"
        slot_name = ALL_GEAR_BUCKETS.get(equip_bucket, "Helmet")
    tier_name = d.get("tierTypeName", "Legendary")

    # Parse sockets (Intrinsic frame, Perks, Masterwork, Mods)
    frame_info = None
    perk_columns: List[List[dict]] = []
    barrel_col_index: Optional[int] = None
    mag_col_index: Optional[int] = None
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
                    if sc_hash in SOCKET_CAT_WEAPON_PERKS:
                        if barrel_col_index is None and any(
                            k in pcat for k in ("barrels", "scopes", "blades", "bowstrings", "hafts", "rails", "tubes", "sights")
                        ):
                            barrel_col_index = col_idx_now
                        elif mag_col_index is None and any(
                            k in pcat for k in ("magazines", "arrows", "guards", "batteries")
                        ):
                            mag_col_index = col_idx_now
                        elif "frames" in pcat and "origin" not in pcat and "crafting.plugs" not in pcat:
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

    # Calculate Gear Tier (Tier 1 through Tier 5 tracking, matching Destiny 2 in-game, light.gg & DIM)
    api_gear_tier = inst.get("gearTier") or raw_item.get("gearTier")
    gear_tier: Optional[int] = None
    if api_gear_tier is not None and isinstance(api_gear_tier, (int, float)) and 1 <= int(api_gear_tier) <= 5:
        gear_tier = int(api_gear_tier)
    else:
        # Fallback appraisal based on category, stats, perks, and crafting/masterwork state
        if category == "Armor":
            is_artifice = any("artifice" in m.get("name", "").lower() for m in mods_list) or any("artifice" in p.get("name", "").lower() for p in active_perks)
            if total_armor_stats >= 64 or is_artifice or (tier_name == "Exotic" and total_armor_stats >= 60):
                gear_tier = 5
            elif total_armor_stats >= 60:
                gear_tier = 4
            elif total_armor_stats >= 56:
                gear_tier = 3
            elif total_armor_stats >= 50:
                gear_tier = 2
            elif total_armor_stats > 0:
                gear_tier = 1
            else:
                gear_tier = 5 if tier_name == "Exotic" else (4 if tier_name == "Legendary" else 2)
        elif category == "Weapon":
            w_name_low = d.get("name", "").lower()
            is_adept = any(tag in w_name_low for tag in ["(adept)", "(timelost)", "(harrowed)"])
            enhanced_count = sum(1 for p in active_perks if "(enhanced)" in p.get("name", "").lower() or "enhanced" in p.get("description", "").lower())
            is_crafted = bool(state_bits & 8)
            is_mw = bool(state_bits & 4)
            if tier_name == "Exotic" or is_adept or enhanced_count >= 2:
                gear_tier = 5
            elif is_crafted or enhanced_count >= 1:
                gear_tier = 4
            elif is_mw:
                gear_tier = 3
            elif tier_name == "Legendary":
                gear_tier = 2
            else:
                gear_tier = 1

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
        "barrelColIndex": barrel_col_index,
        "magColIndex": mag_col_index,
        "traitColIndexes": trait_col_indexes,
        "activePerks": active_perks,
        "masterwork": masterwork_info,
        "mods": mods_list,
        "stats": ordered_stats,
        "totalStats": total_armor_stats if category == "Armor" else 0,
        "gearTier": gear_tier,
    }


_compendium_sets_cache: Optional[List[dict]] = None


def _get_compendium_armor_sets() -> List[dict]:
    global _compendium_sets_cache
    if _compendium_sets_cache is not None:
        return _compendium_sets_cache
    comp_path = os.path.join(DATA_DIR, "compendium_db.json")
    sets_list: List[dict] = []
    if os.path.exists(comp_path):
        try:
            with open(comp_path, "r", encoding="utf-8") as f:
                db = json.load(f)
                sets_list = db.get("armor_sets", []) or []
        except Exception:
            sets_list = []
    _compendium_sets_cache = sets_list
    return _compendium_sets_cache


def match_compendium_armor_set(item_name: str, item_desc: str = "") -> Optional[dict]:
    sets = _get_compendium_armor_sets()
    name_low = (item_name or "").lower()
    desc_low = (item_desc or "").lower()

    for s in sets:
        s_name = s.get("name", "")
        s_low = s_name.lower()
        if s_low in name_low or s_low in desc_low:
            return s
        if s_name == "CODA" and "(coda)" in name_low:
            return s
        if s_name == "Crota's Memory" and any(k in name_low for k in ("deathsinger", "willbreaker", "oversoul", "crota")):
            return s
        if s_name == "Atheon's Memory" and any(k in name_low for k in ("kabr", "façade", "facade", "prime zealot", "hezen", "vault of glass", "atheon")):
            return s
        if s_name == "Oryx's Memory" and any(k in name_low for k in ("harrowed", "darkhollow", "warpriest", "mouth of ur", "oryx")):
            return s
        if s_name == "TM Custom" and "tm-" in name_low:
            return s
        if s_name == "Kentarch 3" and any(k in name_low for k in ("kentarch", "divisive")):
            return s

    return None


def _parse_subclass_details(sub_iid: str, plug_hashes: List[int], defs: Dict[int, dict], sockets_map: dict) -> dict:
    super_info = None
    aspects = []
    fragments = []
    melee_info = None
    grenade_info = None
    class_ability_info = None
    movement_info = None

    seen_hashes = set()
    candidate_hashes: List[int] = []

    for ph in plug_hashes or []:
        if ph and int(ph) not in seen_hashes:
            seen_hashes.add(int(ph))
            candidate_hashes.append(int(ph))

    if sub_iid:
        for sk in sockets_map.get(sub_iid, {}).get("sockets", []):
            sph = sk.get("plugHash")
            if sph and int(sph) not in seen_hashes:
                seen_hashes.add(int(sph))
                candidate_hashes.append(int(sph))

    for ph in candidate_hashes:
        pdef = defs.get(ph)
        if not pdef or not pdef.get("name"):
            continue
        pname = pdef["name"]
        pname_low = pname.lower()
        pcat = pdef.get("plugCategoryIdentifier", "").lower()
        if "empty" in pname_low or "default ornament" in pname_low:
            continue

        item_repr = {
            "name": pname,
            "icon": pdef.get("icon", ""),
            "description": pdef.get("description", ""),
        }

        if "supers" in pcat and not super_info:
            super_info = item_repr
        elif "aspects" in pcat:
            if not any(a["name"] == pname for a in aspects):
                aspects.append(item_repr)
        elif "fragments" in pcat:
            if not any(f["name"] == pname for f in fragments):
                fragments.append(item_repr)
        elif "melee" in pcat and not melee_info:
            melee_info = item_repr
        elif "grenades" in pcat and not grenade_info:
            grenade_info = item_repr
        elif "class_abilities" in pcat and not class_ability_info:
            class_ability_info = item_repr
        elif "movement" in pcat and not movement_info:
            movement_info = item_repr

    return {
        "super": super_info,
        "aspects": aspects,
        "fragments": fragments,
        "melee": melee_info,
        "grenade": grenade_info,
        "classAbility": class_ability_info,
        "movement": movement_info,
    }


def _extract_armor_mods(armor_iid: str, plug_hashes: List[int], defs: Dict[int, dict], sockets_map: dict) -> List[dict]:
    mods_list = []
    seen_names = set()
    candidate_hashes: List[int] = []

    for ph in plug_hashes or []:
        if ph:
            candidate_hashes.append(int(ph))

    if armor_iid:
        for sk in sockets_map.get(armor_iid, {}).get("sockets", []):
            sph = sk.get("plugHash")
            if sph:
                candidate_hashes.append(int(sph))

    for ph in candidate_hashes:
        pdef = defs.get(ph)
        if not pdef or not pdef.get("name"):
            continue
        pname = pdef["name"]
        pname_low = pname.lower()
        pcat = pdef.get("plugCategoryIdentifier", "").lower()

        if any(skip in pname_low for skip in ("empty", "default", "tier ", "upgrade armor")):
            continue
        if any(skip in pcat for skip in ("shader", "ornament", "tracker", "masterwork")):
            continue
        if pname in seen_names:
            continue

        if "armor" in pcat or "enhancement" in pcat or "stat." in pcat or "mod" in pcat or pdef.get("itemType") in (19, 20):
            seen_names.add(pname)
            mods_list.append({
                "name": pname,
                "icon": pdef.get("icon", ""),
                "description": pdef.get("description", ""),
            })

    return mods_list


def evaluate_armor_roll(item: dict) -> dict:
    item_name = item.get("name", "")
    total_stats = int(item.get("totalStats") or 0)
    is_exotic = bool(item.get("isExotic"))
    is_artifice = "artifice" in item_name.lower()

    # Extract Health stat (0-200 scale)
    stats_map = {s.get("name"): int(s.get("value", 0)) for s in (item.get("stats") or []) if s.get("name")}
    health_stat = stats_map.get("Health", 0)

    matched_set = match_compendium_armor_set(item_name, item.get("description", ""))

    # Tier 5 Quality Check:
    # Any Tier 5 armor is GOOD; anything under Tier 5 is TRASH.
    # Total stats >= 64, or Exotic, or Artifice, or Compendium Set with stats >= 60 = Tier 5.
    # Total stats < 60 and not Exotic = strictly Sub-Tier-5.
    is_tier_5 = (total_stats >= 64) or is_exotic or is_artifice or (matched_set is not None and total_stats >= 60)
    if total_stats < 60 and not is_exotic:
        is_tier_5 = False

    compendium_set_info = None
    if matched_set:
        compendium_set_info = {
            "name": matched_set["name"],
            "source": matched_set.get("source", ""),
            "perk2pc": {
                "name": matched_set.get("perk_2pc_name", ""),
                "desc": matched_set.get("perk_2pc_desc", ""),
            },
            "perk4pc": {
                "name": matched_set.get("perk_4pc_name", ""),
                "desc": matched_set.get("perk_4pc_desc", ""),
            },
            "tags": matched_set.get("tags", []),
        }

    if not is_tier_5:
        roll_type = "TRASH_DISMANTLE"
        verdict_code = "TRASH_ARMOR"
        verdict_label = "SAFE TO DISMANTLE (< Tier 5 Armor)"
        explanation = f"Sub-Tier 5 armor ({total_stats} Total Stats). Inferior to endgame Tier 5 set standards—safe to dismantle."
    else:
        # Tier 5: Health classification
        # PVP standard: 10+ Health stat counts as PVP spike!
        # PVE standard: Under 10 Health counts as PVE (0-2 Health is pure Zero-Health God Roll; 3-9 is PVE Low Health).
        if health_stat >= 10:
            roll_type = "PVP_GOD_ROLL"
            verdict_code = "PVP_GOD_ROLL"
            verdict_label = f"PVP GOD ROLL (Tier 5, {health_stat} Health)"
            explanation = f"High Health spike ({health_stat} >= 10) provides maximum ADS flinch resistance and rapid shield recovery for Crucible duels."
        elif health_stat <= 2:
            roll_type = "PVE_GOD_ROLL"
            verdict_code = "PVE_GOD_ROLL"
            verdict_label = "PVE GOD ROLL (Tier 5, Zero Health)"
            explanation = "Zero Health stat waste—100% of armor stat budget concentrated in rapid ability cooldowns and lethal firepower (Grenade, Melee, Super, Weapons, Class)."
        else:
            # 3 to 9 Health: Under 10 Health -> PVE Low Health tier (or unranked for PvP)
            roll_type = "PVE_GOD_ROLL"
            verdict_code = "PVE_GOD_ROLL"
            verdict_label = f"PVE ARMOR (Tier 5, {health_stat} Health)"
            explanation = f"Low Health ({health_stat} < 10)—suitable for PvE engagements where health stat investment is minimal. Pure 0-2 Health remains optimal for PvE."

    return {
        "isTier5": is_tier_5,
        "healthStat": health_stat,
        "totalStats": total_stats,
        "rollType": roll_type,
        "verdictCode": verdict_code,
        "verdictLabel": verdict_label,
        "explanation": explanation,
        "compendiumSet": compendium_set_info,
    }


def fetch_guardian_inventory(access_token: str) -> dict:
    creds = get_bungie_credentials()
    if not creds["api_key"]:
        raise RuntimeError("Bungie API Key is not configured on the server.")

    membership = get_active_destiny_membership(creds["api_key"], access_token)
    m_type = membership["membershipType"]
    m_id = membership["destinyMembershipId"]

    profile = _bungie_get(
        f"/Destiny2/{m_type}/Profile/{m_id}/?components=100,102,104,200,201,202,205,206,300,304,305,310",
        creds["api_key"],
        access_token,
    )

    chars_raw = profile.get("characters", {}).get("data", {})
    char_equip_raw = profile.get("characterEquipment", {}).get("data", {})
    char_inv_raw = profile.get("characterInventories", {}).get("data", {})
    char_loadouts_raw = profile.get("characterLoadouts", {}).get("data", {})
    char_progs_raw = profile.get("characterProgressions", {}).get("data", {})
    vault_raw = profile.get("profileInventory", {}).get("data", {}).get("items", [])
    seasonal_raw = profile.get("profileProgression", {}).get("data", {}).get("seasonalArtifact", {})

    instances = profile.get("itemComponents", {}).get("instances", {}).get("data", {})
    stats_map = profile.get("itemComponents", {}).get("stats", {}).get("data", {})
    sockets_map = profile.get("itemComponents", {}).get("sockets", {}).get("data", {})
    reusable_map = profile.get("itemComponents", {}).get("reusablePlugs", {}).get("data", {})

    # Gather every item hash, socket plug hash, loadout plug hash, and artifact perk for 1-shot SQLite batch resolution
    all_hashes: Set[int] = set()

    # Track character-specific artifact progressions (Component 202)
    char_artifact_prog: Dict[str, dict] = {}
    for cid_p, cp in char_progs_raw.items():
        c_art = cp.get("seasonalArtifact", {})
        if c_art:
            c_perks = []
            for t in c_art.get("tiers", []):
                for uph in t.get("unlockedPlugHashes", []):
                    if uph:
                        u_int = int(uph)
                        c_perks.append(u_int)
                        all_hashes.add(u_int)
            c_ih = int(c_art.get("artifactItemHash", 0))
            if c_ih:
                all_hashes.add(c_ih)
            char_artifact_prog[cid_p] = {
                "artifactItemHash": c_ih,
                "powerBonus": int(c_art.get("powerBonus", 0)),
                "pointsAcquired": int(c_art.get("pointsAcquired", 0)),
                "unlockedPlugHashes": c_perks,
            }

    art_item_hash = int(seasonal_raw.get("artifactItemHash", 0)) if seasonal_raw else 0
    art_power_bonus = int(seasonal_raw.get("powerBonus", 0)) if seasonal_raw else 0
    art_points = int(seasonal_raw.get("pointsAcquired", 0)) if seasonal_raw else 0
    active_perk_hashes: List[int] = []
    if seasonal_raw:
        for t in seasonal_raw.get("tiers", []):
            for uph in t.get("unlockedPlugHashes", []):
                if uph:
                    u_int = int(uph)
                    active_perk_hashes.append(u_int)
                    all_hashes.add(u_int)
    for c_info in char_artifact_prog.values():
        for uph in c_info.get("unlockedPlugHashes", []):
            if uph not in active_perk_hashes:
                active_perk_hashes.append(uph)
                all_hashes.add(uph)
        if not art_power_bonus and c_info.get("powerBonus"):
            art_power_bonus = c_info["powerBonus"]
        if not art_points and c_info.get("pointsAcquired"):
            art_points = c_info["pointsAcquired"]
        if not art_item_hash and c_info.get("artifactItemHash"):
            art_item_hash = c_info["artifactItemHash"]
    if art_item_hash:
        all_hashes.add(art_item_hash)

    # Collect all loadout plug hashes
    for cid_k, lds_wrapper in char_loadouts_raw.items():
        for ld_k in lds_wrapper.get("loadouts", []):
            for li_k in ld_k.get("items", []):
                for ph_k in li_k.get("plugItemHashes", []):
                    if ph_k:
                        all_hashes.add(int(ph_k))

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

    # Ensure all artifact perk definitions from preview.derivedItemCategories are also resolved
    artifact_perk_hashes: Set[int] = set()
    for ih, d in list(defs.items()):
        if int(d.get("bucketTypeHash", 0)) == BUCKET_SEASONAL_ARTIFACT or d.get("itemType") == 28:
            cats = d.get("preview", {}).get("derivedItemCategories", [])
            for c in cats:
                for pit in c.get("items", []):
                    ph = pit.get("itemHash")
                    if ph:
                        artifact_perk_hashes.add(int(ph))

    if artifact_perk_hashes:
        extra_defs = resolve_item_definitions(artifact_perk_hashes, creds["api_key"])
        defs.update(extra_defs)

    def _resolve_artifact_perks_for_item(
        art_item: dict,
        owner_cid: str = "",
        saved_plug_hashes: Optional[List[int]] = None,
    ) -> List[dict]:
        perks_found: List[dict] = []
        seen_names = set()

        def _add_perk(p_hash: int):
            pdef = defs.get(int(p_hash))
            if not pdef or not pdef.get("name") or pdef["name"] in seen_names:
                return
            if pdef["name"].startswith("Act ") or "Reset Artifact" in pdef["name"]:
                return
            seen_names.add(pdef["name"])
            perks_found.append({
                "hash": int(p_hash),
                "name": pdef["name"],
                "icon": pdef.get("icon", ""),
                "description": pdef.get("description", ""),
            })

        # 1. Saved loadout plug hashes
        if saved_plug_hashes:
            for ph in saved_plug_hashes:
                pdef = defs.get(int(ph))
                if pdef and (pdef.get("itemTypeDisplayName") == "Artifact Perk" or pdef.get("plugCategoryIdentifier") == "artifact_perks" or int(ph) in active_perk_hashes):
                    _add_perk(ph)

        # 2. Sockets on artifact instance
        iid = str(art_item.get("itemInstanceId", ""))
        if iid and iid in sockets_map:
            for sk in sockets_map[iid].get("sockets", []):
                ph = sk.get("plugHash")
                if ph:
                    pdef = defs.get(int(ph))
                    if pdef and (pdef.get("itemTypeDisplayName") == "Artifact Perk" or pdef.get("plugCategoryIdentifier") == "artifact_perks"):
                        _add_perk(ph)

        # 3. Unlocked plug hashes from character progression
        if owner_cid and owner_cid in char_artifact_prog:
            for uph in char_artifact_prog[owner_cid].get("unlockedPlugHashes", []):
                _add_perk(uph)

        # 4. Unlocked plug hashes from profile progression
        for uph in active_perk_hashes:
            _add_perk(uph)

        # 5. Preview derivedItemCategories if still empty
        if not perks_found:
            ih = int(art_item.get("itemHash", 0))
            idef = defs.get(ih) or {}
            cats = idef.get("preview", {}).get("derivedItemCategories", [])
            for c in cats:
                for pit in c.get("items", []):
                    ph = pit.get("itemHash")
                    if ph:
                        pdef = defs.get(int(ph))
                        if pdef and pdef.get("itemTypeDisplayName") == "Artifact Perk":
                            _add_perk(ph)
                            if len(perks_found) >= 7:
                                break
                if len(perks_found) >= 7:
                    break

        return perks_found

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
        equipped_artifact = None

        for raw_eq in char_equip_raw.get(cid, {}).get("items", []):
            ehash = int(raw_eq.get("itemHash", 0))
            edef = defs.get(ehash)
            if edef and int(edef.get("bucketTypeHash", 0)) == BUCKET_SUBCLASS:
                sub_iid = str(raw_eq.get("itemInstanceId", ""))
                sub_details = _parse_subclass_details(sub_iid, [], defs, sockets_map)
                equipped_subclass = {
                    "itemInstanceId": sub_iid,
                    "name": edef.get("name", ""),
                    "icon": edef.get("icon", ""),
                    "element": DAMAGE_TYPE_MAP.get(int(edef.get("defaultDamageType", 1)), "Kinetic"),
                    **sub_details,
                }
                if sub_iid:
                    subclass_by_instance[sub_iid] = equipped_subclass
                continue

            enriched = _enrich_item(raw_eq, defs, instances, stats_map, sockets_map, reusable_map, "character", cid, True)
            if enriched:
                if enriched.get("category") == "Artifact":
                    enriched["activePerks"] = _resolve_artifact_perks_for_item(enriched, cid)
                    enriched["powerBonus"] = char_artifact_prog.get(cid, {}).get("powerBonus") or art_power_bonus or 1
                    enriched["pointsAcquired"] = char_artifact_prog.get(cid, {}).get("pointsAcquired") or art_points or len(enriched["activePerks"])
                    equipped_artifact = enriched

                equipped_items.append(enriched)
                if enriched.get("itemInstanceId"):
                    gear_by_instance[enriched["itemInstanceId"]] = enriched

        if not equipped_artifact and art_item_hash and art_item_hash in defs:
            art_def = defs[art_item_hash]
            fallback_art = {
                "itemInstanceId": "",
                "itemHash": art_item_hash,
                "name": art_def.get("name", "Seasonal Artifact"),
                "icon": art_def.get("icon", ""),
                "category": "Artifact",
                "slot": "Artifact",
                "typeName": "Seasonal Artifact",
                "tierName": "Seasonal",
                "powerBonus": char_artifact_prog.get(cid, {}).get("powerBonus") or art_power_bonus or 1,
                "pointsAcquired": char_artifact_prog.get(cid, {}).get("pointsAcquired") or art_points or 0,
                "isEquipped": True,
            }
            fallback_art["activePerks"] = _resolve_artifact_perks_for_item(fallback_art, cid)
            equipped_artifact = fallback_art

        bag_items = []
        postmaster_items = []
        for raw_inv in char_inv_raw.get(cid, {}).get("items", []):
            ihash = int(raw_inv.get("itemHash", 0))
            idef = defs.get(ihash)
            if idef and int(idef.get("bucketTypeHash", 0)) == BUCKET_SUBCLASS:
                sub_iid = str(raw_inv.get("itemInstanceId", ""))
                if sub_iid:
                    sub_details = _parse_subclass_details(sub_iid, [], defs, sockets_map)
                    subclass_by_instance[sub_iid] = {
                        "itemInstanceId": sub_iid,
                        "name": idef.get("name", ""),
                        "icon": idef.get("icon", ""),
                        "element": DAMAGE_TYPE_MAP.get(int(idef.get("defaultDamageType", 1)), "Kinetic"),
                        **sub_details,
                    }
                continue

            is_pm = int(raw_inv.get("bucketHash", 0)) == BUCKET_POSTMASTER
            loc = "postmaster" if is_pm else "character"
            enriched = _enrich_item(raw_inv, defs, instances, stats_map, sockets_map, reusable_map, loc, cid, False)
            if enriched:
                if enriched.get("category") == "Artifact":
                    enriched["activePerks"] = _resolve_artifact_perks_for_item(enriched, cid)
                    enriched["powerBonus"] = char_artifact_prog.get(cid, {}).get("powerBonus") or art_power_bonus or 1
                    enriched["pointsAcquired"] = char_artifact_prog.get(cid, {}).get("pointsAcquired") or art_points or len(enriched["activePerks"])
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
            "artifact": equipped_artifact,
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
            if enriched.get("category") == "Artifact":
                enriched["activePerks"] = _resolve_artifact_perks_for_item(enriched)
                enriched["powerBonus"] = art_power_bonus or 1
                enriched["pointsAcquired"] = art_points or len(enriched["activePerks"])
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
            ld_artifact = None
            ld_art_plug_hashes: List[int] = []
            exotic_armor = None
            exotic_weapon = None
            missing_count = 0

            # Gather any artifact plug hashes saved across this loadout's items
            for li_k in ld_items:
                for ph_k in li_k.get("plugItemHashes", []) or []:
                    pdef_k = defs.get(int(ph_k))
                    if pdef_k and (pdef_k.get("itemTypeDisplayName") == "Artifact Perk" or pdef_k.get("plugCategoryIdentifier") == "artifact_perks" or int(ph_k) in active_perk_hashes):
                        ld_art_plug_hashes.append(int(ph_k))

            for li in active_refs:
                iid = str(li.get("itemInstanceId", ""))
                li_plugs = li.get("plugItemHashes", []) or []
                if iid in subclass_by_instance:
                    sub_base = subclass_by_instance[iid]
                    sub_custom = _parse_subclass_details(iid, li_plugs, defs, sockets_map) if li_plugs else sub_base
                    ld_subclass = {**sub_base, **sub_custom}
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
                        "gearTier": g.get("gearTier"),
                    }
                    if g["category"] == "Weapon":
                        ld_weapons.append(slim_g)
                        if g["isExotic"] and not exotic_weapon:
                            exotic_weapon = slim_g
                    elif g["category"] == "Armor":
                        armor_mods = _extract_armor_mods(iid, li_plugs, defs, sockets_map)
                        slim_g["mods"] = armor_mods
                        ld_armor.append(slim_g)
                        if g["isExotic"] and not exotic_armor:
                            exotic_armor = slim_g
                    elif g["category"] == "Artifact":
                        ld_artifact = dict(g)
                else:
                    missing_count += 1

            ld_weapons.sort(key=lambda w: weapon_slot_order.get(w["slot"], 99))
            ld_armor.sort(key=lambda a: armor_slot_order.get(a["slot"], 99))

            final_art = dict(ld_artifact) if ld_artifact else (dict(ch_obj["artifact"]) if ch_obj.get("artifact") else None)
            if final_art:
                final_art["activePerks"] = _resolve_artifact_perks_for_item(
                    final_art,
                    cid,
                    saved_plug_hashes=ld_art_plug_hashes or None,
                )

            saved_lds.append({
                "loadoutIndex": idx,
                "slotNumber": idx + 1,
                "name": ld_name,
                "iconPath": ld_icon,
                "colorPath": ld_color,
                "subclass": ld_subclass,
                "artifact": final_art,
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


def prepare_items_for_dismantle(
    access_token: str,
    membership_type: int,
    default_character_id: str,
    items_to_prep: List[dict],
    target_character_id: str = "",
    unlock_only: bool = False,
) -> dict:
    """Unlocks selected weaker duplicates / trash rolls and optionally pulls them to a character's open weapon slots for fast in-game dismantling."""
    creds = get_bungie_credentials()
    api_key = creds["api_key"]
    if not api_key:
        raise RuntimeError("Bungie API Key is not configured.")
    if not items_to_prep:
        return {
            "status": "ok",
            "unlockedIds": [],
            "pulledIds": [],
            "alreadyOnCharIds": [],
            "skippedFullSlotIds": [],
            "failed": [],
        }

    # Probe live free bag slots (max 9 unequipped per weapon / armor slot) if pulling to character
    free_slots: Dict[str, int] = {
        "Kinetic": 9,
        "Energy": 9,
        "Heavy": 9,
        "Helmet": 9,
        "Gauntlets": 9,
        "Chest Armor": 9,
        "Leg Armor": 9,
        "Class Armor": 9,
    }
    if not unlock_only and target_character_id:
        membership = get_active_destiny_membership(api_key, access_token)
        m_id = membership["destinyMembershipId"]
        inv_resp = _bungie_get(
            f"/Destiny2/{int(membership_type)}/Profile/{m_id}/?components=201",
            api_key,
            access_token,
        )
        char_bag = inv_resp.get("characterInventories", {}).get("data", {}).get(str(target_character_id), {}).get("items", [])
        counts: Dict[str, int] = {k: 0 for k in free_slots}
        for raw_it in char_bag:
            bhash = int(raw_it.get("bucketHash", 0))
            if bhash in WEAPON_BUCKETS:
                counts[WEAPON_BUCKETS[bhash]] += 1
            elif bhash in ARMOR_BUCKETS:
                counts[ARMOR_BUCKETS[bhash]] += 1
        for s_name in free_slots:
            free_slots[s_name] = max(0, 9 - counts[s_name])

    unlocked_ids: List[str] = []
    pulled_ids: List[str] = []
    already_on_char_ids: List[str] = []
    skipped_full_ids: List[str] = []
    failed: List[dict] = []

    for idx, entry in enumerate(items_to_prep):
        iid = str(entry.get("itemInstanceId", ""))
        ihash = int(entry.get("itemHash", 0))
        src_loc = str(entry.get("sourceLocation", "vault"))
        src_cid = str(entry.get("sourceCharacterId") or "")
        slot_name = str(entry.get("slot", "Kinetic"))
        was_locked = bool(entry.get("isLocked", False))
        is_eq = bool(entry.get("isEquipped", False))
        nm = str(entry.get("name", "Weapon"))
        lock_cid = src_cid or target_character_id or default_character_id

        if not iid or is_eq or src_loc == "postmaster":
            continue

        try:
            # Step 1: Ensure item is UNLOCKED in Destiny 2 so the player can hold Dismantle immediately
            if was_locked and lock_cid:
                _bungie_post(
                    "/Destiny2/Actions/Items/SetLockState/",
                    {
                        "state": False,
                        "itemId": iid,
                        "characterId": lock_cid,
                        "membershipType": int(membership_type),
                    },
                    api_key,
                    access_token,
                )
                unlocked_ids.append(iid)
            elif not was_locked:
                unlocked_ids.append(iid)

            # Step 2: Pull into target character's unequipped slot if requested & space permits
            if not unlock_only and target_character_id:
                if src_loc == "character" and src_cid == str(target_character_id):
                    already_on_char_ids.append(iid)
                elif free_slots.get(slot_name, 0) > 0:
                    transfer_guardian_item(
                        access_token=access_token,
                        membership_type=int(membership_type),
                        item_instance_id=iid,
                        item_hash=ihash,
                        source_location=src_loc,
                        source_character_id=src_cid,
                        target_type="character",
                        target_character_id=str(target_character_id),
                        is_equipped=False,
                    )
                    free_slots[slot_name] -= 1
                    pulled_ids.append(iid)
                else:
                    skipped_full_ids.append(iid)
        except PermissionError:
            if idx == 0:
                raise
            failed.append({"itemInstanceId": iid, "name": nm, "reason": "Bungie session expired."})
        except Exception as exc:
            failed.append({"itemInstanceId": iid, "name": nm, "reason": str(exc)})

    return {
        "status": "ok",
        "unlockedIds": unlocked_ids,
        "pulledIds": pulled_ids,
        "alreadyOnCharIds": already_on_char_ids,
        "skippedFullSlotIds": skipped_full_ids,
        "failed": failed,
    }


def _norm_text(s: str) -> str:
    s = re.sub(r"\(.*?\)", "", s or "")
    s = s.lower().replace("enhanced ", "").strip()
    return re.sub(r"[^a-z0-9]", "", s)


def _weapon_family_key(name: str) -> str:
    cleaned = re.sub(
        r"\((?:adept|timelost|harrowed|holofoil|baroque|damaged|curated)\)",
        "",
        name or "",
        flags=re.IGNORECASE,
    )
    return re.sub(r"[^a-z0-9]", "", cleaned.lower().strip())


def _is_adept_variant(name: str) -> bool:
    low = (name or "").lower()
    return any(tag in low for tag in ("(adept)", "(timelost)", "(harrowed)", "(holofoil)", "(baroque)"))


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

# Barrel, Magazine & Masterwork Tier Tables (used to compare duplicate God Rolls down to 5/5 perfection)
_PVE_BARREL_SCORES = {
    "arrowheadbrake": 13, "flutedbarrel": 13, "quicklaunch": 13, "hardlaunch": 13,
    "jaggededge": 13, "elasticstring": 13, "polymerstring": 12, "auxiliaryreserves": 12,
    "corkscrewrifling": 10, "smallbore": 10, "hammerforgedrifling": 9, "polygonalrifling": 9,
    "linearcompensator": 10, "volatilelaunch": 9, "temperededge": 10, "flexiblestring": 9,
    "smartdriftcontrol": 10, "ballisticstuning": 10, "chamberedcompensator": 7,
    "countermass": 8, "confinedlaunch": 7, "honededge": 8, "fullbore": 4, "smoothbore": 3,
}

_PVP_BARREL_SCORES = {
    "hammerforgedrifling": 13, "smallbore": 13, "corkscrewrifling": 12, "flutedbarrel": 13,
    "arrowheadbrake": 12, "elasticstring": 13, "ballisticstuning": 12, "extendedbarrel": 10,
    "polygonalrifling": 10, "chamberedcompensator": 9, "quicklaunch": 11, "volatilelaunch": 10,
    "polymerstring": 11, "jaggededge": 11, "fullbore": 9, "smoothbore": 3,
}

_PVE_MAG_SCORES = {
    "tacticalmag": 13, "flaredmagwell": 13, "appendedmag": 13, "spikegrenades": 13,
    "impactcasing": 13, "lightmag": 12, "acceleratedcoils": 13, "liquidcoils": 12,
    "swordmastersguard": 13, "compactarrowshaft": 12, "fiberglassarrowshaft": 12,
    "ricochetrounds": 10, "highcaliberrounds": 10, "armorpiercingrounds": 11,
    "alloymagazine": 10, "ionizedbattery": 11, "enhancedbattery": 11, "implosionrounds": 10,
    "highvelocityrounds": 10, "accurizedrounds": 9, "extendedmag": 6, "steadyrounds": 5,
}

_PVP_MAG_SCORES = {
    "ricochetrounds": 13, "accurizedrounds": 13, "highcaliberrounds": 12, "projectionfuse": 13,
    "assaultmag": 13, "fiberglassarrowshaft": 13, "highvelocityrounds": 12, "lightmag": 11,
    "flaredmagwell": 10, "tacticalmag": 9, "liquidcoils": 11, "blackpowder": 10,
    "compactarrowshaft": 10, "armorpiercingrounds": 9, "extendedmag": 4, "steadyrounds": 8,
}

_PVE_MW_SCORES = {
    "reloadspeed": 10, "handling": 9, "velocity": 9, "chargetime": 9, "drawtime": 9,
    "impact": 9, "range": 7, "stability": 7, "blastradius": 6, "shieldduration": 7,
}

_PVP_MW_SCORES = {
    "range": 10, "stability": 9, "handling": 9, "drawtime": 9, "chargetime": 9,
    "velocity": 9, "blastradius": 8, "reloadspeed": 6, "impact": 8,
}


def _pick_best_column_plug(
    col_opts: List[dict],
    tier_table: Dict[str, int],
    wanted_norms: Optional[List[str]] = None,
    default_pts: int = 6,
) -> Tuple[int, str]:
    if not col_opts:
        return 0, ""
    best_pts = -1
    best_name = ""
    wanted_set = set(wanted_norms or [])
    for opt in col_opts:
        nm = opt.get("name", "")
        if not nm:
            continue
        pn = _norm_text(nm)
        if wanted_set and pn in wanted_set:
            pts = 13 + (1 if wanted_norms and pn == wanted_norms[0] else 0)
        else:
            pts = tier_table.get(pn, default_pts)
        # Prefer already-selected option on exact score tie
        if pts > best_pts or (pts == best_pts and opt.get("selected")):
            best_pts = pts
            best_name = nm
    return max(0, best_pts), best_name


def _score_masterwork(mw_name: str, tier_table: Dict[str, int], wanted_norms: Optional[List[str]] = None) -> int:
    mw_norm = _norm_text(mw_name)
    if not mw_norm:
        return 0
    if wanted_norms and any(w in mw_norm or mw_norm in w for w in wanted_norms):
        return 10
    for key, pts in tier_table.items():
        if key in mw_norm:
            return pts
    return 5


def evaluate_item_against_godrolls(item: dict, god_rolls: List[dict]) -> dict:
    """Evaluates a weapon against My God Rolls (God Roll Finder DB) + F.E.L.I.C.I.A.'s 2-column Synergy Matrix with a 0-100 5/5 Roll Score."""
    raw_name = item.get("name", "")
    item_norm = _norm_text(raw_name)
    family_key = _weapon_family_key(raw_name)
    is_adept = _is_adept_variant(raw_name)

    matched_entry = None
    for gr in god_rolls:
        gr_norm = _norm_text(gr.get("name", ""))
        if gr_norm and (gr_norm == item_norm or gr_norm in item_norm or item_norm in gr_norm):
            matched_entry = gr
            break

    norm_to_display: Dict[str, str] = {}
    enhanced_norms: Set[str] = set()
    all_item_perk_norms: Set[str] = set()
    perk_cols = item.get("perkColumns", []) or []
    for col in perk_cols:
        for opt in col:
            pname = opt.get("name", "")
            if pname:
                pn = _norm_text(pname)
                all_item_perk_norms.add(pn)
                norm_to_display.setdefault(pn, pname)
                if opt.get("enhanced"):
                    enhanced_norms.add(pn)
    for ap in item.get("activePerks", []) or []:
        pname = ap.get("name", "")
        if pname:
            pn = _norm_text(pname)
            all_item_perk_norms.add(pn)
            norm_to_display.setdefault(pn, pname)

    mw_name = (item.get("masterwork") or {}).get("name", "")
    mw_norm = _norm_text(mw_name)

    if (item.get("isExotic") and not matched_entry) or item.get("category") != "Weapon":
        return {
            "weapon_family_key": family_key,
            "is_adept_variant": is_adept,
            "in_database": False,
            "match_source": "none",
            "entry": None,
            "pve_trait_hits": 0,
            "pvp_trait_hits": 0,
            "pve_matches": [],
            "pve_matched_perks": [],
            "pvp_matches": [],
            "pvp_matched_perks": [],
            "pve_score": 0,
            "pvp_score": 0,
            "best_score": 0,
            "pve_sort_score": 0.0,
            "pvp_sort_score": 0.0,
            "best_barrel": "",
            "best_mag": "",
            "masterwork_name": mw_name,
            "enhanced_trait_count": 0,
            "verdict_code": "EXOTIC" if item.get("isExotic") else "AI_EVAL",
        }

    # Resolve Barrel, Mag, and Trait columns
    t_indexes = item.get("traitColIndexes") or []
    trait_cols = [perk_cols[i] for i in t_indexes if 0 <= i < len(perk_cols)]
    if len(trait_cols) < 2 and len(perk_cols) >= 4:
        trait_cols = perk_cols[2:4]

    b_idx = item.get("barrelColIndex")
    if b_idx is None and len(perk_cols) >= 4 and 0 not in t_indexes:
        b_idx = 0
    m_idx = item.get("magColIndex")
    if m_idx is None and len(perk_cols) >= 4 and 1 not in t_indexes:
        m_idx = 1

    barrel_col = perk_cols[b_idx] if (b_idx is not None and 0 <= b_idx < len(perk_cols)) else []
    mag_col = perk_cols[m_idx] if (m_idx is not None and 0 <= m_idx < len(perk_cols)) else []

    # Compute F.E.L.I.C.I.A. 2-Column Combat Trait Synergy + single-trait hits
    pve_pair: List[str] = []
    pvp_pair: List[str] = []
    single_pve_hit: List[str] = []
    single_pvp_hit: List[str] = []
    extra_trait_opts = 0

    if not item.get("isExotic") and len(trait_cols) >= 2:
        col_a = [(_norm_text(o.get("name", "")), o.get("name", "")) for o in trait_cols[0] if o.get("name")]
        col_b = [(_norm_text(o.get("name", "")), o.get("name", "")) for o in trait_cols[1] if o.get("name")]
        extra_trait_opts = max(0, (len(col_a) - 1) + (len(col_b) - 1))

        for na, da in col_a:
            if not single_pve_hit and (na in _PVE_SETUP_TRAITS or na in _PVE_PAYOFF_TRAITS):
                single_pve_hit = [da]
            if not single_pvp_hit and (na in _PVP_CONSISTENCY_TRAITS or na in _PVP_LETHALITY_TRAITS):
                single_pvp_hit = [da]
            for nb, db in col_b:
                if not single_pve_hit and (nb in _PVE_SETUP_TRAITS or nb in _PVE_PAYOFF_TRAITS):
                    single_pve_hit = [db]
                if not single_pvp_hit and (nb in _PVP_CONSISTENCY_TRAITS or nb in _PVP_LETHALITY_TRAITS):
                    single_pvp_hit = [db]
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

    pve_db_spec = (matched_entry or {}).get("pve", {}) if matched_entry else {}
    pvp_db_spec = (matched_entry or {}).get("pvp", {}) if matched_entry else {}

    pve_traits = 0
    pvp_traits = 0
    pve_bonus = 0
    pvp_bonus = 0
    pve_matches: List[str] = []
    pvp_matches: List[str] = []
    pve_perk_names: List[str] = []
    pvp_perk_names: List[str] = []
    pve_primary_rank_bonus = 0
    pvp_primary_rank_bonus = 0
    used_db = False

    if matched_entry:
        def _score_db_mode(mode_spec: dict) -> Tuple[int, int, int, List[str], List[str]]:
            t_hits = 0
            b_hits = 0
            pri_bonus = 0
            m_labels: List[str] = []
            m_perks: List[str] = []

            for key, label in [("perk1", "Trait 1"), ("perk2", "Trait 2")]:
                wanted = _split_godroll_options(mode_spec.get(key, ""))
                hit_idx = next((idx for idx, w in enumerate(wanted) if w in all_item_perk_norms), None)
                if hit_idx is not None:
                    w = wanted[hit_idx]
                    t_hits += 1
                    if hit_idx == 0:
                        pri_bonus += 1
                    m_labels.append(f"{label}: {mode_spec.get(key)}")
                    m_perks.append(norm_to_display.get(w, mode_spec.get(key, "")))

            for key, label in [("barrel", "Barrel"), ("mag", "Magazine")]:
                wanted = _split_godroll_options(mode_spec.get(key, ""))
                hit = next((w for w in wanted if w in all_item_perk_norms), None)
                if hit:
                    b_hits += 1
                    m_labels.append(f"{label}: {mode_spec.get(key)}")

            wanted_mw = _split_godroll_options(mode_spec.get("masterwork", ""))
            if mw_norm and any(w in mw_norm or mw_norm in w for w in wanted_mw):
                b_hits += 1
                m_labels.append(f"MW: {mode_spec.get('masterwork')}")

            return t_hits, b_hits, pri_bonus, m_labels, m_perks

        pve_traits, pve_bonus, pve_primary_rank_bonus, pve_matches, pve_perk_names = _score_db_mode(pve_db_spec)
        pvp_traits, pvp_bonus, pvp_primary_rank_bonus, pvp_matches, pvp_perk_names = _score_db_mode(pvp_db_spec)
        used_db = (pve_traits == 2) or (pvp_traits == 2)

        if pve_traits < 2 and pve_pair:
            pve_traits = 2
            pve_perk_names = pve_pair
            pve_matches = [f"Synergy: {' + '.join(pve_pair)}"]
        if pvp_traits < 2 and pvp_pair:
            pvp_traits = 2
            pvp_perk_names = pvp_pair
            pvp_matches = [f"Synergy: {' + '.join(pvp_pair)}"]
    else:
        pve_traits = 2 if pve_pair else (1 if single_pve_hit else 0)
        pvp_traits = 2 if pvp_pair else (1 if single_pvp_hit else 0)
        pve_perk_names = pve_pair if pve_pair else single_pve_hit
        pvp_perk_names = pvp_pair if pvp_pair else single_pvp_hit
        pve_matches = [f"Synergy: {' + '.join(pve_pair)}"] if pve_pair else []
        pvp_matches = [f"Synergy: {' + '.join(pvp_pair)}"] if pvp_pair else []

    if pve_traits == 2 and pvp_traits == 2:
        verdict = "DUAL_GOD_ROLL"
    elif pve_traits == 2:
        verdict = "PVE_GOD_ROLL"
    elif pvp_traits == 2:
        verdict = "PVP_GOD_ROLL"
    elif pve_traits == 1 or pvp_traits == 1:
        verdict = "SOLID_KEEP" if matched_entry else "AI_EVAL"
    else:
        verdict = "SHARD_CANDIDATE" if matched_entry else "AI_EVAL"

    # Compute 5/5 Roll Quality Scores (0-100 display + exact float tie-breaker)
    stats_lookup = {s["name"]: int(s["value"]) for s in (item.get("stats") or []) if "name" in s and "value" in s}
    pve_stat_sum = (
        stats_lookup.get("Reload Speed", 0) * 1.15
        + stats_lookup.get("Handling", 0) * 1.1
        + stats_lookup.get("Stability", 0) * 0.85
        + stats_lookup.get("Range", 0) * 0.8
        + stats_lookup.get("Velocity", 0) * 0.9
    )
    pvp_stat_sum = (
        stats_lookup.get("Range", 0) * 1.25
        + stats_lookup.get("Stability", 0) * 1.05
        + stats_lookup.get("Handling", 0) * 1.1
        + stats_lookup.get("Aim Assistance", 0) * 0.7
    )

    pve_b_pts, pve_barrel_name = _pick_best_column_plug(
        barrel_col, _PVE_BARREL_SCORES, _split_godroll_options(pve_db_spec.get("barrel", ""))
    )
    pvp_b_pts, pvp_barrel_name = _pick_best_column_plug(
        barrel_col, _PVP_BARREL_SCORES, _split_godroll_options(pvp_db_spec.get("barrel", ""))
    )
    pve_m_pts, pve_mag_name = _pick_best_column_plug(
        mag_col, _PVE_MAG_SCORES, _split_godroll_options(pve_db_spec.get("mag", ""))
    )
    pvp_m_pts, pvp_mag_name = _pick_best_column_plug(
        mag_col, _PVP_MAG_SCORES, _split_godroll_options(pvp_db_spec.get("mag", ""))
    )
    pve_mw_pts = _score_masterwork(mw_name, _PVE_MW_SCORES, _split_godroll_options(pve_db_spec.get("masterwork", "")))
    pvp_mw_pts = _score_masterwork(mw_name, _PVP_MW_SCORES, _split_godroll_options(pvp_db_spec.get("masterwork", "")))

    pve_enh_cnt = sum(1 for p in pve_perk_names if _norm_text(p) in enhanced_norms)
    pvp_enh_cnt = sum(1 for p in pvp_perk_names if _norm_text(p) in enhanced_norms)
    max_enh_cnt = max(pve_enh_cnt, pvp_enh_cnt)

    def _calc_total_score(
        trait_cnt: int,
        db_matched: bool,
        pri_rank_bonus: int,
        enh_cnt: int,
        barrel_pts: int,
        mag_pts: int,
        mw_pts: int,
        stat_weighted: float,
    ) -> Tuple[int, float]:
        base = 50.0 if trait_cnt == 2 else (24.0 if trait_cnt == 1 else 6.0)
        if trait_cnt == 2 and db_matched:
            base += 3.0 + float(pri_rank_bonus)  # up to +5 for primary Clan God Roll Finder match
        invest = min(9.0, (5.0 if item.get("isCrafted") else 0.0) + enh_cnt * 2.5)
        adept_pts = 4.0 if is_adept else 0.0
        mw_tier_pts = 2.0 if item.get("isMasterworked") else 0.0
        flex_pts = min(3.0, (2.0 if verdict == "DUAL_GOD_ROLL" else 0.0) + min(1.5, extra_trait_opts * 0.5))
        stat_bonus = min(4.0, stat_weighted / 95.0)
        pwr_tie = float(item.get("power") or 0) * 0.0001
        raw_total = base + barrel_pts + mag_pts + mw_pts + invest + adept_pts + mw_tier_pts + flex_pts + stat_bonus + pwr_tie
        disp = max(1, min(100, int(round(raw_total))))
        return disp, round(raw_total, 4)

    pve_disp, pve_sort = _calc_total_score(
        pve_traits,
        bool(matched_entry and len(_split_godroll_options(pve_db_spec.get("perk1", ""))) > 0 and used_db),
        pve_primary_rank_bonus,
        pve_enh_cnt,
        pve_b_pts,
        pve_m_pts,
        pve_mw_pts,
        pve_stat_sum,
    )
    pvp_disp, pvp_sort = _calc_total_score(
        pvp_traits,
        bool(matched_entry and len(_split_godroll_options(pvp_db_spec.get("perk1", ""))) > 0 and used_db),
        pvp_primary_rank_bonus,
        pvp_enh_cnt,
        pvp_b_pts,
        pvp_m_pts,
        pvp_mw_pts,
        pvp_stat_sum,
    )

    primary_barrel = pve_barrel_name if pve_sort >= pvp_sort else pvp_barrel_name
    primary_mag = pve_mag_name if pve_sort >= pvp_sort else pvp_mag_name

    return {
        "weapon_family_key": family_key,
        "is_adept_variant": is_adept,
        "in_database": used_db,
        "match_source": (
            "database"
            if used_db
            else ("felicia_ai" if verdict in ("DUAL_GOD_ROLL", "PVE_GOD_ROLL", "PVP_GOD_ROLL") else ("database" if matched_entry else "none"))
        ),
        "entry": matched_entry,
        "pve_trait_hits": pve_traits,
        "pve_bonus_hits": pve_bonus,
        "pve_matches": pve_matches,
        "pve_matched_perks": pve_perk_names,
        "pvp_trait_hits": pvp_traits,
        "pvp_bonus_hits": pvp_bonus,
        "pvp_matches": pvp_matches,
        "pvp_matched_perks": pvp_perk_names,
        "pve_score": pve_disp,
        "pvp_score": pvp_disp,
        "best_score": max(pve_disp, pvp_disp),
        "pve_sort_score": pve_sort,
        "pvp_sort_score": pvp_sort,
        "best_barrel": primary_barrel,
        "best_barrel_pve": pve_barrel_name,
        "best_barrel_pvp": pvp_barrel_name,
        "best_mag": primary_mag,
        "best_mag_pve": pve_mag_name,
        "best_mag_pvp": pvp_mag_name,
        "masterwork_name": mw_name,
        "enhanced_trait_count": max_enh_cnt,
        "verdict_code": verdict,
    }


def _describe_roll_advantage(winner: dict, loser: dict, mode: str) -> str:
    """Explains cleanly in Destiny 2 terms why `winner` outranks `loser` for `mode` ('pve' or 'pvp')."""
    w_gr = winner.get("godRollCheck", {})
    l_gr = loser.get("godRollCheck", {})
    reasons: List[str] = []

    if winner.get("isCrafted") and not loser.get("isCrafted"):
        reasons.append("Crafted")
    if w_gr.get("isAdeptVariant") and not l_gr.get("isAdeptVariant"):
        reasons.append("Adept Variant")
    if (w_gr.get("enhancedTraitCount") or 0) > (l_gr.get("enhancedTraitCount") or 0):
        reasons.append("Enhanced Perks")
    if w_gr.get("verdictCode") == "DUAL_GOD_ROLL" and l_gr.get("verdictCode") != "DUAL_GOD_ROLL":
        reasons.append("Covers PVE + PVP")

    b_key = "bestBarrelPve" if mode == "pve" else "bestBarrelPvp"
    m_key = "bestMagPve" if mode == "pve" else "bestMagPvp"
    p_key = "pveMatchedPerks" if mode == "pve" else "pvpMatchedPerks"

    w_perks = " + ".join(w_gr.get(p_key) or [])
    l_perks = " + ".join(l_gr.get(p_key) or [])
    if w_perks and l_perks and w_perks != l_perks:
        reasons.append(f"Traits ({w_perks})")

    w_b = w_gr.get(b_key) or w_gr.get("bestBarrel") or ""
    l_b = l_gr.get(b_key) or l_gr.get("bestBarrel") or ""
    if w_b and w_b != l_b:
        reasons.append(f"Barrel ({w_b})")

    w_m = w_gr.get(m_key) or w_gr.get("bestMag") or ""
    l_m = l_gr.get(m_key) or l_gr.get("bestMag") or ""
    if w_m and w_m != l_m:
        reasons.append(f"Mag ({w_m})")

    w_mw = w_gr.get("masterworkName") or ""
    l_mw = l_gr.get("masterworkName") or ""
    if w_mw and w_mw != l_mw:
        reasons.append(f"{w_mw} MW")

    if not reasons:
        w_stats = {s["name"]: int(s["value"]) for s in (winner.get("stats") or [])}
        l_stats = {s["name"]: int(s["value"]) for s in (loser.get("stats") or [])}
        stat_diffs = []
        for st_name in ("Range", "Handling", "Reload Speed", "Stability", "Velocity"):
            diff = w_stats.get(st_name, 0) - l_stats.get(st_name, 0)
            if diff > 0:
                stat_diffs.append(f"+{diff} {st_name}")
        if stat_diffs:
            reasons.append(", ".join(stat_diffs[:2]))
        elif winner.get("isMasterworked") and not loser.get("isMasterworked"):
            reasons.append("Masterworked")
        elif (winner.get("power") or 0) > (loser.get("power") or 0):
            reasons.append(f"Higher Power ({winner.get('power')})")
        else:
            reasons.append("Tied Roll Package")

    return ", ".join(reasons[:3])


def analyze_arsenal_duplicates_and_trash(inventory_data: dict, god_rolls: List[dict]) -> None:
    """Evaluates every weapon across Characters + Vault, crowns #1 Best per weapon/mode, flags weaker duplicates, and marks safe dismantle candidates."""
    saved_loadout_ids: Set[str] = set()
    all_weapons: List[dict] = []
    seen_iids: Set[str] = set()

    for ch in inventory_data.get("characters", []) or []:
        for ld in ch.get("loadouts", []) or []:
            for w in ld.get("weapons", []) or []:
                if w.get("itemInstanceId"):
                    saved_loadout_ids.add(str(w["itemInstanceId"]))
            for a in ld.get("armor", []) or []:
                if a.get("itemInstanceId"):
                    saved_loadout_ids.add(str(a["itemInstanceId"]))

        for bucket_list in (ch.get("equipment", []), ch.get("inventory", []), ch.get("postmaster", [])):
            for it in bucket_list or []:
                if it.get("category") == "Weapon":
                    iid = str(it.get("itemInstanceId") or id(it))
                    if iid not in seen_iids:
                        seen_iids.add(iid)
                        all_weapons.append(it)

    for it in (inventory_data.get("vault") or {}).get("items", []) or []:
        if it.get("category") == "Weapon":
            iid = str(it.get("itemInstanceId") or id(it))
            if iid not in seen_iids:
                seen_iids.add(iid)
                all_weapons.append(it)

    max_power_by_slot: Dict[str, int] = {"Kinetic": 0, "Energy": 0, "Heavy": 0}
    for w in all_weapons:
        sl = w.get("slot", "")
        pw = int(w.get("power") or 0)
        if sl in max_power_by_slot and pw > max_power_by_slot[sl]:
            max_power_by_slot[sl] = pw

    families: Dict[str, List[dict]] = {}
    for w in all_weapons:
        ev = evaluate_item_against_godrolls(w, god_rolls)
        in_ld = str(w.get("itemInstanceId", "")) in saved_loadout_ids
        sl = w.get("slot", "")
        is_top_pwr = bool(sl in max_power_by_slot and max_power_by_slot[sl] > 0 and int(w.get("power") or 0) >= max_power_by_slot[sl])

        w["godRollCheck"] = {
            "weaponFamilyKey": ev["weapon_family_key"],
            "isAdeptVariant": ev["is_adept_variant"],
            "inDatabase": ev["in_database"],
            "matchSource": ev.get("match_source", "none"),
            "verdictCode": ev["verdict_code"],
            "pveTraitHits": ev.get("pve_trait_hits", 0),
            "pvpTraitHits": ev.get("pvp_trait_hits", 0),
            "pveMatchedPerks": ev.get("pve_matched_perks", []),
            "pvpMatchedPerks": ev.get("pvp_matched_perks", []),
            "pveScore": ev.get("pve_score", 0),
            "pvpScore": ev.get("pvp_score", 0),
            "bestScore": ev.get("best_score", 0),
            "pveSortScore": ev.get("pve_sort_score", 0.0),
            "pvpSortScore": ev.get("pvp_sort_score", 0.0),
            "bestBarrel": ev.get("best_barrel", ""),
            "bestBarrelPve": ev.get("best_barrel_pve", ""),
            "bestBarrelPvp": ev.get("best_barrel_pvp", ""),
            "bestMag": ev.get("best_mag", ""),
            "bestMagPve": ev.get("best_mag_pve", ""),
            "bestMagPvp": ev.get("best_mag_pvp", ""),
            "masterworkName": ev.get("masterwork_name", ""),
            "enhancedTraitCount": ev.get("enhanced_trait_count", 0),
            "familyTotalCopies": 1,
            "familyGodRollCount": 0,
            "isBestGodRoll": False,
            "isBestPve": False,
            "isBestPvp": False,
            "isOutclassedDuplicate": False,
            "duplicateRank": 0,
            "comparisonSummary": "",
            "outclassedByInstanceId": "",
            "beatenDuplicateIds": [],
            "inSavedLoadout": in_ld,
            "isHighestPowerInSlot": is_top_pwr,
            "dismantleCandidate": False,
            "dismantleTier": "",
            "dismantleLabel": "",
            "dismantleReason": "",
            "dismantleAutoSelect": False,
        }
        fkey = ev["weapon_family_key"] or str(w.get("itemHash", ""))
        families.setdefault(fkey, []).append(w)

    # Head-to-head comparison per weapon family
    for fkey, fam_items in families.items():
        total_copies = len(fam_items)
        god_copies = [
            it for it in fam_items
            if it["godRollCheck"]["verdictCode"] in ("DUAL_GOD_ROLL", "PVE_GOD_ROLL", "PVP_GOD_ROLL")
        ]
        pve_gods = [
            it for it in god_copies
            if it["godRollCheck"]["verdictCode"] in ("DUAL_GOD_ROLL", "PVE_GOD_ROLL")
        ]
        pvp_gods = [
            it for it in god_copies
            if it["godRollCheck"]["verdictCode"] in ("DUAL_GOD_ROLL", "PVP_GOD_ROLL")
        ]

        pve_gods.sort(
            key=lambda x: (
                float(x["godRollCheck"]["pveSortScore"]),
                1 if x.get("isCrafted") else 0,
                1 if x.get("isMasterworked") else 0,
                1 if x.get("isLocked") else 0,
                1 if x.get("isEquipped") else 0,
                int(x.get("power") or 0),
                str(x.get("itemInstanceId") or ""),
            ),
            reverse=True,
        )
        pvp_gods.sort(
            key=lambda x: (
                float(x["godRollCheck"]["pvpSortScore"]),
                1 if x.get("isCrafted") else 0,
                1 if x.get("isMasterworked") else 0,
                1 if x.get("isLocked") else 0,
                1 if x.get("isEquipped") else 0,
                int(x.get("power") or 0),
                str(x.get("itemInstanceId") or ""),
            ),
            reverse=True,
        )

        pve_winner = pve_gods[0] if pve_gods else None
        pvp_winner = pvp_gods[0] if pvp_gods else None

        if pve_winner:
            pve_winner["godRollCheck"]["isBestPve"] = True
            pve_winner["godRollCheck"]["isBestGodRoll"] = True
            pve_winner["godRollCheck"]["duplicateRank"] = 1
        if pvp_winner:
            pvp_winner["godRollCheck"]["isBestPvp"] = True
            pvp_winner["godRollCheck"]["isBestGodRoll"] = True
            pvp_winner["godRollCheck"]["duplicateRank"] = 1

        outclassed_gods = [it for it in god_copies if not it["godRollCheck"]["isBestGodRoll"]]

        for it in fam_items:
            grc = it["godRollCheck"]
            grc["familyTotalCopies"] = total_copies
            grc["familyGodRollCount"] = len(god_copies)

        # Annotate #1 winners & outclassed duplicate God Rolls with clear comparison reasons
        if len(god_copies) > 1:
            for loser in outclassed_gods:
                l_grc = loser["godRollCheck"]
                l_grc["isOutclassedDuplicate"] = True
                if l_grc["verdictCode"] in ("PVE_GOD_ROLL", "DUAL_GOD_ROLL") and pve_winner:
                    rank_idx = pve_gods.index(loser) + 1
                    l_grc["duplicateRank"] = rank_idx
                    l_grc["outclassedByInstanceId"] = str(pve_winner.get("itemInstanceId", ""))
                    adv = _describe_roll_advantage(pve_winner, loser, "pve")
                    l_grc["comparisonSummary"] = (
                        f"#{rank_idx} of {len(pve_gods)} PVE rolls ({l_grc['pveScore']} vs {pve_winner['godRollCheck']['pveScore']} pts) "
                        f"— Outclassed by #1 ({adv})"
                    )
                    if str(loser.get("itemInstanceId", "")) not in pve_winner["godRollCheck"]["beatenDuplicateIds"]:
                        pve_winner["godRollCheck"]["beatenDuplicateIds"].append(str(loser.get("itemInstanceId", "")))
                elif pvp_winner:
                    rank_idx = pvp_gods.index(loser) + 1
                    l_grc["duplicateRank"] = rank_idx
                    l_grc["outclassedByInstanceId"] = str(pvp_winner.get("itemInstanceId", ""))
                    adv = _describe_roll_advantage(pvp_winner, loser, "pvp")
                    l_grc["comparisonSummary"] = (
                        f"#{rank_idx} of {len(pvp_gods)} PVP rolls ({l_grc['pvpScore']} vs {pvp_winner['godRollCheck']['pvpScore']} pts) "
                        f"— Outclassed by #1 ({adv})"
                    )
                    if str(loser.get("itemInstanceId", "")) not in pvp_winner["godRollCheck"]["beatenDuplicateIds"]:
                        pvp_winner["godRollCheck"]["beatenDuplicateIds"].append(str(loser.get("itemInstanceId", "")))

            if pve_winner and len(pve_gods) > 1:
                runner_up = pve_gods[1]
                adv = _describe_roll_advantage(pve_winner, runner_up, "pve")
                pve_winner["godRollCheck"]["comparisonSummary"] = (
                    f"#1 Best of {len(pve_gods)} PVE God Rolls ({pve_winner['godRollCheck']['pveScore']} vs {runner_up['godRollCheck']['pveScore']} pts) "
                    f"— Wins via {adv}"
                )
            if pvp_winner and len(pvp_gods) > 1 and (pvp_winner is not pve_winner or not pve_winner["godRollCheck"]["comparisonSummary"]):
                runner_up = pvp_gods[1]
                adv = _describe_roll_advantage(pvp_winner, runner_up, "pvp")
                pvp_winner["godRollCheck"]["comparisonSummary"] = (
                    f"#1 Best of {len(pvp_gods)} PVP God Rolls ({pvp_winner['godRollCheck']['pvpScore']} vs {runner_up['godRollCheck']['pvpScore']} pts) "
                    f"— Wins via {adv}"
                )
            # If 1 PVE winner + 1 distinct PVP winner exist on the same weapon, explain why BOTH are kept!
            if pve_winner and pvp_winner and pve_winner is not pvp_winner:
                if not pve_winner["godRollCheck"]["comparisonSummary"]:
                    pve_winner["godRollCheck"]["comparisonSummary"] = (
                        f"#1 PVE Roll ({pve_winner['godRollCheck']['pveScore']}/100) — Paired alongside your separate #1 PVP copy"
                    )
                if not pvp_winner["godRollCheck"]["comparisonSummary"]:
                    pvp_winner["godRollCheck"]["comparisonSummary"] = (
                        f"#1 PVP Roll ({pvp_winner['godRollCheck']['pvpScore']}/100) — Paired alongside your separate #1 PVE copy"
                    )

        # Classify safe Dismantle Candidates across this weapon family
        has_any_god = len(god_copies) > 0
        for it in fam_items:
            grc = it["godRollCheck"]
            if (
                grc["isBestGodRoll"]
                or it.get("isExotic")
                or it.get("isCrafted")
                or it.get("isEquipped")
                or grc["inSavedLoadout"]
                or it.get("location") == "postmaster"
            ):
                continue

            if grc["isOutclassedDuplicate"]:
                grc["dismantleCandidate"] = True
                grc["dismantleTier"] = "OUTCLASSED_GOD_ROLL"
                grc["dismantleLabel"] = "Outclassed Duplicate God Roll"
                grc["dismantleReason"] = grc["comparisonSummary"] or "Outclassed by your #1 Best God Roll of this weapon."
                grc["dismantleAutoSelect"] = not grc["isHighestPowerInSlot"]
            elif has_any_god:
                grc["dismantleCandidate"] = True
                grc["dismantleTier"] = "EXTRA_COPY_OWNED_GOD_ROLL"
                grc["dismantleLabel"] = "Inferior Copy (Own #1 God Roll)"
                grc["dismantleReason"] = f"You already own a #1 God Roll of {it.get('name')} — safe extra copy to dismantle."
                grc["dismantleAutoSelect"] = (not grc["isHighestPowerInSlot"]) and (not it.get("isLocked"))
            elif grc["pveTraitHits"] == 0 and grc["pvpTraitHits"] == 0:
                grc["dismantleCandidate"] = True
                grc["dismantleTier"] = "BAD_ROLL"
                grc["dismantleLabel"] = "Bad Roll (0/2 Meta Perks)"
                grc["dismantleReason"] = "Misses PVE & PVP God Roll trait synergy."
                grc["dismantleAutoSelect"] = False

    # =========================================================================
    # ARMOR APPRAISAL: TIER 5 STANDARDS, ZERO-HEALTH PVE vs PVP, & COMPENDIUM SETS
    # =========================================================================
    all_armor: List[dict] = []
    seen_armor_iids: Set[str] = set()

    for ch in inventory_data.get("characters", []) or []:
        for bucket_list in (ch.get("equipment", []), ch.get("inventory", []), ch.get("postmaster", [])):
            for it in bucket_list or []:
                if it.get("category") == "Armor":
                    iid = str(it.get("itemInstanceId") or id(it))
                    if iid not in seen_armor_iids:
                        seen_armor_iids.add(iid)
                        all_armor.append(it)

    for it in (inventory_data.get("vault") or {}).get("items", []) or []:
        if it.get("category") == "Armor":
            iid = str(it.get("itemInstanceId") or id(it))
            if iid not in seen_armor_iids:
                seen_armor_iids.add(iid)
                all_armor.append(it)

    armor_families: Dict[str, List[dict]] = {}
    for a in all_armor:
        ev = evaluate_armor_roll(a)
        in_ld = str(a.get("itemInstanceId", "")) in saved_loadout_ids
        a["armorEvaluation"] = ev
        if ev.get("compendiumSet"):
            a["compendiumSet"] = ev["compendiumSet"]

        verdict_code = ev["verdictCode"]
        is_tier_5 = ev["isTier5"]
        is_pve = (verdict_code == "PVE_GOD_ROLL")
        is_pvp = (verdict_code == "PVP_GOD_ROLL")

        fam_key = (
            f"{a.get('classType')}_{a.get('slot')}_"
            f"{ev.get('compendiumSet', {}).get('name') if ev.get('compendiumSet') else a.get('name')}"
        )

        a["godRollCheck"] = {
            "weaponFamilyKey": fam_key,
            "isAdeptVariant": "artifice" in a.get("name", "").lower(),
            "inDatabase": bool(ev.get("compendiumSet")),
            "matchSource": "compendium_sets" if ev.get("compendiumSet") else "armor_stat_matrix",
            "verdictCode": verdict_code,
            "verdictLabel": ev["verdictLabel"],
            "pveTraitHits": 2 if (is_pve and ev["healthStat"] <= 2) else (1 if is_pve else 0),
            "pvpTraitHits": 2 if is_pvp else (0 if not is_tier_5 else 1),
            "pveScore": (98 if ev["healthStat"] <= 2 else 85) if is_pve else (50 if is_tier_5 else 20),
            "pvpScore": (90 + min(ev["healthStat"], 10)) if is_pvp else (30 if is_tier_5 else 10),
            "bestScore": 98 if (is_pve and ev["healthStat"] <= 2) else (95 if is_pvp else (85 if is_pve else 20)),
            "pveSortScore": float(a.get("totalStats") or 0) - float(ev["healthStat"]) * 0.5,
            "pvpSortScore": float(a.get("totalStats") or 0) + float(ev["healthStat"]) * 1.5,
            "familyTotalCopies": 1,
            "familyGodRollCount": 0,
            "isBestGodRoll": is_tier_5 and (ev["healthStat"] <= 2 or is_pvp),
            "isBestPve": is_pve and (ev["healthStat"] <= 2),
            "isBestPvp": is_pvp,
            "isOutclassedDuplicate": False,
            "duplicateRank": 1 if is_tier_5 else 0,
            "comparisonSummary": "",
            "inSavedLoadout": in_ld,
            "isHighestPowerInSlot": False,
            "dismantleCandidate": False,
            "dismantleTier": "",
            "dismantleLabel": "",
            "dismantleReason": "",
            "dismantleAutoSelect": False,
        }

        # Sub-Tier 5 armor is immediately a dismantle candidate!
        if not is_tier_5 and not in_ld and not a.get("isEquipped") and not a.get("isExotic") and a.get("location") != "postmaster":
            grc = a["godRollCheck"]
            grc["dismantleCandidate"] = True
            grc["dismantleTier"] = "SUB_TIER_5_ARMOR"
            grc["dismantleLabel"] = "Sub-Tier 5 Armor (<60 Stats)"
            grc["dismantleReason"] = f"Under Tier 5 standard ({ev['totalStats']} Total Stats) — safe to dismantle."
            grc["dismantleAutoSelect"] = not a.get("isLocked")

        armor_families.setdefault(fam_key, []).append(a)

    # Compare duplicates within each armor family
    for fam_key, fam_items in armor_families.items():
        total_copies = len(fam_items)
        tier5_items = [it for it in fam_items if it["armorEvaluation"]["isTier5"]]
        for it in fam_items:
            it["godRollCheck"]["familyTotalCopies"] = total_copies
            it["godRollCheck"]["familyGodRollCount"] = len(tier5_items)

        if len(tier5_items) > 1:
            pve_candidates = [it for it in tier5_items if it["armorEvaluation"]["rollType"] == "PVE_GOD_ROLL"]
            pvp_candidates = [it for it in tier5_items if it["armorEvaluation"]["rollType"] == "PVP_GOD_ROLL"]

            # Rank PVE: highest total stats, then lower health
            pve_candidates.sort(
                key=lambda x: (
                    int(x.get("totalStats") or 0),
                    -int(x["armorEvaluation"]["healthStat"]),
                    int(x.get("power") or 0),
                ),
                reverse=True,
            )
            if pve_candidates:
                pve_winner = pve_candidates[0]
                pve_winner["godRollCheck"]["isBestPve"] = True
                pve_winner["godRollCheck"]["isBestGodRoll"] = True
                pve_winner["godRollCheck"]["duplicateRank"] = 1
                for loser in pve_candidates[1:]:
                    l_grc = loser["godRollCheck"]
                    l_grc["isOutclassedDuplicate"] = True
                    l_grc["comparisonSummary"] = (
                        f"Outclassed by #1 PVE Roll ({pve_winner.get('totalStats')} vs {loser.get('totalStats')} stats, {pve_winner['armorEvaluation']['healthStat']} vs {loser['armorEvaluation']['healthStat']} Health)"
                    )
                    if not loser.get("isEquipped") and not l_grc["inSavedLoadout"] and not loser.get("isExotic"):
                        l_grc["dismantleCandidate"] = True
                        l_grc["dismantleTier"] = "OUTCLASSED_ARMOR"
                        l_grc["dismantleLabel"] = "Outclassed Duplicate Armor"
                        l_grc["dismantleReason"] = l_grc["comparisonSummary"]
                        l_grc["dismantleAutoSelect"] = not loser.get("isLocked")

            # Rank PVP: highest health stat, then total stats
            pvp_candidates.sort(
                key=lambda x: (
                    int(x["armorEvaluation"]["healthStat"]),
                    int(x.get("totalStats") or 0),
                    int(x.get("power") or 0),
                ),
                reverse=True,
            )
            if pvp_candidates:
                pvp_winner = pvp_candidates[0]
                pvp_winner["godRollCheck"]["isBestPvp"] = True
                pvp_winner["godRollCheck"]["isBestGodRoll"] = True
                pvp_winner["godRollCheck"]["duplicateRank"] = 1
                for loser in pvp_candidates[1:]:
                    l_grc = loser["godRollCheck"]
                    l_grc["isOutclassedDuplicate"] = True
                    l_grc["comparisonSummary"] = (
                        f"Outclassed by #1 PVP Roll ({pvp_winner['armorEvaluation']['healthStat']} vs {loser['armorEvaluation']['healthStat']} Health)"
                    )
                    if not loser.get("isEquipped") and not l_grc["inSavedLoadout"] and not loser.get("isExotic"):
                        l_grc["dismantleCandidate"] = True
                        l_grc["dismantleTier"] = "OUTCLASSED_ARMOR"
                        l_grc["dismantleLabel"] = "Outclassed Duplicate Armor"
                        l_grc["dismantleReason"] = l_grc["comparisonSummary"]
                        l_grc["dismantleAutoSelect"] = not loser.get("isLocked")

