"""
make_test_roster.py - makes FAKE scholars so the app can be tested safely.

HOW TO USE
    python3 tools/build_layouts.py      (first, if you changed a layout)
    python3 tools/make_test_roster.py

Every name here is invented by shuffling two word lists. No real GSP scholar
data belongs in this repository - real rosters get uploaded through the
admin page on the day, straight into the private database.
"""

import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAYOUT_DIR = ROOT / "public" / "layouts"
OUT_DIR = ROOT / "public" / "testdata"

FIRST = ["Amara", "Jalen", "Nia", "Malik", "Zuri", "Elijah", "Imani", "Kofi", "Sade", "Darius", "Laila", "Micah",
         "Ayana", "Tariq", "Simone", "Andre", "Kiara", "Isaiah", "Naomi", "Xavier", "Thandi", "Jordan", "Maya",
         "Caleb", "Aaliyah", "Desmond", "Nyla", "Marcus", "Selam", "Trey", "Ebony", "Josiah", "Kenya", "Omari",
         "Jada", "Langston", "Zora", "Miles", "Asha", "Devon"]
LAST = ["Testwell", "Sampleton", "Mockford", "Demoson", "Trialby", "Fakewood", "Placeholder", "Exampleby",
        "Draftman", "Pilotte", "Betaworth", "Sandbox", "Prototype", "Dryrun", "Rehearsal", "Stubbs",
        "Dummont", "Testerman", "Specimen", "Practise"]
TOPICS = ["Which paper towel absorbs the most water?", "Does music help plants grow?", "Solar oven efficiency",
          "How temperature changes a basketball's bounce", "Which bridge shape holds the most weight?",
          "Do video games affect reaction time?", "Cleaning water with homemade filters", "Battery life: brand vs. price",
          "How salt changes the freezing point of water", "Wind turbine blade angles", "Growing crystals faster",
          "Does caffeine affect typing speed?", "Soil pH and bean sprouts", "Paper airplane wing designs",
          "A low-cost air quality sensor", "Composting with worms", "Rainwater capture for school gardens",
          "An app that reminds you to drink water", "A backpack that charges your phone", "Sorting recycling with a robot arm"]


def grade_for(section, rng):
    """Pick a grade number that fits a section name like 'Grades 5-6' or 'Expo - Invention'."""
    digits = [int(part) for part in section.replace("-", " ").split() if part.isdigit()]
    if digits:
        return rng.randint(min(digits), max(digits))
    if section == "Seniors":
        return 12
    return rng.randint(7, 10)  # Expo projects


def category_for(section):
    if "Env" in section and "Inv" in section:
        return "Expo"
    if "Env" in section:
        return "Expo - Environmental"
    if "Inv" in section:
        return "Expo - Invention"
    if section == "Seniors":
        return "Senior Board"
    return "Hypothesis"


def make_roster(layout, seed):
    rng = random.Random(seed)
    names = [f"{first} {last}" for first in FIRST for last in LAST]
    rng.shuffle(names)
    roster = []
    for t in layout["tables"]:
        # Fill most tables to 3 or 4 scholars, like the real fair.
        for _ in range(rng.choice([3, 3, 4]) if t["capacity"] <= 4 else 4):
            roster.append({
                "name": names.pop(),
                "grade": str(grade_for(t["section"], rng)),
                "category": category_for(t["section"]),
                "title": "TEST - " + rng.choice(TOPICS),
                "section": t["section"],
            })
    roster.sort(key=lambda s: s["name"])
    return roster


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for path in sorted(LAYOUT_DIR.glob("2*.json")):
        layout = json.loads(path.read_text())
        roster = make_roster(layout, seed=int(layout["id"]))
        (OUT_DIR / f"roster-{layout['id']}.json").write_text(json.dumps(roster, indent=1))
        print(f"{layout['id']}: {len(roster)} fake scholars")
