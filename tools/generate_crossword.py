#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Генератор кроссворда по списку лексики.

Запуск:
    py tools/generate_crossword.py --seconds 12 --seed 7

На выходе создаёт puzzle.js с раскладкой и вопросами.
"""

from __future__ import annotations

import argparse
import random
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "puzzle.js"

# (ответ, вопрос) — ответы вписываются в сетку без дефисов и пробелов.
WORDS = [
    ("CORRESPONDENCE", "Заочная форма; занятия по переписке."),
    ("PEDAGOGICAL", "Связанный с преподаванием и воспитанием."),
    ("PERIODICALS", "Газеты и журналы, выходящие с определённой регулярностью."),
    ("AUTHORITIES", "Учреждения, управляющие страной и наделённые властью."),
    ("GRADUATION", "Окончание университета и получение диплома."),
    ("PRINCIPAL", "Самый значимый, ведущий."),
    ("ENCOMPASS", "Включать в свой состав; охватывать полностью."),
    ("CURRICULA", "Учебные планы с перечнем дисциплин (множественное число)."),
    ("STANDARDS", "Общепринятые нормы и правила, которым нужно соответствовать."),
    ("PREHIGHER", "Школьный этап образования перед зачислением в вуз."),
    ("AFFILIATE", "Вступать в организацию или присоединяться к ней."),
    ("RESEARCH", "Научное изучение и поиск новых фактов."),
    ("MAINTAIN", "Поддерживать в должном состоянии; не давать ослабнуть."),
    ("CONTACTS", "Деловые знакомства и полезные связи."),
    ("PARTTIME", "Рассчитанный на часть дня, а не на полную занятость."),
    ("REQUIRE", "Испытывать потребность в чём-либо; обязывать."),
    ("POSSESS", "Обладать, иметь в собственности."),
    ("APPLIED", "Практический, а не теоретический."),
    ("OPTIC", "Относящийся к зрению, свету и линзам."),
    ("COVER", "Накрывать поверхность; рассказывать о событии в прессе."),
]

DIRECTIONS = ("across", "down")
DELTA = {"across": (0, 1), "down": (1, 0)}
COORD_LIMIT = 90


class Layout:
    """Текущая раскладка: буквы, занятость клеток и границы."""

    __slots__ = ("cells", "occupied", "words", "min_r", "max_r", "min_c", "max_c")

    def __init__(self) -> None:
        self.cells: dict[tuple[int, int], str] = {}
        self.occupied: dict[tuple[int, int], set[str]] = {}
        self.words: list[dict] = []
        self.min_r = self.max_r = self.min_c = self.max_c = 0

    def fits(self, word: str, row: int, col: int, direction: str) -> int | None:
        """Возвращает число пересечений или None, если поставить нельзя."""
        dr, dc = DELTA[direction]
        if abs(row) > COORD_LIMIT or abs(col) > COORD_LIMIT:
            return None

        # Никаких «склеек» с другими словами вдоль той же линии.
        if (row - dr, col - dc) in self.cells:
            return None
        if (row + dr * len(word), col + dc * len(word)) in self.cells:
            return None

        crossings = 0
        for i, ch in enumerate(word):
            rr, cc = row + dr * i, col + dc * i
            existing = self.cells.get((rr, cc))
            if existing is not None:
                if existing != ch:
                    return None
                if direction in self.occupied.get((rr, cc), ()):
                    return None
                crossings += 1
            else:
                # Свободная клетка не должна примыкать сбоку к чужому слову.
                if direction == "across":
                    if (rr - 1, cc) in self.cells or (rr + 1, cc) in self.cells:
                        return None
                else:
                    if (rr, cc - 1) in self.cells or (rr, cc + 1) in self.cells:
                        return None
        return crossings

    def bounds_after(self, length: int, row: int, col: int, direction: str):
        dr, dc = DELTA[direction]
        end_r, end_c = row + dr * (length - 1), col + dc * (length - 1)
        return (
            min(self.min_r, row, end_r),
            max(self.max_r, row, end_r),
            min(self.min_c, col, end_c),
            max(self.max_c, col, end_c),
        )

    def place(self, word: str, clue: str, row: int, col: int, direction: str):
        dr, dc = DELTA[direction]
        previous_bounds = (self.min_r, self.max_r, self.min_c, self.max_c)
        for i, ch in enumerate(word):
            rr, cc = row + dr * i, col + dc * i
            self.cells[(rr, cc)] = ch
            self.occupied.setdefault((rr, cc), set()).add(direction)
            self.min_r = min(self.min_r, rr)
            self.max_r = max(self.max_r, rr)
            self.min_c = min(self.min_c, cc)
            self.max_c = max(self.max_c, cc)
        self.words.append(
            {"answer": word, "clue": clue, "row": row, "col": col, "dir": direction}
        )
        return previous_bounds

    def undo(self, previous_bounds) -> None:
        record = self.words.pop()
        word, direction = record["answer"], record["dir"]
        dr, dc = DELTA[direction]
        for i in range(len(word)):
            cell = (record["row"] + dr * i, record["col"] + dc * i)
            self.cells.pop(cell, None)
            dirs = self.occupied.get(cell)
            if dirs:
                dirs.discard(direction)
                if not dirs:
                    del self.occupied[cell]
        self.min_r, self.max_r, self.min_c, self.max_c = previous_bounds


def collect_candidates(layout: Layout, word: str, rng: random.Random) -> list[dict]:
    """Все допустимые положения слова, пересекающиеся с готовой сеткой."""
    if not layout.words:
        return [
            {
                "row": 0,
                "col": 0,
                "dir": "across",
                "crossings": 0,
                "score": 0.0,
            }
        ]

    by_letter: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for (r, c), ch in layout.cells.items():
        by_letter[ch].append((r, c))

    seen: set[tuple[int, int, str]] = set()
    candidates: list[dict] = []

    for index, ch in enumerate(word):
        for (r, c) in by_letter.get(ch, ()):
            for direction in DIRECTIONS:
                dr, dc = DELTA[direction]
                start_r, start_c = r - dr * index, c - dc * index
                key = (start_r, start_c, direction)
                if key in seen:
                    continue
                seen.add(key)

                crossings = layout.fits(word, start_r, start_c, direction)
                if crossings is None or crossings == 0:
                    continue

                min_r, max_r, min_c, max_c = layout.bounds_after(
                    len(word), start_r, start_c, direction
                )
                width = max_c - min_c + 1
                height = max_r - min_r + 1

                score = 380.0 * crossings
                score -= 0.22 * width * height
                score -= 2.2 * abs(width - height * 1.5)
                if width > 38:
                    score -= (width - 38) * 60
                if height > 28:
                    score -= (height - 28) * 60
                score += rng.random() * 26

                candidates.append(
                    {
                        "row": start_r,
                        "col": start_c,
                        "dir": direction,
                        "crossings": crossings,
                        "score": score,
                    }
                )
    return candidates


def solve(words, rng: random.Random, deadline: float, branch: int, node_budget: int):
    ordered = sorted(words, key=lambda item: (-len(item[0]), rng.random()))
    ordered = list(ordered)
    # Немного перемешаем порядок: длинные слова всё равно идут первыми.
    for _ in range(2):
        i = rng.randrange(0, min(6, len(ordered)))
        j = rng.randrange(0, min(6, len(ordered)))
        ordered[i], ordered[j] = ordered[j], ordered[i]

    layout = Layout()
    seed_word, seed_clue = ordered[0]
    layout.place(seed_word, seed_clue, 0, 0, rng.choice(["across", "down"]))

    nodes = 0

    class BudgetExceeded(Exception):
        pass

    def dfs(index: int) -> bool:
        nonlocal nodes
        nodes += 1
        if nodes > node_budget:
            return False
        if time.time() > deadline:
            raise BudgetExceeded
        if index >= len(ordered):
            return True

        word, clue = ordered[index]
        candidates = collect_candidates(layout, word, rng)
        if not candidates:
            return False
        candidates.sort(key=lambda item: item["score"], reverse=True)

        for candidate in candidates[:branch]:
            previous = layout.place(
                word, clue, candidate["row"], candidate["col"], candidate["dir"]
            )
            if dfs(index + 1):
                return True
            layout.undo(previous)
        return False

    try:
        success = dfs(1)
    except BudgetExceeded:
        return None, nodes
    return (layout if success else None), nodes


def verify(layout: Layout) -> bool:
    """Проверяем, что каждая горизонтальная/вертикальная цепочка — это слово."""
    placed = set()
    for word in layout.words:
        dr, dc = DELTA[word["dir"]]
        cells = tuple(
            (word["row"] + dr * i, word["col"] + dc * i)
            for i in range(len(word["answer"]))
        )
        placed.add((cells, word["answer"]))

    runs = set()
    filled = set(layout.cells)
    for cell in filled:
        r, c = cell
        # начало горизонтальной цепочки
        if (r, c - 1) not in filled and (r, c + 1) in filled:
            cells = []
            cc = c
            while (r, cc) in filled:
                cells.append((r, cc))
                cc += 1
            runs.add((tuple(cells), "".join(layout.cells[x] for x in cells)))
        # начало вертикальной цепочки
        if (r - 1, c) not in filled and (r + 1, c) in filled:
            cells = []
            rr = r
            while (rr, c) in filled:
                cells.append((rr, c))
                rr += 1
            runs.add((tuple(cells), "".join(layout.cells[x] for x in cells)))

    return runs == placed


def normalize(layout: Layout) -> dict:
    min_r, min_c = layout.min_r, layout.min_c
    cells = {(r - min_r, c - min_c): ch for (r, c), ch in layout.cells.items()}
    words = []
    for word in layout.words:
        words.append(
            {
                "answer": word["answer"],
                "clue": word["clue"],
                "row": word["row"] - min_r,
                "col": word["col"] - min_c,
                "dir": word["dir"],
            }
        )

    height = max(r for r, _ in cells) + 1
    width = max(c for _, c in cells) + 1

    numbers: dict[tuple[int, int], int] = {}
    current = 0
    for r in range(height):
        for c in range(width):
            if (r, c) not in cells:
                continue
            starts_across = (r, c + 1) in cells and (r, c - 1) not in cells
            starts_down = (r + 1, c) in cells and (r - 1, c) not in cells
            if starts_across or starts_down:
                current += 1
                numbers[(r, c)] = current

    for word in words:
        word["number"] = numbers[(word["row"], word["col"])]

    # Номера внутри одной клетки общие, сортируем как в вопросах.
    words.sort(key=lambda w: (w["number"], 0 if w["dir"] == "across" else 1))

    total_letters = sum(len(w["answer"]) for w in words)
    filled = len(cells)
    crossings = total_letters - filled
    unchecked = sum(1 for dirs in layout.occupied.values() if len(dirs) == 1)

    return {
        "width": width,
        "height": height,
        "words": words,
        "stats": {
            "letters": total_letters,
            "filled": filled,
            "crossings": crossings,
            "unchecked": unchecked,
        },
    }


def quality(metrics: dict) -> float:
    width, height = metrics["width"], metrics["height"]
    stats = metrics["stats"]
    return (
        width * height
        + stats["unchecked"] * 1.4
        + abs(width - height * 1.45) * 1.6
        + max(0, width - 38) * 120
        + max(0, height - 28) * 120
    )


def render_ascii(metrics: dict) -> str:
    width, height = metrics["width"], metrics["height"]
    grid = [["·"] * width for _ in range(height)]
    for word in metrics["words"]:
        dr, dc = DELTA[word["dir"]]
        for i, ch in enumerate(word["answer"]):
            grid[word["row"] + dr * i][word["col"] + dc * i] = ch
    return "\n".join(" ".join(row) for row in grid)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=12.0)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--branch", type=int, default=9)
    parser.add_argument("--nodes", type=int, default=4000)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    started = time.time()
    deadline_all = started + args.seconds

    best_metrics = None
    best_quality = float("inf")
    placements = 0
    attempts = 0
    top = []

    while time.time() < deadline_all:
        attempts += 1
        budget = min(deadline_all, time.time() + 2.0)
        layout, nodes = solve(
            WORDS, rng, budget, args.branch, args.nodes
        )
        if layout is None or len(layout.words) != len(WORDS):
            continue
        if not verify(layout):
            continue

        metrics = normalize(layout)
        score = quality(metrics)
        placements += 1

        if score < best_quality:
            best_quality = score
            best_metrics = metrics
            top.append((score, metrics))
            print(
                f"attempt {attempts}: {metrics['width']}x{metrics['height']} "
                f"crossings={metrics['stats']['crossings']} "
                f"unchecked={metrics['stats']['unchecked']} "
                f"q={score:.0f} (nodes={nodes})"
            )

    elapsed = time.time() - started
    if best_metrics is None:
        print(f"Не удалось собрать кроссворд за {elapsed:.1f} с.", flush=True)
        raise SystemExit(1)

    stats = best_metrics["stats"]
    print()
    print(
        f"Готово за {elapsed:.1f} с: {attempts} попыток, "
        f"{placements} удачных раскладок."
    )
    print(
        f"Сетка {best_metrics['width']}x{best_metrics['height']}, "
        f"букв {stats['letters']}, пересечений {stats['crossings']}, "
        f"непересечённых клеток {stats['unchecked']}."
    )
    print()
    print(render_ascii(best_metrics))
    print()

    payload = {
        "width": best_metrics["width"],
        "height": best_metrics["height"],
        "words": best_metrics["words"],
    }
    OUT_FILE.write_text(
        "// Сгенерировано tools/generate_crossword.py.\n"
        "// Раскладка и вопросы кроссворда «Учёба и наука».\n"
        "window.PUZZLE = "
        + _to_js(payload)
        + ";\n",
        encoding="utf-8",
    )
    print(f"Записано: {OUT_FILE.relative_to(ROOT)}")


def _to_js(value) -> str:
    """Компактный JSON, но с отступами — файл удобно читать."""
    import json

    return json.dumps(value, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
