#!/usr/bin/env python3
"""
Conservative semantic file sorter.

The script is intentionally boring about safety:
- dry-run is the default
- only top-level entries are considered unless --recursive is passed
- low-confidence entries go to _Needs Review
- existing files are never overwritten
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


TEXT_EXTENSIONS = {
    ".csv",
    ".docx",
    ".html",
    ".md",
    ".odt",
    ".pdf",
    ".pptx",
    ".rtf",
    ".txt",
    ".xlsx",
    ".xls",
}

MEDIA_EXTENSIONS = {
    ".heic",
    ".jpeg",
    ".jpg",
    ".mov",
    ".mp4",
    ".png",
    ".webp",
}

ARCHIVE_EXTENSIONS = {".7z", ".gz", ".pcv", ".rar", ".tar", ".zip"}

DEFAULT_DESTINATIONS = {
    "admin": "Personal/Admin",
    "archive": "Personal/Archive",
    "books": "Personal/Books",
    "career": "Personal/Career",
    "credentials": "Personal/Sensitive",
    "data": "Projects/Data",
    "dev": "Projects/Code",
    "diagrams": "Projects/Diagrams",
    "finance": "Personal/Finance",
    "images": "Media/Images",
    "media": "Media/Videos",
    "personal_notes": "Personal/Notes",
    "presentations": "Documents/Presentations",
    "research": "HS-Hannover/Research",
    "screen_recordings": "Media/Screen Recordings",
    "screenshots": "Media/Screenshots",
    "uni": "HS-Hannover/Uni",
    "review": "_Needs Review",
}

CATEGORY_KEYWORDS = {
    "admin": [
        "bescheinigung",
        "bestaetigung",
        "bestätigung",
        "bafög",
        "bafoeg",
        "miet",
        "wohnung",
        "vertrag",
        "agreement",
        "nda",
        "employment",
        "invoice",
        "rechnung",
        "receipt",
        "reparatur",
        "repair",
        "fees",
    ],
    "career": [
        "cv",
        "lebenslauf",
        "rachetta",
        "transcriptofrecords",
        "transcript",
        "notenspiegel",
        "bewerber",
        "reisekosten",
        "mentions",
    ],
    "credentials": [
        "database.kdbx",
        "keepass",
        ".pem",
        ".rdp",
        "password",
        "secret",
        "key",
    ],
    "finance": [
        "gehalt",
        "gehaltsabrechnung",
        "rechnung",
        "receipt",
        "invoice",
        "finance",
        "tax",
        "steuer",
    ],
    "uni": [
        "uni",
        "exam",
        "exercise",
        "solution",
        "class",
        "curricular",
        "studiegids",
        "notenspiegel",
        "transcript",
        "mathematik",
        "mim",
        "embs",
        "spm",
        "xai",
        "foundation",
        "folien",
        "presentation",
        "präsentation",
    ],
    "research": [
        "paper",
        "article",
        "word2vec",
        "llm",
        "halluzin",
        "hussein",
        "dino",
        "least_squares",
        "method",
        "advancedxai",
        "goodandbadcharts",
        "effect",
        "teams",
    ],
    "books": [
        "book",
        "steve jobs",
        "e-myth",
        "zero to one",
        "zerotoone",
        "gerber",
        "isaacson",
        "volume",
        "epub",
        "library",
    ],
    "personal_notes": [
        "motivation",
        "learn",
        "personality",
        "nutrition",
        "journey",
    ],
    "dev": [
        "github",
        "buildspace",
        ".crx",
        ".exe",
        "indexfile",
        "scm.r",
        "plantuml",
        "@startuml",
        "json-to-csv",
    ],
    "data": [
        ".csv",
        ".xlsx",
        ".xls",
        ".ods",
        "analysis",
        "data",
        "mydata",
        "ionosphere",
        "employment_italy",
        "content-grid",
    ],
    "diagrams": [
        ".drawio",
        ".xmind",
        "diagram",
        "sankey",
        "workpackages",
        "plot",
    ],
    "screen_recordings": [
        "bildschirmaufnahme",
        "screen recording",
    ],
    "screenshots": [
        "bildschirmfoto",
        "screenshot",
        "screen shot",
        "simulator screenshot",
    ],
}

EXTENSION_HINTS = {
    ".mp4": "media",
    ".mov": "media",
    ".png": "images",
    ".jpg": "images",
    ".jpeg": "images",
    ".heic": "images",
    ".webp": "images",
    ".drawio": "diagrams",
    ".xmind": "diagrams",
    ".kdbx": "credentials",
    ".pem": "credentials",
    ".rdp": "credentials",
    ".zip": "archive",
    ".rar": "archive",
    ".7z": "archive",
    ".pcv": "archive",
}

SKIP_NAMES = {
    ".ds_store",
    ".localized",
    ".trash",
}

IGNORED_CONTEXT_NAMES = {
    "andrearachetta",
    "cloudstorage",
    "desktop",
    "documents",
    "gigiapps",
    "library",
    "onedrive perso nlich",
    "onedrive persönlich",
    "users",
}


@dataclass(frozen=True)
class Decision:
    source: Path
    category: str
    confidence: float
    destination: Path
    reason: str
    human_category: str
    human_reason: str
    semantic_tags: tuple[str, ...]
    matched_rules: tuple[str, ...]


@dataclass(frozen=True)
class KnowledgeRule:
    name: str
    destination: str
    category: str | None
    weight: int
    patterns: tuple[str, ...]
    tags: tuple[str, ...]
    match: str


@dataclass(frozen=True)
class KnowledgeBase:
    destinations: dict[str, str]
    aliases: dict[str, str]
    rules: tuple[KnowledgeRule, ...]
    learned_examples: tuple[dict[str, Any], ...]


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9äöüß]+", " ", text.lower()).strip()


def load_knowledge(path: Path | None, feedback_path: Path | None) -> KnowledgeBase:
    data: dict[str, Any] = {}
    if path:
        data = json.loads(path.read_text(encoding="utf-8"))

    rules = tuple(
        KnowledgeRule(
            name=rule["name"],
            destination=rule["destination"],
            category=rule.get("category"),
            weight=int(rule.get("weight", 5)),
            patterns=tuple(rule.get("patterns", [])),
            tags=tuple(rule.get("tags", [])),
            match=rule.get("match", "contains"),
        )
        for rule in data.get("rules", [])
    )

    learned_examples: list[dict[str, Any]] = []
    if feedback_path and feedback_path.exists():
        with feedback_path.open(encoding="utf-8") as handle:
            learned_examples.extend(json.loads(line) for line in handle if line.strip())
    learned_examples.extend(data.get("learned_examples", []))

    return KnowledgeBase(
        destinations={**DEFAULT_DESTINATIONS, **data.get("destinations", {})},
        aliases={str(k).lower(): str(v) for k, v in data.get("aliases", {}).items()},
        rules=rules,
        learned_examples=tuple(learned_examples),
    )


def expand_aliases(text: str, aliases: dict[str, str]) -> str:
    expanded = [text]
    raw = text.lower()
    normalized = normalize(text)
    tokens = set(normalized.split())
    for alias, meaning in aliases.items():
        alias_norm = normalize(alias)
        if not alias_norm:
            continue
        if alias_norm in tokens:
            expanded.append(meaning)
        elif len(alias_norm) >= 4 and (alias.lower() in raw or alias_norm in normalized):
            expanded.append(meaning)
    return " ".join(expanded)


def meaningful_context(path: Path) -> list[str]:
    context: list[str] = []
    for part in path.parts[-4:-1]:
        normalized = normalize(part)
        if normalized.startswith("onedrive"):
            continue
        if normalized in IGNORED_CONTEXT_NAMES:
            continue
        context.append(part)
    return context


def candidate_text(path: Path, inspect_contents: bool, aliases: dict[str, str]) -> str:
    context_parts = [path.name, path.suffix.lower(), *meaningful_context(path)]
    parts = [expand_aliases(" ".join(context_parts), aliases)]
    if inspect_contents and path.suffix.lower() in {".txt", ".md", ".csv", ".html"}:
        try:
            parts.append(expand_aliases(path.read_text(encoding="utf-8", errors="ignore")[:4000], aliases))
        except OSError:
            pass
    return normalize(" ".join(parts))


def keyword_matches(keyword: str, text: str, suffix: str) -> bool:
    needle = normalize(keyword)
    if not needle:
        return False
    if keyword.startswith("."):
        return suffix == keyword.lower()
    if " " in needle:
        return needle in text
    tokens = set(text.split())
    if needle in tokens:
        return True
    return False


def pattern_matches(pattern: str, text: str, source: Path, match: str) -> bool:
    if match == "glob":
        return source.match(pattern)
    if match == "regex":
        return re.search(pattern, str(source), flags=re.IGNORECASE) is not None
    return keyword_matches(pattern, text, source.suffix.lower())


def score_categories(
    path: Path,
    inspect_contents: bool,
    knowledge: KnowledgeBase,
) -> tuple[str, float, str, tuple[str, ...], tuple[str, ...], str | None]:
    text = candidate_text(path, inspect_contents, knowledge.aliases)
    suffix = path.suffix.lower()
    scores: dict[str, int] = {}
    reasons: dict[str, list[str]] = {}
    tags: set[str] = set()
    matched_rules: list[str] = []
    rule_destination: str | None = None

    for example in knowledge.learned_examples:
        source_name = str(example.get("source_name", ""))
        if source_name and normalize(source_name) == normalize(path.name):
            category = str(example.get("category", "review"))
            destination = example.get("destination")
            tags.update(example.get("tags", []))
            return (
                category,
                0.99,
                f"learned from review: {example.get('note', source_name)}",
                tuple(sorted(tags)),
                ("learned-review",),
                str(destination) if destination else None,
            )

    for rule in knowledge.rules:
        if any(pattern_matches(pattern, text, path, rule.match) for pattern in rule.patterns):
            matched_rules.append(rule.name)
            tags.update(rule.tags)
            if rule.destination:
                rule_destination = rule.destination
            if rule.category:
                scores[rule.category] = scores.get(rule.category, 0) + rule.weight
                reasons.setdefault(rule.category, []).append(f"rule:{rule.name}")

    if suffix in EXTENSION_HINTS:
        category = EXTENSION_HINTS[suffix]
        scores[category] = scores.get(category, 0) + 3
        reasons.setdefault(category, []).append(f"extension {suffix}")

    if suffix in ARCHIVE_EXTENSIONS:
        scores["archive"] = scores.get("archive", 0) + 2
        reasons.setdefault("archive", []).append(f"archive extension {suffix}")

    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            if keyword_matches(keyword, text, suffix):
                scores[category] = scores.get(category, 0) + 2
                reasons.setdefault(category, []).append(keyword)

    if path.is_dir():
        if any(token in text for token in ["github", "app", "project", "repo"]):
            scores["dev"] = scores.get("dev", 0) + 2
            reasons.setdefault("dev", []).append("folder name looks project-like")
        else:
            scores["review"] = scores.get("review", 0) + 1
            reasons.setdefault("review", []).append("folder requires human context")

    if not scores:
        return "review", 0.25, "no strong filename, path, content, or knowledge-base signal", tuple(sorted(tags)), tuple(matched_rules), rule_destination

    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    best_category, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0
    confidence = min(0.95, 0.35 + best_score * 0.12 + (best_score - second_score) * 0.06)

    if confidence < 0.62:
        return (
            "review",
            confidence,
            f"weak signal: {', '.join(reasons.get(best_category, [])[:3])}",
            tuple(sorted(tags)),
            tuple(matched_rules),
            rule_destination,
        )

    reason = ", ".join(reasons.get(best_category, [])[:4])
    return best_category, confidence, reason, tuple(sorted(tags)), tuple(matched_rules), rule_destination


def human_style_category(path: Path) -> tuple[str, str]:
    """A deliberately conservative baseline for comparison reports."""
    suffix = path.suffix.lower()
    text = normalize(path.name)

    if path.is_dir():
        return "review", "human would inspect folder contents first"
    if suffix in {".mp4", ".mov"}:
        return "media", "obvious video file"
    if suffix in {".png", ".jpg", ".jpeg", ".heic", ".webp"}:
        return "images", "obvious image file"
    if suffix in {".kdbx", ".pem", ".rdp"} or "keepass" in text:
        return "credentials", "sensitive/security related"
    if any(word in text for word in ["lebenslauf", "cv", "transcript", "notenspiegel"]):
        return "career", "career/credential document"
    if any(word in text for word in ["rechnung", "receipt", "gehalt", "invoice"]):
        return "finance", "financial/admin document"
    if any(word in text for word in ["exam", "exercise", "solution", "uni", "studiegids"]):
        return "uni", "academic filename"
    if suffix in TEXT_EXTENSIONS:
        return "review", "document needs content or context"
    return "review", "not enough context from filename"


def choose_destination(
    source: Path,
    category: str,
    destinations: dict[str, str],
    dest_root: Path,
    hs_root: Path | None,
    personal_root: Path | None,
    destination_override: str | None = None,
) -> Path:
    relative = Path(destination_override or destinations.get(category, destinations["review"]))

    if relative.parts and relative.parts[0] == "HS-Hannover":
        if hs_root:
            return hs_root / Path(*relative.parts[1:]) / source.name
        return dest_root / "_Needs HS-Hannover Mount" / Path(*relative.parts[1:]) / source.name

    if relative.parts and relative.parts[0] == "Personal":
        base = personal_root or dest_root
        return base / Path(*relative.parts[1:]) / source.name

    return dest_root / relative / source.name


def iter_sources(sources: Iterable[Path], recursive: bool) -> Iterable[Path]:
    for source in sources:
        if not source.exists():
            continue
        if source.is_file():
            yield source
            continue
        iterator = source.rglob("*") if recursive else source.iterdir()
        for entry in iterator:
            if entry.name.lower() in SKIP_NAMES:
                continue
            if entry.name.startswith("."):
                continue
            yield entry


def unique_destination(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    digest = hashlib.sha1(str(path).encode("utf-8")).hexdigest()[:7]
    return path.with_name(f"{stem} ({digest}){suffix}")


def make_decisions(args: argparse.Namespace) -> list[Decision]:
    knowledge = load_knowledge(args.knowledge, args.feedback)
    decisions: list[Decision] = []

    for source in iter_sources(args.source, args.recursive):
        category, confidence, reason, tags, matched_rules, destination_override = score_categories(
            source,
            args.inspect_contents,
            knowledge,
        )
        if confidence < args.min_confidence:
            category = "review"
            destination_override = None
        human_category, human_reason = human_style_category(source)
        destination = choose_destination(
            source=source,
            category=category,
            destinations=knowledge.destinations,
            dest_root=args.dest_root,
            hs_root=args.hs_root,
            personal_root=args.personal_root,
            destination_override=destination_override,
        )
        decisions.append(
            Decision(
                source=source,
                category=category,
                confidence=confidence,
                destination=destination,
                reason=reason,
                human_category=human_category,
                human_reason=human_reason,
                semantic_tags=tags,
                matched_rules=matched_rules,
            )
        )

    return decisions


def write_markdown_report(path: Path, decisions: list[Decision]) -> None:
    counts: dict[str, int] = {}
    disagreements = 0
    for decision in decisions:
        counts[decision.category] = counts.get(decision.category, 0) + 1
        if decision.category != decision.human_category:
            disagreements += 1

    lines = [
        "# Semantic Sorter Dry Run",
        "",
        f"Generated: {dt.datetime.now().isoformat(timespec='seconds')}",
        f"Items considered: {len(decisions)}",
        f"Human/script category differences: {disagreements}",
        "",
        "## Script Buckets",
        "",
    ]
    for category, count in sorted(counts.items(), key=lambda item: item[0]):
        lines.append(f"- `{category}`: {count}")

    lines.extend(
        [
            "",
            "## Decisions",
            "",
            "| File | Script | Human-style | Confidence | Destination | Reason |",
            "|---|---:|---:|---:|---|---|",
        ]
    )
    for decision in decisions:
        lines.append(
            "| "
            + " | ".join(
                [
                    decision.source.name.replace("|", "\\|"),
                    decision.category,
                    decision.human_category,
                    f"{decision.confidence:.2f}",
                    str(decision.destination).replace("|", "\\|"),
                    (
                        decision.reason
                        + (
                            f"; tags={','.join(decision.semantic_tags)}"
                            if decision.semantic_tags
                            else ""
                        )
                        + (
                            f"; rules={','.join(decision.matched_rules)}"
                            if decision.matched_rules
                            else ""
                        )
                    ).replace("|", "\\|"),
                ]
            )
            + " |"
        )

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_csv_report(path: Path, decisions: list[Decision]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "source",
                "script_category",
                "script_confidence",
                "script_reason",
                "human_category",
                "human_reason",
                "semantic_tags",
                "matched_rules",
                "destination",
            ],
        )
        writer.writeheader()
        for decision in decisions:
            writer.writerow(
                {
                    "source": str(decision.source),
                    "script_category": decision.category,
                    "script_confidence": f"{decision.confidence:.2f}",
                    "script_reason": decision.reason,
                    "human_category": decision.human_category,
                    "human_reason": decision.human_reason,
                    "semantic_tags": ";".join(decision.semantic_tags),
                    "matched_rules": ";".join(decision.matched_rules),
                    "destination": str(decision.destination),
                }
            )


def decision_to_dict(decision: Decision) -> dict[str, Any]:
    return {
        "source": str(decision.source),
        "category": decision.category,
        "confidence": decision.confidence,
        "destination": str(decision.destination),
        "reason": decision.reason,
        "human_category": decision.human_category,
        "human_reason": decision.human_reason,
        "semantic_tags": list(decision.semantic_tags),
        "matched_rules": list(decision.matched_rules),
    }


def apply_moves(decisions: list[Decision]) -> None:
    for decision in decisions:
        destination = unique_destination(decision.destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(decision.source), str(destination))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dry-run or apply semantic file sorting.")
    parser.add_argument("--source", type=Path, action="append", required=True)
    parser.add_argument("--dest-root", type=Path, required=True)
    parser.add_argument("--personal-root", type=Path)
    parser.add_argument("--hs-root", type=Path)
    parser.add_argument("--knowledge", type=Path)
    parser.add_argument("--feedback", type=Path)
    parser.add_argument("--recursive", action="store_true")
    parser.add_argument("--inspect-contents", action="store_true")
    parser.add_argument("--min-confidence", type=float, default=0.68)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--report-md", type=Path)
    parser.add_argument("--report-csv", type=Path)
    parser.add_argument(
        "--emit-json",
        action="store_true",
        help="Print decisions as JSON on stdout (for Task Assistant IPC).",
    )
    parser.add_argument(
        "--decisions-only",
        action="store_true",
        help="Skip tab-separated log lines; use with --emit-json from the desktop app.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.dest_root = args.dest_root.expanduser()
    args.personal_root = args.personal_root.expanduser() if args.personal_root else None
    args.hs_root = args.hs_root.expanduser() if args.hs_root else None
    args.source = [source.expanduser() for source in args.source]

    decisions = make_decisions(args)

    if args.report_md:
        write_markdown_report(args.report_md.expanduser(), decisions)
    if args.report_csv:
        write_csv_report(args.report_csv.expanduser(), decisions)

    if args.emit_json:
        import sys

        json.dump([decision_to_dict(d) for d in decisions], sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
    elif not args.decisions_only:
        for decision in decisions:
            marker = "MOVE" if args.apply else "DRY"
            print(
                f"{marker}\t{decision.confidence:.2f}\t{decision.category}"
                f"\t{decision.source}\t=>\t{decision.destination}"
            )

    if args.apply:
        apply_moves(decisions)
        summary = f"Applied {len(decisions)} moves."
    else:
        summary = f"Dry-run complete. {len(decisions)} items considered; no files moved."

    if args.emit_json:
        import sys

        print(summary, file=sys.stderr)
    else:
        print(summary)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
