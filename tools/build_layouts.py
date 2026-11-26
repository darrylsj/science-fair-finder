"""
build_layouts.py - turns the gym maps into data the web app can draw.

HOW TO USE
    python3 tools/build_layouts.py

It writes one JSON file per science fair into public/layouts/.
All positions are in FEET, measured from the top-left corner of the room,
copied from the layout drawings in the GSP Science Fair Google Drive.

TO ADD A NEW YEAR (for example 2028):
    1. Copy the make_2026() function and rename it make_2028().
    2. Change the table positions to match the new drawing.
    3. Add it to the LAYOUTS list at the bottom of this file.
    4. Run this script again.
"""

import json
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "layouts"

# Colors copied from the 2026 drawing.
GREEN, PINK = "#16b877", "#f43f6b"
ORANGE, YELLOW = "#ffab7a", "#ffe97a"
BLUE, PURPLE = "#1ea7e1", "#7b5cf0"
WHITE, GRAY, BLACK = "#ffffff", "#e3e6ea", "#16181d"


def table(number, x, y, section, color, w=2.5, h=8.0, capacity=4):
    """One project table. x and y are the CENTER of the table, in feet."""
    return {
        "id": str(number),
        "x": round(x, 1),
        "y": round(y, 1),
        "w": w,
        "h": h,
        "section": section,
        "color": color,
        "capacity": capacity,
    }


def make_2026():
    """Bellarmine gym, January 24 2026. 46 tables. Source: BCP-scholar-board-layout2025-26."""
    # Column positions (feet from the left wall) and row positions (feet from the top wall).
    col = [5.5, 14.0, 22.5, 31.0, 39.4, 48.0, 56.5, 65.5, 74.0, 83.9, 92.0, 99.9]
    row = [16.7, 30.7, 47.5, 61.6]

    g3, g4, g56, g78, g910 = "Grade 3", "Grade 4", "Grades 5-6", "Grades 7-8", "Grades 9-10"
    env, inv = "Expo - Environmental", "Expo - Invention"

    # (table number, column index, row index, section, color)
    spots = [
        (1, 0, 0, g3, GREEN), (2, 1, 0, g3, GREEN), (3, 0, 1, g3, GREEN),
        (4, 1, 1, g4, PINK), (5, 0, 2, g4, PINK), (6, 1, 2, g4, PINK),
        (7, 0, 3, g4, PINK), (8, 1, 3, g4, PINK), (9, 2, 3, g4, PINK), (10, 3, 3, g4, PINK),
        (11, 2, 0, g56, ORANGE), (12, 3, 0, g56, ORANGE), (13, 4, 0, g56, ORANGE),
        (14, 2, 1, g56, ORANGE), (15, 3, 1, g56, ORANGE), (16, 4, 1, g56, YELLOW),
        (17, 2, 2, g56, YELLOW), (18, 3, 2, g56, YELLOW), (19, 4, 2, g56, YELLOW),
        (20, 4, 3, g56, YELLOW),
        (21, 5, 0, g78, BLUE), (22, 6, 0, g78, BLUE), (23, 5, 1, g78, BLUE), (24, 6, 1, g78, BLUE),
        (25, 5, 2, g78, PURPLE), (26, 6, 2, g78, PURPLE), (27, 5, 3, g78, PURPLE), (28, 6, 3, g78, PURPLE),
        (29, 7, 0, g910, WHITE), (30, 8, 0, g910, WHITE), (31, 7, 1, g910, WHITE),
        (32, 8, 1, g910, WHITE), (33, 7, 2, g910, WHITE), (34, 8, 2, g910, WHITE),
        (35, 9, 0, env, GRAY), (36, 10, 0, env, GRAY), (37, 11, 0, env, GRAY), (38, 9, 1, env, GRAY),
        (39, 10, 1, inv, BLACK), (40, 11, 1, inv, BLACK),
        (41, 9, 2, inv, BLACK), (42, 10, 2, inv, BLACK), (43, 11, 2, inv, BLACK),
        (44, 9, 3, inv, BLACK), (45, 10, 3, inv, BLACK), (46, 11, 3, inv, BLACK),
    ]
    tables = [table(n, col[c], row[r], sec, color) for (n, c, r, sec, color) in spots]

    return {
        "id": "2026",
        "name": "2026 - Bellarmine Gym",
        "venue": "Bellarmine College Preparatory gym",
        "date": "2026-01-24",
        "width": 104.25,
        "height": 69.0,
        "tables": tables,
        "labels": [
            {"text": "Grade 3", "x": 9.7, "y": 9.6, "color": GREEN},
            {"text": "Grade 4", "x": 9.7, "y": 39.4, "color": PINK},
            {"text": "Grades 5-6", "x": 31.0, "y": 9.6, "color": "#e8833f"},
            {"text": "Grades 7-8", "x": 52.2, "y": 9.6},
            {"text": "Grades 9-10", "x": 69.7, "y": 9.6},
            {"text": "Expo - Envir", "x": 91.9, "y": 9.6, "size": 2.0},
            {"text": "Expo - Invent", "x": 91.9, "y": 40.5, "size": 2.0},
        ],
        "desks": [{"text": "Scholar/Judge Support", "x": 50.4, "y": 2.9, "w": 8.0, "h": 2.4}],
        "doors": [
            {"side": "left", "at": 4.9}, {"side": "right", "at": 4.9},
            {"side": "left", "at": 35.3}, {"side": "right", "at": 35.3},
        ],
        # Dividing lines between grade areas: [x1, y1, x2, y2, color]
        "lines": [
            [18.3, 10.4, 18.3, 54.6, ORANGE], [18.3, 54.9, 34.6, 54.9, PINK], [34.8, 55.2, 34.8, 67.5, ORANGE],
            [43.8, 10.6, 43.8, 68.0, "#6b7280"], [60.8, 11.5, 60.8, 68.0, "#6b7280"], [79.5, 11.5, 79.5, 68.0, "#6b7280"],
        ],
    }


def make_2027():
    """Bellarmine gym, January 23 2027.

    DRAFT based on the 2026 Bellarmine map: same room, same 46 table positions and numbers.
    New for 2027: there are NO separate Expo tables. Applied Engineering projects sit with
    their grade, so the 12 tables that were Expo in 2026 (35-46) now belong to Grades 9-10
    and the grade areas were widened to fit this year's sign-ups:

        Grade 3      tables  1-4     Grades 7-8   tables 21-34
        Grade 4      tables  5-8     Grades 9-10  tables 35-46
        Grades 5-6   tables  9-20

    To move a boundary, change the numbers in AREAS below and run this script again.
    """
    AREAS = [  # (first table, last table, area name, color)
        (1, 4, "Grade 3", GREEN),
        (5, 8, "Grade 4", PINK),
        (9, 20, "Grades 5-6", ORANGE),
        (21, 34, "Grades 7-8", BLUE),
        (35, 46, "Grades 9-10", PURPLE),
    ]
    layout = make_2026()
    layout["id"] = "2027"
    layout["name"] = "2027 - Bellarmine Gym"
    layout["date"] = "2027-01-23"
    for t in layout["tables"]:
        for first, last, name, color in AREAS:
            if first <= int(t["id"]) <= last:
                t["section"], t["color"] = name, color
    layout["labels"] = [
        {"text": "Grade 3", "x": 9.7, "y": 9.6, "color": GREEN},
        {"text": "Grade 4", "x": 9.7, "y": 39.4, "color": PINK},
        {"text": "Grades 5-6", "x": 31.0, "y": 9.6, "color": "#e8833f"},
        {"text": "Grades 7-8", "x": 61.0, "y": 9.6, "color": "#1582b3"},
        {"text": "Grades 9-10", "x": 91.9, "y": 9.6, "color": "#5b3fd6"},
    ]
    layout["lines"] = [
        [18.3, 10.4, 18.3, 67.5, "#9ca3af"], [43.8, 10.6, 43.8, 68.0, "#9ca3af"], [79.5, 11.5, 79.5, 68.0, "#9ca3af"],
    ]
    return layout


def make_2025():
    """Bellarmine gym, January 25 2025. 36 tables numbered in a snake. Source: Bellarmine gym layout2025.pdf"""
    col = [11.6, 22.1, 32.7, 43.2, 53.8, 64.0, 74.6, 85.3, 95.6]
    row = [20.5, 31.9, 43.3, 55.6]
    g34, g56, g78, g910 = "Grades 3-4", "Grades 5-6", "Grades 7-8", "Grades 9-10"
    section_of = {}
    for n in range(1, 10): section_of[n] = g34
    for n in range(10, 20): section_of[n] = g56
    for n in range(20, 30): section_of[n] = g78
    for n in range(30, 37): section_of[n] = g910
    color_of = {}
    for n in range(1, 5): color_of[n] = "#8bc34a"
    for n in range(5, 10): color_of[n] = PINK
    for n in range(10, 14): color_of[n] = "#f59e0b"
    for n in range(14, 20): color_of[n] = YELLOW
    for n in range(20, 25): color_of[n] = BLUE
    for n in range(25, 30): color_of[n] = PURPLE
    for n in range(30, 33): color_of[n] = WHITE
    for n in range(33, 37): color_of[n] = BLACK

    tables = []
    number = 1
    for c in range(9):
        rows = [0, 1, 2, 3] if c % 2 == 0 else [3, 2, 1, 0]  # snake: down, then up, then down...
        for r in rows:
            tables.append(table(number, col[c], row[r], section_of[number], color_of[number]))
            number += 1

    return {
        "id": "2025",
        "name": "2025 - Bellarmine Gym",
        "venue": "Bellarmine College Preparatory gym",
        "date": "2025-01-25",
        "width": 104.25,
        "height": 69.0,
        "tables": tables,
        "labels": [
            {"text": "Grades 3-4", "x": 19.0, "y": 11.0},
            {"text": "Grades 5-6", "x": 46.5, "y": 11.0},
            {"text": "Grades 7-8", "x": 69.0, "y": 11.0},
            {"text": "Grades 9-10", "x": 90.0, "y": 11.0},
            {"text": "Senior Boards", "x": 22.0, "y": 3.4, "size": 1.8},
            {"text": "Main Entrance", "x": 7.5, "y": 6.6, "size": 1.6, "color": "#dc2626"},
        ],
        "desks": [
            {"text": "Scholar/Judge Support", "x": 80.0, "y": 1.6, "w": 8.0, "h": 2.0},
            {"text": "", "x": 26.0, "y": 0.9, "w": 22.0, "h": 1.2},
            {"text": "", "x": 1.6, "y": 31.0, "w": 1.6, "h": 44.0},
        ],
        "doors": [{"side": "left", "at": 3.5}, {"side": "right", "at": 3.5}, {"side": "right", "at": 63.0}],
        "lines": [
            [37.9, 10.0, 37.9, 26.8, "#9ca3af"], [27.9, 26.8, 37.9, 26.8, "#9ca3af"], [27.9, 26.8, 27.9, 62.0, "#9ca3af"],
            [58.9, 10.0, 58.9, 49.5, "#9ca3af"], [48.5, 49.5, 58.9, 49.5, "#9ca3af"], [48.5, 49.5, 48.5, 62.0, "#9ca3af"],
            [80.0, 10.0, 80.0, 49.5, "#9ca3af"], [80.0, 49.5, 90.3, 49.5, "#9ca3af"], [90.3, 49.5, 90.3, 62.0, "#9ca3af"],
        ],
    }


def make_2023():
    """Emmanuel Baptist Church Family Life Center, January 28 2023. Source: 2023SF-gym-layout.pdf

    The 2023 drawing labelled tables by grade and had NO table numbers,
    so the numbers below were made up for testing (left to right, top to bottom).
    """
    col = [14.6, 26.5, 38.7, 50.7, 66.3, 78.5, 90.7]
    row = [12.0, 23.7, 35.4, 47.2, 59.4]
    grid = [
        ["Grade 8", "Grades 7-8", "Grade 7", "Grade 6", "Grade 6", "Grade 6", "Grade 6"],
        ["Grade 9", "Grade 8", "Grade 7", "Grade 6", "Grade 5", "Grade 5", "Grade 5"],
        ["Grade 9", "Grades 9-10", "Grade 10", None, "Grade 4", "Grades 4-5", "Grade 5"],
        ["Expo - Environmental", "Expo - Environmental", "Grade 10", None, "Grade 4", "Grade 4", "Grade 4"],
        ["Expo - Env & Inv", "Expo - Invention", "Expo - Invention", None, "Grade 3", "Grade 3", "Grade 3"],
    ]
    palette = {
        "Grade 3": GREEN, "Grade 4": PINK, "Grades 4-5": "#fb8a8f", "Grade 5": ORANGE, "Grade 6": YELLOW,
        "Grade 7": BLUE, "Grades 7-8": "#5d86e8", "Grade 8": PURPLE,
        "Grade 9": WHITE, "Grades 9-10": WHITE, "Grade 10": WHITE,
        "Expo - Environmental": GRAY, "Expo - Env & Inv": "#8b9099", "Expo - Invention": BLACK,
    }
    tables = []
    number = 1
    for r, names in enumerate(grid):
        for c, section in enumerate(names):
            if section is None:
                continue
            tables.append(table(number, col[c], row[r], section, palette[section], w=9.0, h=2.8))
            number += 1
    for x in [13.3, 26.7, 38.5, 51.1, 62.8, 74.4]:
        tables.append(table(number, x, 73.7, "Seniors", "#c7d2fe", w=9.0, h=2.2, capacity=6))
        number += 1

    return {
        "id": "2023",
        "name": "2023 - Emmanuel Baptist FLC",
        "venue": "Emmanuel Baptist Church, Family Life Center, San Jose",
        "date": "2023-01-28",
        "width": 105.0,
        "height": 77.0,
        "tableLabels": "section",  # this drawing shows the grade on each table
        "tables": tables,
        "labels": [], "desks": [], "doors": [], "lines": [],
    }


# Only the fairs listed here appear in the drop-down on the website.
# make_2025() and make_2023() are kept above for reference; add them back here to show them again.
LAYOUTS = [make_2027(), make_2026()]
DEFAULT_EVENT = "2027"

if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index = []
    for layout in LAYOUTS:
        path = OUT_DIR / f"{layout['id']}.json"
        path.write_text(json.dumps(layout, indent=1))
        index.append({"id": layout["id"], "name": layout["name"], "default": layout["id"] == DEFAULT_EVENT})
        print(f"wrote {path.name}: {len(layout['tables'])} tables")
    (OUT_DIR / "index.json").write_text(json.dumps(index, indent=1))
    print("wrote index.json")
