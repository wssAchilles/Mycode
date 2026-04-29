"""
KuaiRec / KuaiRand preprocessing for the existing ML serving contract.

Outputs the same artifact files consumed by app.py:
- data/news_dict.pkl
- data/news_vocab.pkl
- data/user_vocab.pkl
- data/train_samples.pkl
- data/dev_samples.pkl

The historical name `news_*` is kept for backwards compatibility with the
ANN/Phoenix serving code. The records can represent short videos or posts.
"""

from __future__ import annotations

import argparse
import ast
import csv
import json
import pickle
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Deque, Dict, Iterable, List, Optional, Set, Tuple

import numpy as np
import pandas as pd
from tqdm import tqdm


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data"

KUAI_HISTORY_LIMIT = 100
SPECIAL_PAD = "<PAD>"
SPECIAL_UNK = "<UNK>"


@dataclass(frozen=True)
class SourceFile:
    path: Path
    dataset: str
    split: str


def find_file(root: Optional[Path], names: Iterable[str]) -> Optional[Path]:
    if root is None:
        return None
    candidates = [root, root / "data"]
    for base in candidates:
        for name in names:
            path = base / name
            if path.exists():
                return path
    for name in names:
        matches = list(root.rglob(name))
        if matches:
            return matches[0]
    return None


def find_many(root: Optional[Path], patterns: Iterable[str]) -> List[Path]:
    if root is None:
        return []
    results: List[Path] = []
    for pattern in patterns:
        results.extend(root.rglob(pattern))
    return sorted({p.resolve(): p for p in results}.values(), key=lambda p: str(p))


def prefixed_id(prefix: str, value: Any) -> str:
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return ""
    return f"{prefix}_{text}"


def to_float(value: Any, default: float = 0.0) -> float:
    try:
        if pd.isna(value):
            return default
        return float(value)
    except Exception:
        return default


def to_int(value: Any, default: int = 0) -> int:
    try:
        if pd.isna(value):
            return default
        return int(float(value))
    except Exception:
        return default


def parse_listish(value: Any) -> List[str]:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return []
    text = str(value).strip()
    if not text:
        return []
    if text.startswith("[") and text.endswith("]"):
        try:
            parsed = ast.literal_eval(text)
            if isinstance(parsed, (list, tuple)):
                return [str(x).strip() for x in parsed if str(x).strip()]
        except Exception:
            pass
        text = text.strip("[]")
    return [x.strip().strip("'\"") for x in text.replace("|", ",").split(",") if x.strip().strip("'\"")]


def merge_text(*values: Any) -> str:
    parts = []
    for value in values:
        text = str(value or "").strip()
        if text and text.lower() != "nan":
            parts.append(text)
    return " ".join(parts)


def read_csv_robust(path: Path, *, tolerate_malformed_quotes: bool = False, **kwargs) -> pd.DataFrame:
    """
    Read metadata CSVs that may contain malformed captions or unmatched quotes.
    Interaction logs still use chunked reads; this helper is for smaller content
    side files where skipping a handful of broken rows is better than stopping
    the whole training pipeline.
    """
    try:
        return pd.read_csv(path, **kwargs)
    except pd.errors.ParserError as first_error:
        print(f"⚠️ pandas C parser failed for {path.name}; retrying with python parser and bad-line skip: {first_error}")
        retry_kwargs = dict(kwargs)
        retry_kwargs.pop("low_memory", None)
        retry_kwargs["engine"] = "python"
        retry_kwargs["on_bad_lines"] = "skip"
        retry_kwargs.setdefault("encoding_errors", "replace")
        if tolerate_malformed_quotes:
            # Some Kuai caption files contain unmatched quotes or extremely long
            # text fragments. Treat quotes as ordinary characters so the parser
            # can move on instead of buffering huge broken records.
            retry_kwargs.setdefault("quoting", csv.QUOTE_NONE)
            retry_kwargs.setdefault("escapechar", "\\")
        return pd.read_csv(path, **retry_kwargs)


def read_csv_chunks_robust(path: Path, chunksize: int, **kwargs):
    try:
        yield from pd.read_csv(path, chunksize=chunksize, **kwargs)
    except pd.errors.ParserError as first_error:
        print(f"⚠️ pandas C parser failed for {path.name}; retrying chunks with python parser and bad-line skip: {first_error}")
        retry_kwargs = dict(kwargs)
        retry_kwargs.pop("low_memory", None)
        retry_kwargs.setdefault("engine", "python")
        retry_kwargs.setdefault("on_bad_lines", "skip")
        retry_kwargs.setdefault("encoding_errors", "replace")
        yield from pd.read_csv(path, chunksize=chunksize, **retry_kwargs)


def load_kuairec_metadata(root: Optional[Path], metadata_mode: str = "fast") -> Dict[str, Dict[str, Any]]:
    if root is None:
        return {}
    if metadata_mode == "none":
        return {}

    metadata: Dict[str, Dict[str, Any]] = {}

    categories_path = find_file(root, ["item_categories.csv"])
    if categories_path:
        df = read_csv_robust(categories_path)
        for row in df.itertuples(index=False):
            row_dict = row._asdict()
            external_id = prefixed_id("kuairec", row_dict.get("video_id"))
            if not external_id:
                continue
            tags = parse_listish(row_dict.get("feat"))
            metadata.setdefault(external_id, {}).update(
                {
                    "news_id": external_id,
                    "source": "kuairec",
                    "category": "short_video",
                    "subcategory": ",".join(tags[:4]),
                    "keywords": tags[:12],
                }
            )

    caption_path = find_file(root, ["kuairec_caption_category.csv"])
    if caption_path and metadata_mode != "none":
        if metadata_mode == "fast":
            print(f"⚡ Fast metadata mode: loading KuaiRec captions with quote-tolerant parser ({caption_path.name})")
        df = read_csv_robust(
            caption_path,
            tolerate_malformed_quotes=True,
            low_memory=False,
        )
        for row in df.itertuples(index=False):
            row_dict = row._asdict()
            external_id = prefixed_id("kuairec", row_dict.get("video_id"))
            if not external_id:
                continue
            topic_tags = parse_listish(row_dict.get("topic_tag"))
            category_names = [
                row_dict.get("first_level_category_name"),
                row_dict.get("second_level_category_name"),
                row_dict.get("third_level_category_name"),
            ]
            title = merge_text(row_dict.get("caption"), row_dict.get("manual_cover_text")) or f"KuaiRec video {external_id}"
            metadata.setdefault(external_id, {}).update(
                {
                    "news_id": external_id,
                    "source": "kuairec",
                    "title": title[:240],
                    "abstract": merge_text(*category_names, *topic_tags)[:800],
                    "text": merge_text(title, *category_names, *topic_tags),
                    "category": str(row_dict.get("first_level_category_name") or "short_video"),
                    "subcategory": str(row_dict.get("second_level_category_name") or ""),
                    "keywords": [x for x in [*topic_tags, *[str(v) for v in category_names if v]] if x][:16],
                }
            )

    daily_path = find_file(root, ["item_daily_features.csv"])
    if daily_path:
        usecols = None
        df = read_csv_robust(daily_path, low_memory=False, usecols=usecols)
        if "date" in df.columns:
            df = df.sort_values("date").drop_duplicates("video_id", keep="last")
        for row in df.itertuples(index=False):
            row_dict = row._asdict()
            external_id = prefixed_id("kuairec", row_dict.get("video_id"))
            if not external_id:
                continue
            metadata.setdefault(external_id, {}).update(
                {
                    "news_id": external_id,
                    "source": "kuairec",
                    "author_id": prefixed_id("kuairec_author", row_dict.get("author_id")),
                    "duration_ms": to_float(row_dict.get("video_duration"), 0.0),
                    "stats": {
                        "show_cnt": to_float(row_dict.get("show_cnt"), 0.0),
                        "play_cnt": to_float(row_dict.get("play_cnt"), 0.0),
                        "like_cnt": to_float(row_dict.get("like_cnt"), 0.0),
                        "comment_cnt": to_float(row_dict.get("comment_cnt"), 0.0),
                        "share_cnt": to_float(row_dict.get("share_cnt"), 0.0),
                        "report_cnt": to_float(row_dict.get("report_cnt"), 0.0),
                    },
                }
            )

    return ensure_metadata_defaults(metadata)


def load_kuairand_metadata(root: Optional[Path], content_root: Optional[Path], metadata_mode: str = "fast") -> Dict[str, Dict[str, Any]]:
    if metadata_mode == "none":
        return {}

    search_roots = [p for p in [root, content_root] if p is not None]
    metadata: Dict[str, Dict[str, Any]] = {}

    basic_path = None
    for base in search_roots:
        basic_path = find_file(
            base,
            ["video_features_basic_27k.csv", "video_features_basic_1k.csv", "video_features_basic_pure.csv"],
        )
        if basic_path:
            break

    if basic_path:
        for chunk in read_csv_chunks_robust(basic_path, chunksize=500_000, low_memory=False):
            for row in chunk.itertuples(index=False):
                row_dict = row._asdict()
                external_id = prefixed_id("kuairand", row_dict.get("video_id"))
                if not external_id:
                    continue
                tags = parse_listish(row_dict.get("tag"))
                metadata.setdefault(external_id, {}).update(
                    {
                        "news_id": external_id,
                        "source": "kuairand",
                        "category": str(row_dict.get("video_type") or "short_video"),
                        "subcategory": ",".join(tags[:4]),
                        "author_id": prefixed_id("kuairand_author", row_dict.get("author_id")),
                        "duration_ms": to_float(row_dict.get("video_duration") or row_dict.get("duration_ms"), 0.0),
                        "keywords": tags[:12],
                    }
                )

    captions_path = None
    categories_path = None
    if metadata_mode != "none":
        for base in search_roots:
            captions_path = captions_path or find_file(base, ["kuairand_video_captions.csv"])
            categories_path = categories_path or find_file(base, ["kuairand_video_categories.csv"])

    if captions_path:
        if metadata_mode == "fast":
            print(f"⚡ Fast metadata mode: reading KuaiRand captions in bounded chunks ({captions_path.name})")
        for chunk in read_csv_chunks_robust(captions_path, chunksize=500_000, low_memory=False):
            for row in chunk.itertuples(index=False):
                row_dict = row._asdict()
                external_id = prefixed_id("kuairand", row_dict.get("final_video_id") or row_dict.get("video_id"))
                if not external_id:
                    continue
                caption = merge_text(row_dict.get("caption"), row_dict.get("show_cover_text"))
                metadata.setdefault(external_id, {}).update(
                    {
                        "news_id": external_id,
                        "source": "kuairand",
                        "title": caption[:240] if caption else f"KuaiRand video {external_id}",
                        "abstract": str(row_dict.get("show_cover_text") or "")[:800],
                        "text": caption,
                        "duration_ms": to_float(row_dict.get("duration"), 0.0),
                    }
                )

    if categories_path:
        for chunk in read_csv_chunks_robust(categories_path, chunksize=500_000, low_memory=False):
            for row in chunk.itertuples(index=False):
                row_dict = row._asdict()
                external_id = prefixed_id("kuairand", row_dict.get("final_video_id") or row_dict.get("video_id"))
                if not external_id:
                    continue
                category_values = [
                    row_dict.get("first_level_category_id"),
                    row_dict.get("second_level_category_id"),
                    row_dict.get("third_level_category_id"),
                ]
                keywords = [f"category_{to_int(v)}" for v in category_values if str(v).strip() and str(v) != "nan"]
                metadata.setdefault(external_id, {}).update(
                    {
                        "news_id": external_id,
                        "source": "kuairand",
                        "category": keywords[0] if keywords else "short_video",
                        "subcategory": ",".join(keywords[1:]),
                        "keywords": [*metadata.get(external_id, {}).get("keywords", []), *keywords][:16],
                    }
                )

    return ensure_metadata_defaults(metadata)


def ensure_metadata_defaults(metadata: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    for external_id, info in metadata.items():
        source = info.get("source") or external_id.split("_", 1)[0]
        title = str(info.get("title") or f"{source} video {external_id}").strip()
        abstract = str(info.get("abstract") or "").strip()
        info["news_id"] = external_id
        info["title"] = title
        info["abstract"] = abstract
        info["text"] = str(info.get("text") or f"{title} {abstract}").strip()
        info["category"] = str(info.get("category") or "short_video")
        info["subcategory"] = str(info.get("subcategory") or "")
        info["source"] = source
        info["url"] = str(info.get("url") or f"{source}://{external_id}")
        keywords = info.get("keywords") or []
        info["keywords"] = [str(k) for k in keywords if str(k).strip()][:16]
    return metadata


def discover_source_files(kuairec_dir: Optional[Path], kuairand_dir: Optional[Path]) -> List[SourceFile]:
    files: List[SourceFile] = []

    if kuairec_dir:
        big = find_file(kuairec_dir, ["big_matrix.csv"])
        small = find_file(kuairec_dir, ["small_matrix.csv"])
        if big:
            files.append(SourceFile(big, "kuairec", "train"))
        if small:
            files.append(SourceFile(small, "kuairec", "dev"))

    if kuairand_dir:
        for path in find_many(kuairand_dir, ["log_*.csv"]):
            name = path.name
            split = "dev" if ("random" in name or "4_22_to_5_08" in name) else "train"
            files.append(SourceFile(path, "kuairand", split))

    return files


def derive_kuairec_labels(row: Dict[str, Any]) -> Tuple[float, Dict[str, float], float]:
    watch_ratio = max(0.0, to_float(row.get("watch_ratio"), 0.0))
    play_ms = max(0.0, to_float(row.get("play_duration"), 0.0))
    duration_ms = max(1.0, to_float(row.get("video_duration"), 1.0))
    dwell = min(1.0, play_ms / duration_ms)
    click = 1.0 if watch_ratio >= 0.55 else 0.0
    like = 1.0 if watch_ratio >= 2.0 else 0.0
    negative = 1.0 if watch_ratio < 0.12 else 0.0
    label = 1.0 if (click > 0.0 or like > 0.0) and negative == 0.0 else 0.0
    weight = 1.0 + min(3.0, watch_ratio)
    return label, {
        "click": click,
        "like": like,
        "reply": 0.0,
        "repost": 0.0,
        "dwell": dwell,
        "negative": negative,
    }, weight


def derive_kuairand_labels(row: Dict[str, Any]) -> Tuple[float, Dict[str, float], float]:
    duration_ms = max(1.0, to_float(row.get("duration_ms"), 1.0))
    play_ms = max(0.0, to_float(row.get("play_time_ms"), 0.0))
    click = float(to_int(row.get("is_click"), 0) > 0)
    like = float(to_int(row.get("is_like"), 0) > 0)
    reply = float(to_int(row.get("is_comment"), 0) > 0)
    repost = float(to_int(row.get("is_forward"), 0) > 0)
    long_view = float(to_int(row.get("long_view"), 0) > 0)
    negative = float(to_int(row.get("is_hate"), 0) > 0)
    dwell = min(1.0, play_ms / duration_ms)
    label = 1.0 if (click or like or reply or repost or long_view) and not negative else 0.0
    weight = 1.0 + click + 2.0 * like + 2.5 * reply + 2.0 * repost + long_view - 0.5 * negative
    return label, {
        "click": click,
        "like": like,
        "reply": reply,
        "repost": repost,
        "dwell": max(dwell, long_view),
        "negative": negative,
    }, max(0.2, weight)


def normalize_chunk(df: pd.DataFrame, dataset: str) -> pd.DataFrame:
    if dataset == "kuairec":
        required = ["user_id", "video_id", "timestamp"]
        for col in required:
            if col not in df.columns:
                raise ValueError(f"KuaiRec file missing column: {col}")
        df = df.copy()
        df["external_user_id"] = df["user_id"].map(lambda v: prefixed_id("kuairec_user", v))
        df["external_item_id"] = df["video_id"].map(lambda v: prefixed_id("kuairec", v))
        df["event_ts"] = pd.to_numeric(df["timestamp"], errors="coerce").fillna(0.0)
        return df.sort_values(["event_ts", "external_user_id"])

    required = ["user_id", "video_id", "time_ms"]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"KuaiRand file missing column: {col}")
    df = df.copy()
    df["external_user_id"] = df["user_id"].map(lambda v: prefixed_id("kuairand_user", v))
    df["external_item_id"] = df["video_id"].map(lambda v: prefixed_id("kuairand", v))
    df["event_ts"] = pd.to_numeric(df["time_ms"], errors="coerce").fillna(0.0)
    return df.sort_values(["event_ts", "external_user_id"])


def make_sample(
    row: Dict[str, Any],
    dataset: str,
    histories: Dict[str, Deque[str]],
    min_history: int,
) -> Optional[Dict[str, Any]]:
    user_id = str(row.get("external_user_id") or "")
    item_id = str(row.get("external_item_id") or "")
    if not user_id or not item_id:
        return None

    history = list(histories[user_id])
    if dataset == "kuairec":
        label, labels, weight = derive_kuairec_labels(row)
    else:
        label, labels, weight = derive_kuairand_labels(row)

    sample = None
    if len(history) >= min_history:
        sample = {
            "user_id": user_id,
            "history": history[-KUAI_HISTORY_LIMIT:],
            "candidate_id": item_id,
            "label": float(label),
            "labels": labels,
            "sample_weight": float(weight),
            "timestamp": float(row.get("event_ts") or 0.0),
            "source": dataset,
        }

    if label > 0.0:
        histories[user_id].append(item_id)
    return sample


def append_bounded(samples: List[Dict[str, Any]], sample: Dict[str, Any], limit: int) -> None:
    if limit <= 0 or len(samples) < limit:
        samples.append(sample)


def process_interactions(
    source_files: List[SourceFile],
    chunk_size: int,
    min_history: int,
    max_train_samples: int,
    max_dev_samples: int,
    max_rows_per_file: int,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, List[str]], Counter]:
    histories: Dict[str, Deque[str]] = defaultdict(lambda: deque(maxlen=KUAI_HISTORY_LIMIT))
    user_sequences: Dict[str, List[str]] = defaultdict(list)
    item_counts: Counter = Counter()
    train_samples: List[Dict[str, Any]] = []
    dev_samples: List[Dict[str, Any]] = []

    for source in source_files:
        row_count = 0
        progress = tqdm(desc=f"{source.dataset}:{source.path.name}", unit="rows")
        for chunk in pd.read_csv(source.path, chunksize=chunk_size, low_memory=False):
            if max_rows_per_file > 0:
                remaining = max_rows_per_file - row_count
                if remaining <= 0:
                    break
                chunk = chunk.head(remaining)

            chunk = normalize_chunk(chunk, source.dataset)
            for row in chunk.to_dict("records"):
                row_count += 1
                item_id = str(row.get("external_item_id") or "")
                user_id = str(row.get("external_user_id") or "")
                if item_id:
                    item_counts[item_id] += 1
                sample = make_sample(row, source.dataset, histories, min_history)
                if user_id:
                    user_sequences[user_id] = list(histories[user_id])
                if sample is None:
                    continue
                if source.split == "dev":
                    append_bounded(dev_samples, sample, max_dev_samples)
                else:
                    append_bounded(train_samples, sample, max_train_samples)

            progress.update(len(chunk))
            if (max_train_samples > 0 and len(train_samples) >= max_train_samples) and (
                max_dev_samples > 0 and len(dev_samples) >= max_dev_samples
            ):
                break
        progress.close()

    return train_samples, dev_samples, user_sequences, item_counts


def select_news_vocab_items(
    item_counts: Counter,
    max_news_vocab_size: int,
    min_item_frequency: int,
) -> Set[str]:
    min_freq = max(1, int(min_item_frequency))
    ranked = [
        (item_id, count)
        for item_id, count in item_counts.items()
        if item_id and count >= min_freq
    ]
    ranked.sort(key=lambda kv: (-kv[1], kv[0]))
    if max_news_vocab_size > 0:
        ranked = ranked[:max_news_vocab_size]
    return {item_id for item_id, _ in ranked}


def prune_samples_to_items(
    samples: List[Dict[str, Any]],
    retained_items: Set[str],
    min_history: int,
) -> List[Dict[str, Any]]:
    if not retained_items:
        return []

    pruned: List[Dict[str, Any]] = []
    for sample in samples:
        candidate_id = str(sample.get("candidate_id") or "")
        if candidate_id not in retained_items:
            continue
        history = [
            str(item_id)
            for item_id in sample.get("history", [])
            if str(item_id) in retained_items
        ]
        if len(history) < min_history:
            continue
        next_sample = dict(sample)
        next_sample["history"] = history
        pruned.append(next_sample)
    return pruned


def build_vocab(values: Iterable[str]) -> Dict[str, int]:
    vocab = {SPECIAL_PAD: 0, SPECIAL_UNK: 1}
    for value in sorted({str(v) for v in values if str(v)}):
        if value not in vocab:
            vocab[value] = len(vocab)
    return vocab


def write_pickle(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(value, f, protocol=pickle.HIGHEST_PROTOCOL)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Preprocess KuaiRec/KuaiRand into the ML artifact contract.")
    parser.add_argument("--kuairec-dir", type=Path, default=None, help="Path to KuaiRec root or data directory.")
    parser.add_argument("--kuairand-dir", type=Path, default=None, help="Path to KuaiRand root or data directory.")
    parser.add_argument("--kuairand-content-dir", type=Path, default=None, help="Path containing KuaiRand caption/category supplements.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--metadata-mode",
        choices=["fast", "full", "none"],
        default="fast",
        help=(
            "fast keeps useful content metadata but uses tolerant parsing; "
            "full is stricter/slower; none skips optional caption/category supplements."
        ),
    )
    parser.add_argument("--chunk-size", type=int, default=250_000)
    parser.add_argument("--min-history", type=int, default=3)
    parser.add_argument("--max-train-samples", type=int, default=5_000_000, help="0 means no cap.")
    parser.add_argument("--max-dev-samples", type=int, default=500_000, help="0 means no cap.")
    parser.add_argument("--max-rows-per-file", type=int, default=0, help="Development cap; 0 means all rows.")
    parser.add_argument(
        "--max-news-vocab-size",
        type=int,
        default=0,
        help="Keep only the most frequent items in news_vocab; 0 keeps all observed items.",
    )
    parser.add_argument(
        "--min-item-frequency",
        type=int,
        default=1,
        help="Drop items observed fewer than this count before building news_vocab.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.kuairec_dir and not args.kuairand_dir:
        raise SystemExit("At least one of --kuairec-dir or --kuairand-dir is required.")

    source_files = discover_source_files(args.kuairec_dir, args.kuairand_dir)
    if not source_files:
        raise SystemExit("No KuaiRec/KuaiRand interaction files were found.")

    print("📦 Loading content metadata...")
    news_dict: Dict[str, Dict[str, Any]] = {}
    news_dict.update(load_kuairec_metadata(args.kuairec_dir, args.metadata_mode))
    news_dict.update(load_kuairand_metadata(args.kuairand_dir, args.kuairand_content_dir, args.metadata_mode))

    print("🔄 Building interaction samples...")
    train_samples, dev_samples, user_sequences, item_counts = process_interactions(
        source_files=source_files,
        chunk_size=args.chunk_size,
        min_history=args.min_history,
        max_train_samples=args.max_train_samples,
        max_dev_samples=args.max_dev_samples,
        max_rows_per_file=args.max_rows_per_file,
    )

    retained_items = select_news_vocab_items(
        item_counts=item_counts,
        max_news_vocab_size=args.max_news_vocab_size,
        min_item_frequency=args.min_item_frequency,
    )
    if args.max_news_vocab_size > 0 or args.min_item_frequency > 1:
        original_train_count = len(train_samples)
        original_dev_count = len(dev_samples)
        train_samples = prune_samples_to_items(train_samples, retained_items, args.min_history)
        dev_samples = prune_samples_to_items(dev_samples, retained_items, args.min_history)
        print(
            "✂️ Pruned news vocab/items: "
            f"retained={len(retained_items)} train={original_train_count}->{len(train_samples)} "
            f"dev={original_dev_count}->{len(dev_samples)}"
        )
    else:
        retained_items = set(item_counts.keys())

    for item_id in retained_items:
        news_dict.setdefault(
            item_id,
            {
                "news_id": item_id,
                "source": item_id.split("_", 1)[0],
                "title": f"Short video {item_id}",
                "abstract": "",
                "text": f"Short video {item_id}",
                "category": "short_video",
                "subcategory": "",
                "url": f"{item_id.split('_', 1)[0]}://{item_id}",
                "keywords": [],
            },
        )
    news_dict = {
        item_id: value
        for item_id, value in news_dict.items()
        if item_id in retained_items
    }
    news_dict = ensure_metadata_defaults(news_dict)

    news_vocab = build_vocab(news_dict.keys())
    user_vocab = build_vocab(user_sequences.keys())

    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_pickle(args.output_dir / "news_dict.pkl", news_dict)
    write_pickle(args.output_dir / "news_vocab.pkl", news_vocab)
    write_pickle(args.output_dir / "user_vocab.pkl", user_vocab)
    write_pickle(args.output_dir / "train_samples.pkl", train_samples)
    write_pickle(args.output_dir / "dev_samples.pkl", dev_samples)

    manifest = {
        "source": "kuairec_kuairand",
        "schema": "telegram_ml_samples_v2",
        "num_items": len(news_dict),
        "num_users": len(user_vocab),
        "num_train_samples": len(train_samples),
        "num_dev_samples": len(dev_samples),
        "num_observed_items": len(item_counts),
        "max_news_vocab_size": args.max_news_vocab_size,
        "min_item_frequency": args.min_item_frequency,
        "retained_items": len(retained_items),
        "source_files": [{"path": str(s.path), "dataset": s.dataset, "split": s.split} for s in source_files],
        "labels": ["click", "like", "reply", "repost", "dwell", "negative"],
        "id_prefixes": ["kuairec_", "kuairand_"],
        "metadata_mode": args.metadata_mode,
    }
    (args.output_dir / "preprocess_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("✅ Kuai preprocessing complete")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
