import csv
import datetime
import io
import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple
import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
COMPENDIUM_DB_PATH = os.path.join(DATA_DIR, "compendium_db.json")

COMPENDIUM_DOC_ID = "1WaxvbLx7UoSZaBqdFr1u32F2uWVLo-CJunJB4nlGUE4"
COMPENDIUM_SOURCE_URL = (
    "https://docs.google.com/spreadsheets/d/"
    "1WaxvbLx7UoSZaBqdFr1u32F2uWVLo-CJunJB4nlGUE4/edit?gid=1287885342#gid=1287885342"
)

# All 16 live tabs (excluding deprecated OLD_* tabs)
LIVE_TAB_GIDS: Dict[str, str] = {
    "Landing": "1038486120",
    "Weapon_Perks": "1662574278",
    "Armor_Perks": "1287885342",
    "Artifact_Perks": "473308249",
    "Armor_Mods": "1934379638",
    "Arc": "618967225",
    "Solar": "1186062409",
    "Void": "1907852650",
    "Stasis": "1088259962",
    "Strand": "1870531554",
    "Prismatic": "1918152785",
    "Exotic_Class": "20898389",
    "Class_Abilities": "527596209",
    "Exotic_Weapons": "441434520",
    "Exotic_Armors": "1500097863",
    "Game_Mechanics": "1800463143",
}

FRAGMENT_PREFIX: Dict[str, str] = {
    "Arc": "Spark of ",
    "Solar": "Ember of ",
    "Void": "Echo of ",
    "Stasis": "Whisper of ",
    "Strand": "Thread of ",
    "Prismatic": "Facet of ",
}

SUBCLASS_ELEMENTS = ("Void", "Solar", "Arc", "Stasis", "Strand", "Prismatic")
GUARDIAN_CLASSES = ("Warlock", "Titan", "Hunter")

_COMPENDIUM_CACHE: Optional[Dict[str, Any]] = None
_COMPENDIUM_MTIME: float = 0.0


def _cell(row: List[str], idx: int) -> str:
    if idx < 0 or idx >= len(row):
        return ""
    return (row[idx] or "").strip()


def _clean_text(text: str) -> str:
    """Clean whitespace and sanitize legacy stat labels so only modern 0-200 stats appear."""
    if not text:
        return ""
    t = text.replace("\r\n", "\n").replace("\r", "\n")
    # Collapse 3+ newlines into 2
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    # Fix singular "+10 Weapon" -> "+10 Weapons"
    t = re.sub(r"([+-]\d+\s+)Weapon\b", r"\1Weapons", t)
    # Translate internal walk/strafe "Mobility" scalar mentions so F.E.L.I.C.I.A. never echoes "Mobility" as a stat
    t = re.sub(r"\b([+-]\d+\??\s+)Mobility\b", r"\1Strafe/Walk Speed", t)
    t = re.sub(r"\bmaximum Mobility\b", "maximum Strafe/Walk Speed", t, flags=re.IGNORECASE)
    t = re.sub(r"\bBaseline\s+100\s*\[70\]\s*Mobility\b", "Enhanced intrinsic Strafe/Walk Speed", t, flags=re.IGNORECASE)
    return t


def _auto_tags(text: str) -> List[str]:
    """Infer Destiny 2 elemental, ability, and playstyle tags from mechanics text."""
    tl = text.lower()
    tags: List[str] = []

    element_keywords = {
        "Void": ["void", "devour", "volatile", "weaken", "weakened", "overshield", "invisibility", "invisible", "suppress", "suppression", "void breach", "nova", "child of the old gods", "chaos accelerant", "shadowshot", "twilight arsenal", "scatter grenade", "axion bolt", "vortex grenade", "magnetic grenade", "pocket singularity", "snare bomb", "spectral blades", "sentinel shield", "ward of dawn"],
        "Solar": ["solar", "scorch", "scorched", "ignition", "ignite", "radiant", "cure", "restoration", "firesprite", "well of radiance", "daybreak", "song of flame", "hellion", "golden gun", "blade barrage", "consecration", "sunspot", "fusion grenade", "healing grenade", "solar grenade", "tripmine", "incinerator snap", "celestial fire", "throwing knife", "weighted throwing", "hammer of sol", "burning maul"],
        "Arc": ["arc", "jolt", "jolted", "amplified", "blind", "blinded", "bolt charge", "ionic trace", "speed booster", "chaos reach", "stormtrance", "thundercrash", "gathering storm", "arc soul", "ionic sentry", "pulse grenade", "storm grenade", "skip grenade", "flux grenade", "flashbang", "lightning grenade", "chain lightning", "ball lightning", "combination blow", "thunderclap", "arc staff", "fists of havoc"],
        "Stasis": ["stasis", "slow", "slowed", "freeze", "frozen", "shatter", "stasis crystal", "stasis shard", "frost armor", "bleak watcher", "winter's wrath", "glacial quake", "silence & squall", "diamond lance", "coldsnap", "duskfield", "glacier grenade", "withering blade", "penumbral blast", "shiver strike"],
        "Strand": ["strand", "suspend", "suspended", "unravel", "unraveling", "sever", "severed", "woven mail", "tangle", "threadling", "grapple", "needlestorm", "bladefury", "silkstrike", "banner of war", "shackle grenade", "arcane needle", "frenzied blade", "threaded spike"],
        "Prismatic": ["prismatic", "transcendent", "transcendence"],
        "Kinetic": ["kinetic", "micro-missile"],
    }
    for elem, kws in element_keywords.items():
        if any(kw in tl for kw in kws):
            tags.append(elem)

    focus_keywords = {
        "Grenade": ["grenade", "firepower", "ashes to assets"],
        "Melee": ["melee", "glaive", "sword", "finisher", "heavy handed"],
        "Class": ["class ability", "rift", "barricade", "dodge", "phoenix dive", "thruster"],
        "Super": ["super", "orb of power", "orbs of power"],
        "Survivability": ["heal", "restores", "health", "damage resist", "resist", "overshield", "devour", "restoration", "cure", "woven mail", "frost armor", "invisibility"],
        "Weapons": ["weapon", "ammo", "reload", "handling", "precision", "primary", "special", "heavy", "rocket", "linear fusion", "sniper", "shotgun", "auto rifle", "pulse rifle", "hand cannon", "submachine gun", "trace rifle"],
        "PVP": ["guardian", "radar", "crucible", "trials", "ally death", "hipfire", "flinch", "aim assist"],
    }
    for tag, kws in focus_keywords.items():
        if any(kw in tl for kw in kws):
            tags.append(tag)

    return tags


def _parse_armor_perks(rows: List[List[str]]) -> List[Dict[str, Any]]:
    sets: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None

    for r_idx in range(2, len(rows)):
        row = rows[r_idx]
        c0 = _cell(row, 0)
        c2 = _cell(row, 2)
        if not c0 and not c2:
            continue

        if c0:
            if current:
                sets.append(current)
            parts = [p.strip() for p in c0.split("\n") if p.strip()]
            set_name = parts[0] if parts else c0
            source = " | ".join(parts[1:]) if len(parts) > 1 else "World / Activity Drop"
            current = {
                "name": set_name,
                "source": source,
                "perk_2pc_name": "",
                "perk_2pc_desc": "",
                "perk_4pc_name": "",
                "perk_4pc_desc": "",
                "tags": [],
            }

        if current and c2:
            lines = [ln.strip() for ln in c2.split("\n") if ln.strip()]
            header = lines[0] if lines else ""
            body = _clean_text("\n".join(lines[1:])) if len(lines) > 1 else _clean_text(c2)
            if header.lower().startswith("2 piece"):
                p_name = header.split("|", 1)[1].strip() if "|" in header else header
                current["perk_2pc_name"] = p_name
                current["perk_2pc_desc"] = body
            elif header.lower().startswith("4 piece"):
                p_name = header.split("|", 1)[1].strip() if "|" in header else header
                current["perk_4pc_name"] = p_name
                current["perk_4pc_desc"] = body
            else:
                if not current["perk_2pc_desc"]:
                    current["perk_2pc_desc"] = _clean_text(c2)
                else:
                    current["perk_4pc_desc"] = (current["perk_4pc_desc"] + "\n" + _clean_text(c2)).strip()

    if current:
        sets.append(current)

    for s in sets:
        combined = f"{s['name']} {s['source']} {s['perk_2pc_name']} {s['perk_2pc_desc']} {s['perk_4pc_name']} {s['perk_4pc_desc']}"
        s["tags"] = _auto_tags(combined)
        if "disabled in crucible" in combined.lower():
            s["pve_only_4pc"] = True
        else:
            s["pve_only_4pc"] = False

    return sets


def _parse_exotic_armors(rows: List[List[str]]) -> Dict[str, List[Dict[str, Any]]]:
    result: Dict[str, List[Dict[str, Any]]] = {"Hunter": [], "Titan": [], "Warlock": []}
    class_cols = [("Hunter", 0, 2), ("Titan", 3, 5), ("Warlock", 6, 8)]

    r_idx = 3
    while r_idx < len(rows):
        row = rows[r_idx]
        next_row = rows[r_idx + 1] if (r_idx + 1) < len(rows) else []
        any_notes = any(_cell(row, c_note) for _, _, c_note in class_cols)
        if any_notes:
            for cls_name, c_name, c_note in class_cols:
                item_name = _cell(row, c_name)
                notes = _clean_text(_cell(row, c_note))
                perk_name = _cell(next_row, c_name) if next_row else ""
                if item_name and notes:
                    result[cls_name].append({
                        "name": item_name,
                        "perk_name": perk_name,
                        "class": cls_name,
                        "description": notes,
                        "tags": _auto_tags(f"{item_name} {perk_name} {notes}"),
                    })
            r_idx += 2
        else:
            r_idx += 1

    return result


def _parse_exotic_class_items(rows: List[List[str]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "note": "Exotic Class Items (Relativism for Hunter, Stoicism for Titan, Solipsism for Warlock) only apply their Spirit perks while the Prismatic subclass is equipped.",
        "Shared": [],
        "Hunter": [],
        "Titan": [],
        "Warlock": [],
    }
    bucket = "Shared"
    for r_idx in range(2, len(rows)):
        row = rows[r_idx]
        c0 = _cell(row, 0)
        c2 = _clean_text(_cell(row, 2))
        c3 = _cell(row, 3)
        c5 = _clean_text(_cell(row, 5))

        if c0 and not c2 and not c3:
            cl = c0.lower()
            if "class-agnostic" in cl:
                bucket = "Shared"
            elif "hunter" in cl:
                bucket = "Hunter"
            elif "titan" in cl:
                bucket = "Titan"
            elif "warlock" in cl:
                bucket = "Warlock"
            elif "prismatic" in cl:
                out["note"] = _clean_text(c0)
            continue

        if c0 and c2:
            out[bucket].append({
                "name": c0,
                "column": "Column 1 (Left)",
                "description": c2,
                "tags": _auto_tags(f"{c0} {c2}"),
            })
        if c3 and c5:
            out[bucket].append({
                "name": c3,
                "column": "Column 2 (Right)",
                "description": c5,
                "tags": _auto_tags(f"{c3} {c5}"),
            })

    return out


def _parse_subclass_sheet(element: str, rows: List[List[str]]) -> Dict[str, Any]:
    prefix = FRAGMENT_PREFIX.get(element, "")
    data: Dict[str, Any] = {
        "element": element,
        "glossary": [],
        "fragments": [],
        "grenades": [],
        "classes": {
            "Hunter": {"melees": [], "supers": [], "aspects": [], "prismatic_grenade": None, "shared_abilities": []},
            "Titan": {"melees": [], "supers": [], "aspects": [], "prismatic_grenade": None, "shared_abilities": []},
            "Warlock": {"melees": [], "supers": [], "aspects": [], "prismatic_grenade": None, "shared_abilities": []},
        },
    }

    current_class: Optional[str] = None
    section: str = ""

    for r_idx in range(2, len(rows)):
        row = rows[r_idx]
        c0 = _cell(row, 0)
        c1 = _cell(row, 1)
        c3 = _clean_text(_cell(row, 3))
        c6 = _cell(row, 6)
        c13 = _clean_text(_cell(row, 13))

        # Detect class boundary
        cls_marker = f"{c0} {c6}".lower()
        if "hunter" in cls_marker and (c0.lower().startswith("hunter") or c6.lower().startswith("hunter")):
            current_class = "Hunter"
            section = "class_root"
            continue
        if "titan" in cls_marker and (c0.lower().startswith("titan") or c6.lower().startswith("titan")):
            current_class = "Titan"
            section = "class_root"
            continue
        if "warlock" in cls_marker and (c0.lower().startswith("warlock") or c6.lower().startswith("warlock")):
            current_class = "Warlock"
            section = "class_root"
            continue

        # Detect section headers
        c1_low = c1.lower()
        if c1_low == "glossary":
            section = "glossary"
            continue
        if c1_low == "fragments":
            section = "fragments"
            continue
        if c1_low == "grenade abilities":
            section = "grenades"
            continue
        if c1_low == "class abilities":
            section = "class_abilities_inline"
            continue
        if c1_low == "melee abilities":
            section = "melees"
            continue
        if c1_low == "super abilities":
            section = "supers"
            continue
        if c1_low in ("aspect", "aspects"):
            section = "aspects"
            continue

        if not c1 and not c3:
            continue

        if section == "glossary" and c1 and c3:
            data["glossary"].append({"name": c1.replace("\n", " "), "description": c3})
        elif section == "fragments" and c1 and c3:
            short_name = c1.replace("\n", " ").strip()
            full_name = short_name if short_name.lower().startswith(prefix.lower()) else f"{prefix}{short_name}"
            stats_clean = "" if c13 in ("-", "") else c13.replace("\n", ", ")
            data["fragments"].append({
                "name": short_name,
                "full_name": full_name,
                "description": c3,
                "stats": stats_clean,
                "tags": _auto_tags(f"{full_name} {c3} {stats_clean}"),
            })
        elif section == "grenades" and c1 and c3:
            data["grenades"].append({
                "name": " ".join(c1.split()),
                "description": c3,
                "cooldown": c13.replace("\n", " "),
            })
        elif current_class:
            cls_bucket = data["classes"][current_class]
            if section == "class_root":
                if "Prismatic Grenade" in c3 and c1:
                    cls_bucket["prismatic_grenade"] = {
                        "name": " ".join(c1.split()),
                        "description": c3,
                    }
                elif not c1 or "shared abilities" in c1.lower():
                    shared = [_cell(row, col_i) for col_i in (3, 5, 7, 9, 11) if _cell(row, col_i)]
                    if shared and not c1:
                        cls_bucket["shared_abilities"].append(shared)
            elif section == "melees" and c1 and c3:
                cls_bucket["melees"].append({
                    "name": " ".join(c1.split()),
                    "description": c3,
                    "cooldown": c13.replace("\n", " "),
                })
            elif section == "supers" and c1 and c3:
                cls_bucket["supers"].append({
                    "name": " ".join(c1.split()),
                    "description": c3,
                    "tier_info": c13.replace("\n", " "),
                })
            elif section == "aspects" and c1 and c3:
                cls_bucket["aspects"].append({
                    "name": " ".join(c1.split()),
                    "description": c3,
                    "fragment_slots": c13.replace("\n", " "),
                })

    return data


def _parse_class_abilities(rows: List[List[str]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "Hunter": {"intrinsics": "", "abilities": []},
        "Titan": {"intrinsics": "", "abilities": []},
        "Warlock": {"intrinsics": "", "abilities": []},
    }
    current_class: Optional[str] = None
    for r_idx in range(1, len(rows)):
        row = rows[r_idx]
        c0 = _cell(row, 0).lower()
        c6 = _cell(row, 6).lower()
        c1 = _cell(row, 1)
        c3 = _clean_text(_cell(row, 3))
        c13 = _clean_text(_cell(row, 13))

        if "hunter" in c0 or "hunter" in c6:
            current_class = "Hunter"
            continue
        if "titan" in c0 or "titan" in c6:
            current_class = "Titan"
            continue
        if "warlock" in c0 or "warlock" in c6:
            current_class = "Warlock"
            continue

        if current_class and c3:
            if not c1 or c1 == "-":
                out[current_class]["intrinsics"] = c3
            else:
                out[current_class]["abilities"].append({
                    "name": c1.replace("\n", " "),
                    "description": c3,
                    "cooldown": c13.replace("\n", " "),
                })
    return out


def _parse_artifact_perks(rows: List[List[str]]) -> List[Dict[str, Any]]:
    artifacts: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None

    r_idx = 4
    while r_idx < len(rows):
        row = rows[r_idx]
        c3 = _cell(row, 3)
        c2 = _cell(row, 2)
        c5 = _cell(row, 5)
        c8 = _cell(row, 8)

        # Artifact title header row
        if c3 and not c2 and not c5:
            if "⯁" in c3 or "|" in c3:
                if current:
                    current["focus"] = c3.replace("\n", " ")
            else:
                if current:
                    artifacts.append(current)
                current = {
                    "name": c3.replace("\n", " ").strip(),
                    "focus": "",
                    "perks": [],
                }
            r_idx += 1
            continue

        if current and (c2 or c5 or c8):
            desc_row = rows[r_idx + 1] if (r_idx + 1) < len(rows) else []
            tiers = [
                ("Column 1 (⯁)", c2, _clean_text(_cell(desc_row, 1))),
                ("Column 2 (⯁⯁)", c5, _clean_text(_cell(desc_row, 4))),
                ("Column 3 (⯁⯁⯁)", c8, _clean_text(_cell(desc_row, 7))),
            ]
            for tier_label, p_name, p_desc in tiers:
                if p_name and p_desc:
                    current["perks"].append({
                        "name": p_name.replace("\n", " ").strip(),
                        "tier": tier_label,
                        "description": p_desc,
                        "tags": _auto_tags(f"{p_name} {p_desc}"),
                    })
            r_idx += 2
            continue

        r_idx += 1

    if current:
        artifacts.append(current)

    for art in artifacts:
        combined = art["name"] + " " + art["focus"] + " " + " ".join(
            f"{p['name']} {p['description']}" for p in art["perks"]
        )
        art["tags"] = _auto_tags(combined)

    return artifacts


def _parse_armor_mods(rows: List[List[str]]) -> Dict[str, List[Dict[str, str]]]:
    slots = [
        ("Helmet", 1, 3),
        ("Arms", 4, 6),
        ("Chest", 7, 9),
        ("Legs", 10, 12),
        ("Class Item", 13, 15),
    ]
    out: Dict[str, List[Dict[str, str]]] = {s[0]: [] for s in slots}
    for r_idx in range(1, len(rows)):
        row = rows[r_idx]
        for slot_name, c_name, c_eff in slots:
            raw_name = _cell(row, c_name)
            raw_eff = _clean_text(_cell(row, c_eff))
            if raw_name and raw_eff:
                # Skip legacy-only Enhanced Athletics so Mobility isn't recommended as a stat mod
                if "enhanced athletics" in raw_name.lower():
                    continue
                out[slot_name].append({
                    "name": " ".join(raw_name.split()),
                    "effect": raw_eff,
                })
    return out


def _parse_weapon_perks(rows: List[List[str]]) -> Dict[str, List[Dict[str, str]]]:
    out: Dict[str, List[Dict[str, str]]] = {
        "traits": [],
        "mods": [],
        "intrinsics": [],
        "origin_traits": [],
        "weapon_archetype_notes": [],
    }
    section = "traits"
    for r_idx in range(4, len(rows)):
        row = rows[r_idx]
        c0 = _cell(row, 0)
        c2 = _clean_text(_cell(row, 2))

        if c0 and not c2:
            cl = c0.lower()
            if cl == "weapon traits":
                section = "traits"
            elif cl == "weapon mods":
                section = "mods"
            elif cl == "intrinsic traits":
                section = "intrinsics"
            elif cl == "origin traits":
                section = "origin_traits"
            elif any(k in cl for k in ["crossbow", "glaive", "sword"]):
                section = "weapon_archetype_notes"
            continue

        if c0 and c2:
            out[section].append({
                "name": " ".join(c0.split()),
                "description": c2,
            })

    return out


def _parse_exotic_weapons(rows: List[List[str]]) -> List[Dict[str, Any]]:
    weapons: List[Dict[str, Any]] = []
    slot = "Kinetic"
    for r_idx in range(4, len(rows)):
        row = rows[r_idx]
        c0 = _cell(row, 0)
        c3 = _clean_text(_cell(row, 3))

        if c0 and not c3:
            cl = c0.lower()
            if "kinetic" in cl:
                slot = "Kinetic"
            elif "energy" in cl:
                slot = "Energy"
            elif "power" in cl:
                slot = "Heavy / Power"
            continue

        if c0 and c3:
            lines = [ln.strip() for ln in c0.split("\n") if ln.strip()]
            w_name = lines[0] if lines else c0
            perks = [ln for ln in lines[1:] if not ln.startswith("↑")]
            catalyst_perks = [ln.lstrip("↑").strip() for ln in lines[1:] if ln.startswith("↑")]
            weapons.append({
                "name": w_name,
                "slot": slot,
                "intrinsic_and_traits": perks,
                "catalyst_traits": catalyst_perks,
                "description": c3,
                "tags": _auto_tags(f"{w_name} {' '.join(lines[1:])} {c3}"),
            })
    return weapons


def _parse_game_mechanics(rows: List[List[str]]) -> Dict[str, Any]:
    modern_stats: List[Dict[str, str]] = []
    target_stats = {"Health", "Melee", "Grenade", "Super", "Class", "Weapons"}

    base_hp_summary = ""
    champions: List[Dict[str, str]] = []
    banes: List[Dict[str, str]] = []
    heat_weapons_info = ""

    for r_idx, row in enumerate(rows):
        c2 = _cell(row, 2)
        c3 = _cell(row, 3)
        c4 = _cell(row, 4)

        if r_idx == 105 and c2:
            base_hp_summary = _clean_text(c2)

        if c2 in target_stats and c4:
            modern_stats.append({
                "stat": c2,
                "description": _clean_text(c4),
            })

        if c2 in ("Barrier Champions", "Overload Champions", "Unstoppable Champions"):
            desc = _clean_text(_cell(rows[r_idx + 1], 2)) if (r_idx + 1) < len(rows) else ""
            champions.append({"name": c2, "description": desc})

        if r_idx >= 188 and r_idx <= 209 and c2 and c4:
            banes.append({"name": c2, "description": _clean_text(c4)})

        if c2 == "Heat Weapons" and c3:
            heat_weapons_info = _clean_text(c3)

    return {
        "base_health_and_shields": base_hp_summary,
        "modern_stats": modern_stats,
        "champions": champions,
        "banes": banes,
        "heat_weapons": heat_weapons_info,
    }


def parse_compendium_tabs(tab_rows: Dict[str, List[List[str]]]) -> Dict[str, Any]:
    subclasses: Dict[str, Any] = {}
    for elem in SUBCLASS_ELEMENTS:
        if elem in tab_rows:
            subclasses[elem] = _parse_subclass_sheet(elem, tab_rows[elem])

    armor_sets = _parse_armor_perks(tab_rows.get("Armor_Perks", []))
    exotic_armors = _parse_exotic_armors(tab_rows.get("Exotic_Armors", []))
    exotic_class_items = _parse_exotic_class_items(tab_rows.get("Exotic_Class", []))
    class_abilities = _parse_class_abilities(tab_rows.get("Class_Abilities", []))
    artifacts = _parse_artifact_perks(tab_rows.get("Artifact_Perks", []))
    armor_mods = _parse_armor_mods(tab_rows.get("Armor_Mods", []))
    weapon_perks = _parse_weapon_perks(tab_rows.get("Weapon_Perks", []))
    exotic_weapons = _parse_exotic_weapons(tab_rows.get("Exotic_Weapons", []))
    game_mechanics = _parse_game_mechanics(tab_rows.get("Game_Mechanics", []))

    db = {
        "meta": {
            "title": "Destiny 2 Data Compendium (Live Tactical Knowledge Base)",
            "doc_id": COMPENDIUM_DOC_ID,
            "source_url": COMPENDIUM_SOURCE_URL,
            "synced_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "counts": {
                "armor_sets": len(armor_sets),
                "subclasses": len(subclasses),
                "exotic_armors": sum(len(v) for v in exotic_armors.values()),
                "exotic_class_spirits": sum(len(exotic_class_items[k]) for k in ("Shared", "Hunter", "Titan", "Warlock")),
                "artifacts": len(artifacts),
                "artifact_perks": sum(len(a["perks"]) for a in artifacts),
                "armor_mods": sum(len(v) for v in armor_mods.values()),
                "weapon_traits": len(weapon_perks["traits"]),
                "origin_traits": len(weapon_perks["origin_traits"]),
                "weapon_mods": len(weapon_perks["mods"]),
                "exotic_weapons": len(exotic_weapons),
            },
        },
        "armor_sets": armor_sets,
        "subclasses": subclasses,
        "class_abilities": class_abilities,
        "exotic_armors": exotic_armors,
        "exotic_class_items": exotic_class_items,
        "artifacts": artifacts,
        "armor_mods": armor_mods,
        "weapon_perks": weapon_perks,
        "exotic_weapons": exotic_weapons,
        "game_mechanics": game_mechanics,
    }
    return db


def build_compendium_from_csv_dir(csv_dir: str, output_path: str = COMPENDIUM_DB_PATH) -> Dict[str, Any]:
    tab_rows: Dict[str, List[List[str]]] = {}
    for tab_name in LIVE_TAB_GIDS:
        fpath = os.path.join(csv_dir, f"{tab_name}.csv")
        if os.path.exists(fpath):
            with open(fpath, "r", encoding="utf-8") as f:
                tab_rows[tab_name] = list(csv.reader(f))

    db = parse_compendium_tabs(tab_rows)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
    global _COMPENDIUM_CACHE, _COMPENDIUM_MTIME
    _COMPENDIUM_CACHE = db
    _COMPENDIUM_MTIME = os.path.getmtime(output_path)
    return db


def sync_compendium_from_google_sheet(doc_id: str = COMPENDIUM_DOC_ID, output_path: str = COMPENDIUM_DB_PATH) -> Dict[str, Any]:
    tab_rows: Dict[str, List[List[str]]] = {}
    headers = {"User-Agent": "Mozilla/5.0 FELICIA-Compendium-Sync/1.0"}
    for tab_name, gid in LIVE_TAB_GIDS.items():
        url = f"https://docs.google.com/spreadsheets/d/{doc_id}/gviz/tq?tqx=out:csv&headers=0&gid={gid}"
        resp = requests.get(url, headers=headers, timeout=20)
        resp.raise_for_status()
        resp.encoding = "utf-8"
        tab_rows[tab_name] = list(csv.reader(io.StringIO(resp.text)))

    db = parse_compendium_tabs(tab_rows)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
    global _COMPENDIUM_CACHE, _COMPENDIUM_MTIME
    _COMPENDIUM_CACHE = db
    _COMPENDIUM_MTIME = os.path.getmtime(output_path)
    return db


def get_compendium_db() -> Dict[str, Any]:
    global _COMPENDIUM_CACHE, _COMPENDIUM_MTIME
    if os.path.exists(COMPENDIUM_DB_PATH):
        mtime = os.path.getmtime(COMPENDIUM_DB_PATH)
        if _COMPENDIUM_CACHE is None or mtime != _COMPENDIUM_MTIME:
            with open(COMPENDIUM_DB_PATH, "r", encoding="utf-8") as f:
                _COMPENDIUM_CACHE = json.load(f)
            _COMPENDIUM_MTIME = mtime
        return _COMPENDIUM_CACHE or {}
    return {}


def get_compendium_wiki_entries() -> List[Dict[str, Any]]:
    """Expose all 56 Armor Set Bonuses + Modern 0-200 Stats + Equippable Artifacts as searchable Wiki cards."""
    db = get_compendium_db()
    if not db:
        return []
    entries: List[Dict[str, Any]] = []

    for idx, s in enumerate(db.get("armor_sets", [])):
        slug = re.sub(r"[^a-z0-9]+", "-", s["name"].lower()).strip("-")
        entries.append({
            "id": f"compendium-armorset-{slug}-{idx}",
            "title": f"{s['name']} Armor Set (2pc & 4pc Bonuses)",
            "category": "Armor Set Bonuses",
            "tags": ["Armor Set", "2 Piece", "4 Piece", s["name"]] + s.get("tags", [])[:5],
            "summary": f"Source: {s['source']} — 2pc: {s['perk_2pc_name']} | 4pc: {s['perk_4pc_name']}",
            "content": (
                f"Source / Activity: {s['source']}\n\n"
                f"• 2-Piece Bonus — {s['perk_2pc_name']}:\n{s['perk_2pc_desc']}\n\n"
                f"• 4-Piece Bonus — {s['perk_4pc_name']}:\n{s['perk_4pc_desc']}"
            ),
        })

    gm = db.get("game_mechanics", {})
    if gm.get("modern_stats"):
        stat_body = "\n\n".join(f"✦ {st['stat']} (0–200):\n{st['description']}" for st in gm["modern_stats"])
        entries.append({
            "id": "compendium-modern-200-stats",
            "title": "Modern 0–200 Character & Armor Stats Guide",
            "category": "Mechanics",
            "tags": ["Stats", "200", "Health", "Melee", "Grenade", "Super", "Class", "Weapons"],
            "summary": "Exact Compendium scaling from 0 to 100 and Enhanced 100 to 200 stat benefits.",
            "content": f"{gm.get('base_health_and_shields', '')}\n\n{stat_body}".strip(),
        })

    return entries


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def detect_tactical_intent(
    message: str,
    fallback_class: Optional[str] = "Warlock",
    fallback_subclass: Optional[str] = "Solar",
    fallback_activity: Optional[str] = "Grandmaster+",
    fallback_inquiry: Optional[str] = "Ability Focused",
) -> Dict[str, Any]:
    """Detect explicit class, subclass, activity, and build/gear intent directly from the Guardian's message."""
    ml = (message or "").lower()

    # 1. Detect Guardian Class from message text first
    explicit_class: Optional[str] = None
    class_signals = {
        "Warlock": [
            r"\bwarlocks?\b", r"\bvoidwalker\b", r"\bdawnblade\b", r"\bstormcaller\b",
            r"\bshadebinder\b", r"\bbroodweaver\b", r"\bnova bomb\b", r"\bnova warp\b",
            r"\bwell of radiance\b", r"\bsong of flame\b", r"\bchaos reach\b",
            r"\bneedlestorm\b", r"\bchild of the old gods\b", r"\bchaos accelerant\b",
            r"\bfeed the void\b", r"\bsoul siphon\b", r"\bbleak watcher\b", r"\bhellion\b",
            r"\bsolipsism\b", r"\bbriarbinds\b", r"\bcontraverse\b", r"\bnezarec'?s sin\b",
            r"\bgetaway artist\b", r"\bsunbracers\b", r"\bspeaker'?s sight\b", r"\bgeomag\b",
        ],
        "Titan": [
            r"\btitans?\b", r"\bsentinel\b", r"\bsunbreaker\b", r"\bstriker\b",
            r"\bbehemoth\b", r"\bberserker\b", r"\bthundercrash\b", r"\btwilight arsenal\b",
            r"\bward of dawn\b", r"\bglacial quake\b", r"\bbladefury\b", r"\bconsecration\b",
            r"\bbanner of war\b", r"\bstorm'?s keep\b", r"\bcontrolled demolition\b",
            r"\bstoicism\b", r"\bsynthoceps\b", r"\bcuirass\b", r"\bhoil\b", r"\binmost light\b",
            r"\bicefall mantle\b",
        ],
        "Hunter": [
            r"\bhunters?\b", r"\bnightstalker\b", r"\bgunslinger\b", r"\barcstrider\b",
            r"\bthreadrunner\b", r"\bgolden gun\b", r"\bblade barrage\b", r"\bshadowshot\b",
            r"\bmoebius quiver\b", r"\bdeadfall\b", r"\bgathering storm\b", r"\bsilkstrike\b",
            r"\bsilence and squall\b", r"\bon the prowl\b", r"\bascension\b", r"\bgunpowder gamble\b",
            r"\brelativism\b", r"\bcelestial nighthawk\b", r"\bgyrfalcon\b", r"\bomnioculus\b",
            r"\borpheus rig\b", r"\bkhepri'?s sting\b", r"\bmask of fealty\b",
        ],
    }
    for cls_name, patterns in class_signals.items():
        if any(re.search(pat, ml) for pat in patterns):
            explicit_class = cls_name
            break

    # 2. Detect Subclass Element from message text first
    explicit_subclass: Optional[str] = None
    subclass_signals = {
        "Prismatic": [r"\bprismatic\b", r"\btranscenden(t|ce)\b", r"\bsolipsism\b", r"\bstoicism\b", r"\brelativism\b", r"\bspirit of\b"],
        "Void": [r"\bvoid\b", r"\bvoidwalker\b", r"\bnightstalker\b", r"\bsentinel\b", r"\bdevour\b", r"\bvolatile\b", r"\bnova bomb\b", r"\bshadowshot\b", r"\btwilight arsenal\b", r"\bbriarbinds\b", r"\bcontraverse\b", r"\bchild of the old gods\b", r"\bchaos accelerant\b", r"\bsoul siphon\b", r"\bon the prowl\b"],
        "Solar": [r"\bsolar\b", r"\bdawnblade\b", r"\bgunslinger\b", r"\bsunbreaker\b", r"\bscorch\b", r"\bignition\b", r"\bradiant\b", r"\brestoration\b", r"\bwell of radiance\b", r"\bsong of flame\b", r"\bgolden gun\b", r"\bblade barrage\b", r"\bsunbracers\b", r"\bspeaker'?s sight\b", r"\bhellion\b"],
        "Arc": [r"\barc\b", r"\bstormcaller\b", r"\barcstrider\b", r"\bstriker\b", r"\bjolt\b", r"\bbolt charge\b", r"\bamplified\b", r"\bchaos reach\b", r"\bthundercrash\b", r"\bgathering storm\b", r"\bstorm'?s keep\b", r"\bionic sentry\b", r"\bgeomag\b"],
        "Stasis": [r"\bstasis\b", r"\bshadebinder\b", r"\bbehemoth\b", r"\bfrost armor\b", r"\bbleak watcher\b", r"\bshatterdive\b", r"\bglacial quake\b", r"\bwinter'?s wrath\b", r"\bsilence and squall\b", r"\bicefall\b"],
        "Strand": [r"\bstrand\b", r"\bbroodweaver\b", r"\bthreadrunner\b", r"\bberserker\b", r"\bwoven mail\b", r"\bsuspend\b", r"\bthreadling\b", r"\btangle\b", r"\bneedlestorm\b", r"\bbladefury\b", r"\bsilkstrike\b", r"\bbanner of war\b"],
    }
    for sub_name, patterns in subclass_signals.items():
        if any(re.search(pat, ml) for pat in patterns):
            explicit_subclass = sub_name
            break

    # 3. Detect Activity
    explicit_activity: Optional[str] = None
    if any(k in ml for k in ["pvp", "crucible", "trials", "comp", "competitive", "iron banner"]):
        explicit_activity = "PVP"
    elif any(k in ml for k in ["raid", "dungeon", "boss", "dps"]):
        explicit_activity = "Dungeon / Raid"
    elif any(k in ml for k in ["gm", "grandmaster", "nightfall", "master", "conquest", "endgame", "pve"]):
        explicit_activity = "Grandmaster+"

    effective_class = explicit_class or (fallback_class or "Warlock").strip().capitalize()
    if effective_class not in GUARDIAN_CLASSES:
        effective_class = "Warlock"

    effective_subclass = explicit_subclass or (fallback_subclass or "Solar").strip().capitalize()
    if effective_subclass not in SUBCLASS_ELEMENTS:
        effective_subclass = "Solar"

    effective_activity = explicit_activity or (fallback_activity or "Grandmaster+")

    build_keywords = [
        "build", "loadout", "setup", "how can i", "how do i", "what should i run",
        "need a good", "best void", "best solar", "best arc", "best stasis", "best strand",
        "best prismatic", "good void", "good solar", "good arc", "good stasis", "good strand",
        "good prismatic", "recommend a", "synergy", "pair with",
    ]
    is_build_query = any(kw in ml for kw in build_keywords) or bool(explicit_class and explicit_subclass)

    return {
        "effective_class": effective_class,
        "effective_subclass": effective_subclass,
        "effective_activity": effective_activity,
        "effective_inquiry": fallback_inquiry or "Ability Focused",
        "explicit_class": explicit_class,
        "explicit_subclass": explicit_subclass,
        "explicit_activity": explicit_activity,
        "is_build_query": is_build_query,
    }


def rank_armor_sets_for_build(
    db: Dict[str, Any],
    subclass: str,
    activity: str,
    message: str = "",
    limit: int = 6,
) -> List[Dict[str, Any]]:
    """Score and return the best 2-piece & 4-piece Armor Sets for a given Subclass + Activity + query."""
    sets = db.get("armor_sets", [])
    if not sets:
        return []

    is_pvp = "pvp" in (activity or "").lower() or any(k in message.lower() for k in ["pvp", "crucible", "trials"])
    ml = message.lower()
    scored: List[Tuple[int, Dict[str, Any]]] = []

    for s in sets:
        score = 0
        tags = s.get("tags", [])
        s_text = f"{s['name']} {s['source']} {s['perk_2pc_name']} {s['perk_2pc_desc']} {s['perk_4pc_name']} {s['perk_4pc_desc']}".lower()

        # Direct mention boost
        if _norm(s["name"]) and len(_norm(s["name"])) >= 4 and _norm(s["name"]) in _norm(ml):
            score += 50

        if is_pvp:
            if "PVP" in tags or any(k in s["source"].lower() for k in ["trials", "crucible", "iron banner"]):
                score += 14
            if s.get("pve_only_4pc"):
                score -= 20
        else:
            # PVE scoring
            if any(k in s["source"].lower() for k in ["crucible", "trials"]) and "PVP" in tags:
                score -= 8
            if subclass in tags:
                score += 14
            # Universal S-tier PVE sets (Light/Dark ability energy, Orb/Armor Charge DR, Elemental Buffs)
            if s["name"] in ("CODA", "Atheon's Memory", "Exodus Down", "Smoke Jumper", "Ferropotent", "AION Renewal"):
                score += 9
            if subclass == "Arc" and s["name"] in ("Luminopotent", "Circuit"):
                score += 12
            if subclass == "Solar" and s["name"] in ("Lustrous", "First Ascent", "Apostate's Blade", "Collective Psyche"):
                score += 12
            if subclass == "Void" and s["name"] in ("CODA", "Atheon's Memory", "Exodus Down", "Collective Psyche", "Crota's Memory", "Resonant Fury", "Veritas"):
                score += 11
            if subclass == "Stasis" and s["name"] in ("Crystocrene", "Atheon's Memory", "CODA", "Exodus Down"):
                score += 11
            if subclass == "Strand" and s["name"] in ("Thunderhead", "Flain", "Collective Psyche", "CODA", "Taken King"):
                score += 11
            if subclass == "Prismatic" and s["name"] in ("CODA", "First Ascent", "Atheon's Memory", "Promised", "Exodus Down"):
                score += 12

            if "grenade" in ml and "Grenade" in tags:
                score += 6
            if ("melee" in ml or "sword" in ml or "glaive" in ml) and "Melee" in tags:
                score += 7
            if ("survive" in ml or "heal" in ml or "gm" in ml or "grandmaster" in ml) and "Survivability" in tags:
                score += 5
            if ("boss" in ml or "dps" in ml) and ("Weapons" in tags or "Super" in tags):
                score += 5

        scored.append((score, s))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in scored[:limit]]


def rank_exotic_armors_for_build(
    db: Dict[str, Any],
    guardian_class: str,
    subclass: str,
    message: str = "",
    limit: int = 9,
) -> List[Dict[str, Any]]:
    armors = db.get("exotic_armors", {}).get(guardian_class, [])
    if not armors:
        return []

    ml = message.lower()
    ml_norm = _norm(ml)
    scored: List[Tuple[int, Dict[str, Any]]] = []
    mono_elems = ("Void", "Solar", "Arc", "Stasis", "Strand")

    for ex in armors:
        score = 0
        tags = ex.get("tags", [])
        ex_norm = _norm(ex["name"])
        desc_low = ex["description"].lower()
        elem_tags = [e for e in mono_elems if e in tags]

        if ex_norm and len(ex_norm) >= 4 and ex_norm in ml_norm:
            score += 60

        if subclass in tags:
            score += 18
            # Pure single-element specialist boost (e.g., Briarbinds, Contraverse Hold, Nothing Manacles over rainbow exotics)
            if len(elem_tags) == 1:
                score += 10
        if subclass.lower() in desc_low:
            score += 8

        # Universal powerhouse exotics (work great on Prismatic or matching element)
        if ex["name"] in (
            "Verity's Brow", "Nezarec's Sin", "Mantle of Battle Harmony", "Sanguine Alchemy",
            "Eye of Another World", "Felwinter's Helm", "Necrotic Grip", "Getaway Artist",
            "Heart of Inmost Light", "Synthoceps", "Wormgod Caress", "Armamentarium", "Precious Scars",
            "Foetracer", "Star-Eater Scales", "Lucky Pants", "Fr0st-EE5", "Fortune’s Favor",
        ):
            if subclass == "Prismatic" or subclass in tags or not any(e in tags for e in ("Void", "Solar", "Arc", "Stasis", "Strand")):
                score += 6

        if "grenade" in ml and "Grenade" in tags:
            score += 6
        if "melee" in ml and "Melee" in tags:
            score += 6
        if ("super" in ml or "dps" in ml or "boss" in ml) and "Super" in tags:
            score += 6

        if score > 0:
            scored.append((score, ex))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in scored[:limit]]


def rank_artifacts_for_build(
    db: Dict[str, Any],
    subclass: str,
    message: str = "",
    limit: int = 2,
) -> List[Dict[str, Any]]:
    artifacts = db.get("artifacts", [])
    if not artifacts:
        return []

    ml_norm = _norm(message)
    scored: List[Tuple[int, Dict[str, Any], List[Dict[str, Any]]]] = []

    for art in artifacts:
        art_score = 0
        if _norm(art["name"]) and _norm(art["name"])[:10] in ml_norm:
            art_score += 40
        if subclass.lower() in (art.get("focus", "") + " " + art["name"]).lower():
            art_score += 12

        matching_perks = []
        for p in art.get("perks", []):
            p_tags = p.get("tags", [])
            if subclass in p_tags or _norm(p["name"]) in ml_norm:
                matching_perks.append(p)
                art_score += 4

        # Slight preference for newest Renegades / Reclamation / Heresy / Deep elemental specialists
        if "Renegades" in art["name"]:
            art_score += 3

        if art_score > 0:
            scored.append((art_score, art, matching_perks[:6] or art.get("perks", [])[:5]))

    scored.sort(key=lambda x: x[0], reverse=True)
    results = []
    for _, art, top_perks in scored[:limit]:
        results.append({
            "name": art["name"],
            "focus": art.get("focus", ""),
            "recommended_perks": top_perks,
        })
    return results


def search_direct_compendium_entities(db: Dict[str, Any], message: str) -> List[str]:
    """Find any specific Armor Sets, Exotic Armors, Exotic Weapons, Weapon Perks, Origin Traits, or Spirits explicitly mentioned."""
    ml_norm = _norm(message)
    ml_low = message.lower()
    if len(ml_norm) < 3:
        return []

    blocks: List[str] = []

    # 1. Specific Armor Sets mentioned by name (or general "armor set" / "2 piece" / "4 piece" list inquiry)
    matched_sets = []
    for s in db.get("armor_sets", []):
        sn = _norm(s["name"])
        p2 = _norm(s["perk_2pc_name"])
        p4 = _norm(s["perk_4pc_name"])
        if (len(sn) >= 4 and sn in ml_norm) or (len(p2) >= 5 and p2 in ml_norm) or (len(p4) >= 5 and p4 in ml_norm):
            matched_sets.append(s)

    for s in matched_sets[:4]:
        blocks.append(
            f"[ARMOR SET BONUS] {s['name']} ({s['source']})\n"
            f"  • 2-Piece | {s['perk_2pc_name']}: {s['perk_2pc_desc']}\n"
            f"  • 4-Piece | {s['perk_4pc_name']}: {s['perk_4pc_desc']}"
        )

    # 2. Specific Exotic Armors across all classes
    for cls_name, armors in db.get("exotic_armors", {}).items():
        for ex in armors:
            en = _norm(ex["name"])
            pn = _norm(ex["perk_name"])
            if (len(en) >= 5 and en in ml_norm) or (len(pn) >= 6 and pn in ml_norm):
                blocks.append(
                    f"[EXOTIC ARMOR — {cls_name}] {ex['name']} (Perk: {ex['perk_name']})\n"
                    f"  {ex['description']}"
                )

    # 3. Specific Exotic Class Item Spirits
    eci = db.get("exotic_class_items", {})
    for bucket in ("Shared", "Hunter", "Titan", "Warlock"):
        for sp in eci.get(bucket, []):
            sn = _norm(sp["name"])
            if len(sn) >= 6 and sn in ml_norm:
                blocks.append(
                    f"[EXOTIC CLASS ITEM SPIRIT — {bucket}, {sp['column']}] {sp['name']}\n"
                    f"  {sp['description']}"
                )

    # 4. Specific Exotic Weapons & Catalysts
    for ew in db.get("exotic_weapons", []):
        wn = _norm(ew["name"])
        wn_no_the = re.sub(r"^the", "", wn)
        if (len(wn) >= 4 and wn in ml_norm) or (len(wn_no_the) >= 5 and wn_no_the in ml_norm):
            cat_str = f" | Catalyst (↑): {', '.join(ew['catalyst_traits'])}" if ew.get("catalyst_traits") else ""
            blocks.append(
                f"[EXOTIC WEAPON — {ew['slot']}] {ew['name']} (Traits: {', '.join(ew['intrinsic_and_traits'])}{cat_str})\n"
                f"  {ew['description']}"
            )

    # 5. Specific Weapon Perks / Origin Traits / Weapon Mods
    wp = db.get("weapon_perks", {})
    perk_hits = []
    for cat_key, label in (("traits", "Weapon Trait"), ("origin_traits", "Origin Trait"), ("mods", "Weapon Mod"), ("intrinsics", "Intrinsic Frame")):
        for p in wp.get(cat_key, []):
            pn = _norm(p["name"])
            # Require word-boundary match for shorter perk names so common words like "onerous" or "slice" don't false-trigger randomly
            if len(pn) >= 6 and pn in ml_norm:
                perk_hits.append((len(pn), f"[{label.upper()}] {p['name']}: {p['description']}"))
            elif 4 <= len(pn) < 6 and re.search(rf"\b{re.escape(p['name'].lower())}\b", ml_low):
                perk_hits.append((len(pn), f"[{label.upper()}] {p['name']}: {p['description']}"))

    perk_hits.sort(key=lambda x: x[0], reverse=True)
    for _, txt in perk_hits[:5]:
        blocks.append(txt)

    return blocks[:10]


def build_compendium_context(
    message: str,
    guardian_class: str = "Warlock",
    subclass: str = "Solar",
    activity: str = "Grandmaster+",
    tactical_inquiry: str = "Ability Focused",
) -> Tuple[str, Dict[str, Any]]:
    """
    Assemble rich, multi-bucket Destiny 2 Data Compendium context tailored to the Guardian's message.
    Returns (formatted_context_string, detected_intent_dict).
    """
    db = get_compendium_db()
    intent = detect_tactical_intent(message, guardian_class, subclass, activity, tactical_inquiry)
    if not db:
        return "", intent

    eff_class = intent["effective_class"]
    eff_sub = intent["effective_subclass"]
    eff_act = intent["effective_activity"]
    sections: List[str] = []

    # Bucket 1: Direct Named Entities in Message
    direct_blocks = search_direct_compendium_entities(db, message)
    if direct_blocks:
        sections.append(
            "=== EXACT COMPENDIUM TELEMETRY FOR REFERENCED ITEMS / PERKS ===\n"
            + "\n\n".join(direct_blocks)
        )

    # If the user asks generally about armor sets / 2pc / 4pc without a specific set name
    ml = message.lower()
    if any(k in ml for k in ["armor set", "set bonus", "2 piece", "4 piece", "2-piece", "4-piece", "2pc", "4pc"]) and not intent["is_build_query"]:
        top_sets = rank_armor_sets_for_build(db, eff_sub, eff_act, message, limit=8)
        set_lines = [
            f"• {s['name']} ({s['source']}) — 2pc [{s['perk_2pc_name']}]: {s['perk_2pc_desc']} || 4pc [{s['perk_4pc_name']}]: {s['perk_4pc_desc']}"
            for s in top_sets
        ]
        sections.append("=== TOP COMPENDIUM 2-PIECE & 4-PIECE ARMOR SET BONUSES ===\n" + "\n".join(set_lines))

    # Bucket 2: Full Class + Subclass Build Telemetry
    if intent["is_build_query"] or intent["explicit_subclass"] or intent["explicit_class"]:
        sub_data = db.get("subclasses", {}).get(eff_sub, {})
        cls_sub = sub_data.get("classes", {}).get(eff_class, {})
        cls_abil = db.get("class_abilities", {}).get(eff_class, {})

        # 2a. Subclass Abilities, Aspects, Fragments & Verbs
        if sub_data:
            supers_txt = "\n".join(
                f"  - {sp['name']} ({sp['tier_info']}): {sp['description'][:260]}"
                for sp in cls_sub.get("supers", [])
            )
            melees_txt = "\n".join(
                f"  - {m['name']} ({m['cooldown']}): {m['description'][:220]}"
                for m in cls_sub.get("melees", [])
            )
            if eff_sub == "Prismatic" and cls_sub.get("shared_abilities"):
                shared_rows = cls_sub["shared_abilities"]
                if len(shared_rows) >= 2:
                    supers_txt = supers_txt or "  - Selectable Light/Dark Supers across all 5 elements"
                    melees_txt = "  - Selectable Melees: " + ", ".join(shared_rows[1])
                pg = cls_sub.get("prismatic_grenade")
                gren_txt = (
                    f"  - Prismatic Grenade — {pg['name']}: {pg['description'][:220]}\n"
                    f"  - Selectable Grenades: {', '.join(shared_rows[0]) if shared_rows else ''}"
                ) if pg else ""
            else:
                gren_txt = "\n".join(
                    f"  - {g['name']}{' (' + g['cooldown'] + ')' if g.get('cooldown') else ''}: {g['description'][:190]}"
                    for g in sub_data.get("grenades", [])[:10]
                )

            aspects_txt = "\n".join(
                f"  - {a['name']}{' [' + a['fragment_slots'] + ']' if a.get('fragment_slots') else ''}: {a['description'][:360]}"
                for a in cls_sub.get("aspects", [])
            )
            frags_txt = "\n".join(
                f"  - {f['full_name']}{' (' + f['stats'] + ')' if f.get('stats') else ''}: {f['description'][:200]}"
                for f in sub_data.get("fragments", [])
            )
            verbs_txt = "\n".join(
                f"  - {v['name']}: {v['description'][:180]}"
                for v in sub_data.get("glossary", [])[:8]
            )
            c_abil_txt = "\n".join(
                f"  - {ca['name']} ({ca['cooldown']}): {ca['description'][:170]}"
                for ca in cls_abil.get("abilities", [])
            )

            sections.append(
                f"=== UP-TO-DATE {eff_sub.upper()} {eff_class.upper()} COMPENDIUM KIT ===\n"
                f"• {eff_class} Class Abilities & Intrinsic:\n  Intrinsic: {cls_abil.get('intrinsics', '')[:200]}\n{c_abil_txt}\n"
                f"• Supers:\n{supers_txt}\n"
                f"• Melees:\n{melees_txt}\n"
                f"• Grenades & Aspect-Enhanced Variants:\n{gren_txt}\n"
                f"• {eff_sub} {eff_class} Aspects (Pick 2):\n{aspects_txt}\n"
                f"• {eff_sub} Fragments (with Modern 6-Stat Modifiers):\n{frags_txt}\n"
                f"• {eff_sub} Verbs & Pickups:\n{verbs_txt}"
            )

        # 2b. Top Matching Class Exotic Armors (+ Exotic Class Item Spirits if Prismatic)
        top_exotics = rank_exotic_armors_for_build(db, eff_class, eff_sub, message, limit=10)
        if top_exotics:
            ex_lines = [
                f"  - {ex['name']} (Perk: {ex['perk_name']}): {ex['description'][:320]}"
                for ex in top_exotics
            ]
            ex_section = f"=== TOP {eff_class.upper()} EXOTIC ARMORS FOR {eff_sub.upper()} ===\n" + "\n".join(ex_lines)
            if eff_sub == "Prismatic":
                eci = db.get("exotic_class_items", {})
                spirits = eci.get("Shared", []) + eci.get(eff_class, [])
                sp_lines = [f"  - {sp['name']} ({sp['column']}): {sp['description'][:170]}" for sp in spirits[:12]]
                ex_section += f"\n• Exotic Class Item Spirits ({eci.get('note', '')}):\n" + "\n".join(sp_lines)
            sections.append(ex_section)

        # 2c. Top Matching 2-Piece & 4-Piece Armor Set Bonuses
        top_sets = rank_armor_sets_for_build(db, eff_sub, eff_act, message, limit=6)
        if top_sets:
            set_lines = [
                f"  - {s['name']} (Source: {s['source']})\n"
                f"      2-Piece [{s['perk_2pc_name']}]: {s['perk_2pc_desc'][:240]}\n"
                f"      4-Piece [{s['perk_4pc_name']}]: {s['perk_4pc_desc'][:260]}"
                for s in top_sets
            ]
            sections.append(
                f"=== RECOMMENDED 2-PIECE & 4-PIECE ARMOR SET BONUSES FOR {eff_sub.upper()} {eff_class.upper()} ===\n"
                "Note: Guardians can run a full 4-Piece Set Bonus OR mix two 2-Piece Set Bonuses (4 legendary armor pieces alongside 1 Exotic Armor piece = either 4pc of one set OR 2pc + 2pc)!\n"
                + "\n".join(set_lines)
            )

        # 2d. Top Matching Equippable Artifacts & Perks
        top_arts = rank_artifacts_for_build(db, eff_sub, message, limit=2)
        if top_arts:
            art_lines = []
            for art in top_arts:
                p_lines = [f"      • {p['name']} ({p['tier']}): {p['description'][:180]}" for p in art["recommended_perks"]]
                art_lines.append(
                    f"  - Equippable Artifact: {art['name']}"
                    + (f" [{art['focus']}]" if art.get("focus") else "")
                    + "\n" + "\n".join(p_lines)
                )
            sections.append(
                "=== RECOMMENDED EQUIPPABLE ARTIFACT & PERKS (Past & Current Artifacts Are Equippable!) ===\n"
                + "\n".join(art_lines)
            )

        # 2e. Modern Armor Mods & 0-200 Stat Curves (Strict PVE Zero-Health vs PVP Health split)
        gm = db.get("game_mechanics", {})
        if gm.get("modern_stats"):
            is_pvp_mode = "pvp" in eff_act.lower() or any(k in ml for k in ["pvp", "crucible", "trials", "iron banner", "competitive"])
            if is_pvp_mode:
                st_lines = [
                    f"  - {st['stat']} (0–200): {st['description'].replace(chr(10), ' ')[:260]}"
                    for st in gm["modern_stats"]
                ]
                sections.append(
                    "=== EXACT MODERN 0–200 PVP STAT SCALING & ARMOR MODS ===\n"
                    "  • PVP STAT PRIORITY: Health IS highly valuable in PVP (ADS flinch resist & faster shield recharge between duels), alongside Weapons, Class, Grenade, Melee, and Super.\n"
                    + "\n".join(st_lines)
                    + "\n  - Armor Mods: Targeting / In-Flight Compensator (Helmet), Dexterity / Loader (Arms), Unflinching Aim / Health Font (Chest), Holster / Weapons Font (Legs), Reaper / Bomber / Outreach (Class Item)."
                )
            else:
                st_lines = [
                    f"  - {st['stat']} (0–200): {st['description'].replace(chr(10), ' ')[:260]}"
                    for st in gm["modern_stats"]
                    if st["stat"] != "Health"
                ]
                sections.append(
                    "=== EXACT MODERN 0–200 PVE STAT SCALING & ARMOR FONT MODS ===\n"
                    "  • STRICT PVE RULE: NEVER recommend investing in the Health stat or Health Font for ANY PVE build! Health is ONLY important in PVP and is a 0-investment dump stat in PVE. Allocate 100% of PVE stats into Grenade, Melee, Weapons, Super, and Class!\n"
                    + "\n".join(st_lines)
                    + "\n  - Modern PVE Armor Mods: Harmonic Siphon & Super Font (Helmet), Firepower / Heavy Handed & Grenade Font / Melee Font (Arms), Elemental Resistance & Charged Up / Ammo Generation (Chest), Weapon Surge & Weapons Font / Recuperation (Legs), Class Font & Time Dilation & Reaper & Powerful Attraction (Class Item)."
                )

    return "\n\n".join(sections), intent


def build_item_compendium_context(item: Dict[str, Any]) -> str:
    """Enrich live inventory 'Ask F.E.L.I.C.I.A.' item appraisals with exact Compendium perk, Exotic, Catalyst, and Armor Set data."""
    db = get_compendium_db()
    if not db or not item:
        return ""

    name = item.get("name", "")
    name_norm = _norm(name)
    category = item.get("category", "Weapon")
    lines: List[str] = []

    if category == "Armor":
        # Check Exotic Armors
        if item.get("isExotic"):
            for cls_name, armors in db.get("exotic_armors", {}).items():
                for ex in armors:
                    if _norm(ex["name"]) == name_norm or (_norm(ex["name"]) and _norm(ex["name"]) in name_norm):
                        lines.append(
                            f"• Compendium Exotic Armor Data — {ex['name']} ({cls_name}, Perk: {ex['perk_name']}):\n  {ex['description']}"
                        )
            # Check Exotic Class Item Spirits on socketed perks
            eci = db.get("exotic_class_items", {})
            all_spirits = eci.get("Shared", []) + eci.get("Hunter", []) + eci.get("Titan", []) + eci.get("Warlock", [])
            item_perk_norms = {_norm(p.get("name", "")) for p in item.get("activePerks", [])}
            for col in item.get("perkColumns", []):
                for o in col:
                    item_perk_norms.add(_norm(o.get("name", "")))
            for sp in all_spirits:
                if _norm(sp["name"]) in item_perk_norms:
                    lines.append(f"• Exotic Class Item Spirit — {sp['name']} ({sp['column']}): {sp['description']}")

        # Check 56 Armor Sets (match set prefix in armor piece name or active perks)
        active_perk_norms = {_norm(p.get("name", "")) for p in item.get("activePerks", [])}
        for s in db.get("armor_sets", []):
            sn = _norm(s["name"])
            p2 = _norm(s["perk_2pc_name"])
            p4 = _norm(s["perk_4pc_name"])
            if (len(sn) >= 4 and sn in name_norm) or (p2 and p2 in active_perk_norms) or (p4 and p4 in active_perk_norms):
                lines.append(
                    f"• Compendium Armor Set Bonus — {s['name']} ({s['source']}):\n"
                    f"  - 2-Piece [{s['perk_2pc_name']}]: {s['perk_2pc_desc']}\n"
                    f"  - 4-Piece [{s['perk_4pc_name']}]: {s['perk_4pc_desc']}"
                )
    else:
        # Weapon: check Exotic Weapons
        if item.get("isExotic"):
            for ew in db.get("exotic_weapons", []):
                if _norm(ew["name"]) == name_norm or (_norm(ew["name"]) and _norm(ew["name"]) in name_norm):
                    cat_str = f" | Catalyst (↑): {', '.join(ew['catalyst_traits'])}" if ew.get("catalyst_traits") else ""
                    lines.append(
                        f"• Compendium Exotic Weapon Data — {ew['name']} ({ew['slot']}{cat_str}):\n  {ew['description']}"
                    )

        # Match rolled weapon traits & origin traits in Compendium
        wp = db.get("weapon_perks", {})
        trait_lookup = {
            _norm(t["name"]): t
            for bucket in ("traits", "origin_traits", "intrinsics")
            for t in wp.get(bucket, [])
        }
        seen_perks = set()
        for col in item.get("perkColumns", []):
            for opt in col:
                raw_p = opt.get("name", "").replace("Enhanced ", "").strip()
                pn = _norm(raw_p)
                if pn in trait_lookup and pn not in seen_perks:
                    seen_perks.add(pn)
                    t_entry = trait_lookup[pn]
                    lines.append(f"• Compendium Perk [{t_entry['name']}]: {t_entry['description'][:240]}")

    if not lines:
        return ""
    return "\n★ DESTINY 2 DATA COMPENDIUM ITEM TELEMETRY:\n" + "\n".join(lines[:10]) + "\n"


_META_ASPECT_PRIORITY: Dict[Tuple[str, str], List[str]] = {
    ("Warlock", "Void"): ["Feed the Void", "Chaos Accelerant", "Child of the Old Gods", "Soul Siphon"],
    ("Warlock", "Solar"): ["Touch of Flame", "Hellion", "Heat Rises", "Icarus Dash"],
    ("Warlock", "Arc"): ["Electrostatic Mind", "Ionic Sentry", "Arc Soul", "Lightning Surge"],
    ("Warlock", "Stasis"): ["Bleak Watcher", "Iceflare Bolts", "Glacial Harvest", "Frostpulse"],
    ("Warlock", "Strand"): ["Mindspun Invocation", "Weaver's Call", "The Wanderer", "Weavewalk"],
    ("Warlock", "Prismatic"): ["Feed the Void", "Bleak Watcher", "Hellion", "Lightning Surge"],
    ("Titan", "Void"): ["Controlled Demolition", "Offensive Bulwark", "Unbreakable", "Bastion"],
    ("Titan", "Solar"): ["Sol Invictus", "Roaring Flames", "Consecration", "Shieldburst"],
    ("Titan", "Arc"): ["Storm's Keep", "Touch of Thunder", "Knockout", "Juggernaut"],
    ("Titan", "Stasis"): ["Howl of the Storm", "Tectonic Harvest", "Diamond Lance", "Cryoclasm"],
    ("Titan", "Strand"): ["Banner of War", "Into The Fray", "Flechette Storm", "Drengr's Lash"],
    ("Titan", "Prismatic"): ["Consecration", "Knockout", "Diamond Lance", "Unbreakable"],
    ("Hunter", "Void"): ["Stylish Executioner", "On The Prowl", "Vanishing Step", "Trapper's Ambush"],
    ("Hunter", "Solar"): ["Knock 'Em Down", "Gunpowder Gamble", "Crackshot", "On Your Mark"],
    ("Hunter", "Arc"): ["Combination Blow", "Flow State", "Ascension", "Tempest Strike", "Lethal Current"],
    ("Hunter", "Stasis"): ["Grim Harvest", "Touch of Winter", "Winter's Shroud", "Shatterdive"],
    ("Hunter", "Strand"): ["Whirling Maelstrom", "Widow's Silk", "Threaded Specter", "Ensnaring Slam"],
    ("Hunter", "Prismatic"): ["Stylish Executioner", "Winter's Shroud", "Ascension", "Gunpowder Gamble"],
}

_META_FRAGMENT_PRIORITY: Dict[str, List[str]] = {
    "Void": ["Echo of Starvation", "Echo of Instability", "Echo of Persistence", "Echo of Harvest", "Echo of Undermining"],
    "Solar": ["Ember of Ashes", "Ember of Empyrean", "Ember of Torches", "Ember of Benevolence", "Ember of Singeing"],
    "Arc": ["Spark of Shock", "Spark of Ions", "Spark of Resistance", "Spark of Discharge", "Spark of Frequency"],
    "Stasis": ["Whisper of Rime", "Whisper of Shards", "Whisper of Torment", "Whisper of Conduction", "Whisper of Fissures"],
    "Strand": ["Thread of Generation", "Thread of Warding", "Thread of Continuity", "Thread of Rebirth", "Thread of Fury"],
    "Prismatic": ["Facet of Protection", "Facet of Purpose", "Facet of Dominance", "Facet of Hope", "Facet of Courage"],
}


def build_compendium_fallback_reply(
    message: str,
    guardian_class: str = "Warlock",
    subclass: str = "Solar",
    activity: str = "Grandmaster+",
    tactical_inquiry: str = "Ability Focused",
) -> Optional[str]:
    """Deterministic data-backed fallback reply using Compendium data if Gemini is ever unavailable."""
    db = get_compendium_db()
    if not db:
        return None

    intent = detect_tactical_intent(message, guardian_class, subclass, activity, tactical_inquiry)
    eff_class = intent["effective_class"]
    eff_sub = intent["effective_subclass"]
    eff_act = intent["effective_activity"]

    # Direct single Armor Set / Exotic / Perk lookup first if not a full build query
    direct = search_direct_compendium_entities(db, message)
    if direct and not intent["is_build_query"]:
        return (
            "Right then, Guardian. Here is the verified Vanguard telemetry straight from the Data Compendium:\n\n"
            + "\n\n".join(direct[:5])
            + "\n\nLet me know if you want me to build a full subclass, Exotic, and 2-piece / 4-piece Armor Set setup around this!"
        )

    ml = message.lower()
    if any(k in ml for k in ["armor set", "set bonus", "2 piece", "4 piece", "2-piece", "4-piece", "2pc", "4pc"]) and not intent["is_build_query"]:
        top_sets = rank_armor_sets_for_build(db, eff_sub, eff_act, message, limit=5)
        set_blocks = [
            f"• **{s['name']}** ({s['source']})\n"
            f"  - **2-Piece ({s['perk_2pc_name']}):** {s['perk_2pc_desc'].replace(chr(10), ' ')}\n"
            f"  - **4-Piece ({s['perk_4pc_name']}):** {s['perk_4pc_desc'].replace(chr(10), ' ')}"
            for s in top_sets
        ]
        return (
            f"Right then, Guardian. Here are the top **2-Piece & 4-Piece Armor Set Bonuses** from the Data Compendium for **{eff_sub}** ({eff_act}):\n\n"
            + "\n\n".join(set_blocks)
            + "\n\nRemember, since you wear 1 Exotic Armor piece alongside 4 Legendary pieces, you can run a full **4-Piece bonus** OR mix two **2-Piece bonuses**!"
        )

    if intent["is_build_query"] or intent["explicit_subclass"] or intent["explicit_class"]:
        sub_data = db.get("subclasses", {}).get(eff_sub, {})
        cls_sub = sub_data.get("classes", {}).get(eff_class, {})

        # Rank Aspects using endgame priority list while keeping full Compendium descriptions
        raw_aspects = cls_sub.get("aspects", [])
        prio_names = _META_ASPECT_PRIORITY.get((eff_class, eff_sub), [])
        sorted_aspects = sorted(
            raw_aspects,
            key=lambda a: prio_names.index(a["name"]) if a["name"] in prio_names else 99,
        )
        primary_aspects = sorted_aspects[:2]
        alt_aspects = [a["name"] for a in sorted_aspects[2:]]

        supers = [s["name"] for s in cls_sub.get("supers", [])[:2]]
        melees = [m["name"] for m in cls_sub.get("melees", [])[:1]]
        grens = [g["name"] for g in sub_data.get("grenades", []) if "charged" not in g["name"].lower() and "supernova" not in g["name"].lower()][:2]

        raw_frags = sub_data.get("fragments", [])
        f_prio = _META_FRAGMENT_PRIORITY.get(eff_sub, [])
        sorted_frags = sorted(
            raw_frags,
            key=lambda f: f_prio.index(f["full_name"]) if f["full_name"] in f_prio else 99,
        )
        frags_fmt = [
            f"**{f['full_name']}**" + (f" ({f['stats']})" if f.get("stats") else "")
            for f in sorted_frags[:4]
        ]

        exotics = rank_exotic_armors_for_build(db, eff_class, eff_sub, message, limit=4)
        sets = rank_armor_sets_for_build(db, eff_sub, eff_act, message, limit=3)
        arts = rank_artifacts_for_build(db, eff_sub, message, limit=1)

        aspect_lines = "\n".join(
            f"  - **{a['name']}:** {a['description'].splitlines()[0]}"
            for a in primary_aspects
        )
        if alt_aspects:
            aspect_lines += f"\n  - *Flex Aspect Options:* {', '.join(alt_aspects)}"

        ex_text = "\n".join(
            f"• **{ex['name']}** (*{ex['perk_name']}*): {ex['description'].splitlines()[0]}"
            for ex in exotics
        ) or "• Class-matching Exotic Armor"

        set_text = "\n".join(
            f"• **{s['name']}** ({s['source']})\n"
            f"  - **2-Piece ({s['perk_2pc_name']}):** {' '.join(ln.strip() for ln in s['perk_2pc_desc'].splitlines() if ln.strip())[:200]}\n"
            f"  - **4-Piece ({s['perk_4pc_name']}):** {' '.join(ln.strip() for ln in s['perk_4pc_desc'].splitlines() if ln.strip())[:200]}"
            for s in sets
        )

        art_text = ""
        if arts:
            a0 = arts[0]
            p_names = ", ".join(p["name"] for p in a0["recommended_perks"][:5])
            art_text = f"• **Equippable Artifact:** **{a0['name']}** — Key Perks: {p_names}\n"

        is_pvp_mode = "pvp" in eff_act.lower() or any(k in ml for k in ["pvp", "crucible", "trials", "iron banner", "competitive"])
        if is_pvp_mode:
            mods_line = (
                "• **Core PVP Armor Mods:** Targeting + Siphon (Helmet), Dexterity + Loader (Arms), "
                "Unflinching Aim (Chest), Holster / Scavenger (Legs), Bomber / Outreach + Reaper (Class Item).\n"
            )
            stats_line = (
                "• **PVP Stat Targets (0–200 System):** Push **Health** toward **150–200** (for ADS flinch resist and rapid shield recharge between duels), "
                "pair with high **Weapons** and **Class**, and invest remaining points into **Grenade**, **Melee**, or **Super**.\n\n"
            )
        else:
            mods_line = (
                f"• **Core PVE Armor Mods:** Harmonic Siphon + Super Font (Helmet), Firepower/Heavy Handed + Grenade/Melee Font (Arms), "
                f"Elemental Damage Resistance + Charged Up / Ammo Generation (Chest), 2x {eff_sub} Weapon Surge + Weapons Font / Recuperation (Legs), "
                f"Reaper + Powerful Attraction + Time Dilation (Class Item).\n"
            )
            stats_line = (
                "• **PVE Stat Targets (0–200 System):** Push **Grenade** (up to +65% grenade damage at 200) or **Melee** (up to +30% melee damage at 200) toward **150–200**, "
                "dial **Weapons** (bonus Boss damage & ammo bricks) and **Super** (up to +45% Super damage) to **100–150+**, "
                "and put remaining points into **Class** as needed. *(Leave **Health at 0**—Health is strictly a PVP stat and is not needed at all in PVE!)*\n\n"
            )

        return (
            f"Right then, Guardian. Let us get down to business with an up-to-date **{eff_sub} {eff_class}** blueprint for **{eff_act}**:\n\n"
            f"### 1. Subclass & Ability Configuration\n"
            f"• **Super:** {' or '.join(supers) if supers else 'Matching Subclass Super'}\n"
            f"• **Grenade & Melee:** {grens[0] if grens else 'Subclass Grenade'} | {melees[0] if melees else 'Subclass Powered Melee'}\n"
            f"• **Core Aspects:**\n{aspect_lines}\n"
            f"• **Key Fragments:** {', '.join(frags_fmt)}\n\n"
            f"### 2. Exotic Armor Centerpiece\n{ex_text}\n\n"
            f"### 3. Recommended 2-Piece & 4-Piece Armor Set Bonuses\n"
            f"*Run a full 4-piece set bonus or mix two 2-piece bonuses across your 4 legendary armor slots:*\n{set_text}\n\n"
            f"### 4. Artifact, Armor Mods & 0–200 Stat Targets\n"
            f"{art_text}"
            f"{mods_line}"
            f"{stats_line}"
            f"Spot on setup, Guardian. Tell me which Exotic you have in your Vault and I will dial in the exact weapon rolls to pair with it!"
        )

    return None
