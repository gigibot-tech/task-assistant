#!/usr/bin/env python3
"""
Tiny review GUI for semantic sorter dry-run CSVs.

It appends decisions to JSONL so every correction can be reused by future runs.
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


DEFAULT_FEEDBACK = Path("tools/semantic_sorter/feedback.jsonl")


class ReviewApp(tk.Tk):
    def __init__(self, csv_path: Path, feedback_path: Path) -> None:
        super().__init__()
        self.title("Semantic Sorter Review")
        self.geometry("1120x620")
        self.csv_path = csv_path
        self.feedback_path = feedback_path
        self.rows = list(csv.DictReader(csv_path.open(encoding="utf-8")))
        self.index = 0

        self.file_var = tk.StringVar()
        self.current_var = tk.StringVar()
        self.destination_var = tk.StringVar()
        self.category_var = tk.StringVar()
        self.tags_var = tk.StringVar()
        self.note_var = tk.StringVar()

        self._build()
        self._load_row()

    def _build(self) -> None:
        pad = {"padx": 10, "pady": 6}

        top = ttk.Frame(self)
        top.pack(fill="x", **pad)
        ttk.Label(top, textvariable=self.file_var, font=("Helvetica", 16, "bold")).pack(anchor="w")
        ttk.Label(top, textvariable=self.current_var, wraplength=1050).pack(anchor="w", pady=(4, 0))

        form = ttk.Frame(self)
        form.pack(fill="x", **pad)

        ttk.Label(form, text="Category").grid(row=0, column=0, sticky="w")
        ttk.Entry(form, textvariable=self.category_var, width=34).grid(row=0, column=1, sticky="ew", padx=(8, 20))

        ttk.Label(form, text="Destination").grid(row=1, column=0, sticky="w")
        ttk.Entry(form, textvariable=self.destination_var, width=90).grid(row=1, column=1, sticky="ew", padx=(8, 20))

        ttk.Label(form, text="Tags").grid(row=2, column=0, sticky="w")
        ttk.Entry(form, textvariable=self.tags_var, width=90).grid(row=2, column=1, sticky="ew", padx=(8, 20))

        ttk.Label(form, text="Note").grid(row=3, column=0, sticky="w")
        ttk.Entry(form, textvariable=self.note_var, width=90).grid(row=3, column=1, sticky="ew", padx=(8, 20))
        form.columnconfigure(1, weight=1)

        buttons = ttk.Frame(self)
        buttons.pack(fill="x", **pad)
        ttk.Button(buttons, text="Previous", command=self.previous_row).pack(side="left")
        ttk.Button(buttons, text="Accept Script", command=self.accept_script).pack(side="left", padx=8)
        ttk.Button(buttons, text="Save Correction", command=self.save_correction).pack(side="left", padx=8)
        ttk.Button(buttons, text="Skip", command=self.next_row).pack(side="left", padx=8)
        ttk.Button(buttons, text="Choose CSV", command=self.choose_csv).pack(side="right")

        self.details = tk.Text(self, height=16, wrap="word")
        self.details.pack(fill="both", expand=True, **pad)

    def _load_row(self) -> None:
        if not self.rows:
            self.file_var.set("No rows loaded")
            return
        row = self.rows[self.index]
        self.file_var.set(f"{self.index + 1}/{len(self.rows)}  {Path(row['source']).name}")
        self.current_var.set(
            f"Script: {row['script_category']} ({row['script_confidence']}) -> {row['destination']}"
        )
        self.category_var.set(row["script_category"])
        self.destination_var.set(row["destination"])
        self.tags_var.set(row.get("semantic_tags", ""))
        self.note_var.set("")
        self.details.delete("1.0", "end")
        self.details.insert(
            "1.0",
            "\n".join(
                [
                    f"Source: {row['source']}",
                    f"Script reason: {row['script_reason']}",
                    f"Matched rules: {row.get('matched_rules', '')}",
                    f"Human-style category: {row['human_category']}",
                    f"Human-style reason: {row['human_reason']}",
                ]
            ),
        )

    def _feedback_record(self) -> dict[str, object]:
        row = self.rows[self.index]
        tags = [tag.strip() for tag in self.tags_var.get().split(";") if tag.strip()]
        return {
            "created_at": dt.datetime.now().isoformat(timespec="seconds"),
            "source": row["source"],
            "source_name": Path(row["source"]).name,
            "category": self.category_var.get().strip() or "review",
            "destination": self.destination_var.get().strip(),
            "tags": tags,
            "note": self.note_var.get().strip(),
        }

    def accept_script(self) -> None:
        self.note_var.set("accepted script decision")
        self.save_correction()

    def save_correction(self) -> None:
        self.feedback_path.parent.mkdir(parents=True, exist_ok=True)
        with self.feedback_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(self._feedback_record(), ensure_ascii=False) + "\n")
        self.next_row()

    def previous_row(self) -> None:
        self.index = max(0, self.index - 1)
        self._load_row()

    def next_row(self) -> None:
        self.index += 1
        if self.index >= len(self.rows):
            messagebox.showinfo("Review complete", f"Reached end of {self.csv_path.name}")
            self.index = len(self.rows) - 1
        self._load_row()

    def choose_csv(self) -> None:
        selected = filedialog.askopenfilename(filetypes=[("CSV reports", "*.csv")])
        if not selected:
            return
        self.csv_path = Path(selected)
        self.rows = list(csv.DictReader(self.csv_path.open(encoding="utf-8")))
        self.index = 0
        self._load_row()


def main() -> int:
    root = Path.cwd()
    default_csv = root / "reports/semantic_sorter_onedrive_root_dry_run.csv"
    csv_path = default_csv if default_csv.exists() else Path(
        filedialog.askopenfilename(filetypes=[("CSV reports", "*.csv")])
    )
    if not csv_path:
        return 1
    app = ReviewApp(csv_path, root / DEFAULT_FEEDBACK)
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
