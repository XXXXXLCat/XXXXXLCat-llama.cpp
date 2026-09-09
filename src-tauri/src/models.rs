use std::fs;
use std::path::{Path, PathBuf};

use crate::types::{DraftMatch, MatchConfidence, MmprojMatch, ModelFile, ModelKind};

/// Recognised quantisation suffixes, longest first so that greedy matching
/// picks `ud-q4_k_xl` over `q4_k`.
const QUANTS: &[&str] = &[
    "ud-iq1_s",
    "ud-iq2_xxs",
    "ud-iq2_xs",
    "ud-iq2_s",
    "ud-iq2_m",
    "ud-iq3_xxs",
    "ud-iq3_xs",
    "ud-iq3_s",
    "ud-iq3_m",
    "ud-iq4_xs",
    "ud-iq4_nl",
    "ud-q2_k_xl",
    "ud-q3_k_xl",
    "ud-q4_k_xl",
    "ud-q5_k_xl",
    "ud-q6_k_xl",
    "ud-q8_k_xl",
    "iq1_s",
    "iq1_m",
    "iq2_xxs",
    "iq2_xs",
    "iq2_s",
    "iq2_m",
    "iq3_xxs",
    "iq3_xs",
    "iq3_s",
    "iq3_m",
    "iq4_xs",
    "iq4_nl",
    "q2_k",
    "q3_k_s",
    "q3_k_m",
    "q3_k_l",
    "q4_0",
    "q4_1",
    "q4_k_s",
    "q4_k_m",
    "q5_0",
    "q5_1",
    "q5_k_s",
    "q5_k_m",
    "q6_k",
    "q8_0",
    "bf16",
    "f16",
    "f32",
];

/// Model family prefixes.
const FAMILIES: &[(&str, &str)] = &[
    ("qwen", "Qwen"),
    ("llama", "Llama"),
    ("gemma", "Gemma"),
    ("mistral", "Mistral"),
    ("mixtral", "Mixtral"),
    ("deepseek", "DeepSeek"),
    ("glm", "GLM"),
    ("phi", "Phi"),
    ("yi", "Yi"),
    ("baichuan", "Baichuan"),
    ("internlm", "InternLM"),
    ("command-r", "Command-R"),
    ("cohere", "Cohere"),
    ("falcon", "Falcon"),
    ("starcoder", "StarCoder"),
    ("smollm", "SmolLM"),
    ("granite", "Granite"),
    ("olmo", "OLMo"),
    ("nemotron", "Nemotron"),
    ("devstral", "Devstral"),
    ("magistral", "Magistral"),
    ("minicpm", "MiniCPM"),
    ("llava", "LLaVA"),
];

const MAX_DEPTH: usize = 6;

/// Recursively collect every `.gguf` file under `root`, classifying each as a
/// text model or a vision projector.
pub fn scan_models(root: &str) -> Result<Vec<ModelFile>, String> {
    let root_path = PathBuf::from(root);
    if !root_path.exists() {
        return Err(format!("模型目录不存在: {root}"));
    }

    let mut out = Vec::new();
    walk(&root_path, 0, &mut out);
    out.sort_by(|a, b| {
        a.dir
            .cmp(&b.dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

/// Scan every root in `roots` and merge the results, de-duplicating by file
/// path. Missing / unreadable roots are skipped so one bad library never
/// blanks the whole model list.
pub fn scan_models_multi(roots: &[String]) -> Vec<ModelFile> {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<ModelFile> = Vec::new();
    for root in roots {
        let root = root.trim();
        if root.is_empty() {
            continue;
        }
        match scan_models(root) {
            Ok(files) => {
                for f in files {
                    if seen.insert(f.path.clone()) {
                        out.push(f);
                    }
                }
            }
            Err(_) => continue,
        }
    }
    out
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<ModelFile>) {
    if depth > MAX_DEPTH {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        if file_name.starts_with('.') || file_name.starts_with("__") {
            continue;
        }

        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        if meta.is_dir() {
            // Skip obvious non-model directories to keep scans fast.
            let lower = file_name.to_lowercase();
            if lower == "node_modules" || lower == ".git" || lower == "cache" {
                continue;
            }
            walk(&path, depth + 1, out);
            continue;
        }

        if !file_name.to_lowercase().ends_with(".gguf") {
            continue;
        }

        let stem = file_name
            .strip_suffix(".gguf")
            .or_else(|| file_name.strip_suffix(".GGUF"))
            .unwrap_or(&file_name);
        let kind = if is_projector(stem) {
            ModelKind::Vision
        } else if is_draft(stem) {
            ModelKind::Draft
        } else {
            ModelKind::Text
        };

        out.push(ModelFile {
            path: path.to_string_lossy().to_string(),
            name: file_name.clone(),
            dir: dir.to_string_lossy().to_string(),
            size_bytes: meta.len(),
            kind,
            family: detect_family(stem),
            quant: detect_quant(stem),
            params: detect_params(stem),
        });
    }
}

/// A projector is any GGUF holding the multimodal vision tower / projection
/// weights. llama.cpp and the HF ecosystem follow a handful of conventions.
fn is_projector(stem: &str) -> bool {
    let s = stem.to_lowercase();
    s.contains("mmproj")
        || s.contains("projector")
        || s.contains("vision_tower")
        || s.contains("vision-tower")
        || s.contains("clip_vision")
        || s.contains("clip-vision")
        || s.contains("image_encoder")
        || s.contains("image-encoder")
        || s.contains("siglip")
        || s.contains("vit-")
        || s.starts_with("clip-")
}

/// A draft model is a small assistant model used for speculative decoding.
/// llama.cpp and the ecosystem name them with `mtp`, `draft`, `eagle` or a
/// `spec` token, e.g. `Qwen3-30B-A3B-Q4_K_M-MTP.gguf`, `mtp-Qwen3.6-35B-Q4_0`,
/// `draft.gguf`, `eagle-qwen.gguf`.
fn is_draft(stem: &str) -> bool {
    let s = stem.to_lowercase();
    s.contains("mtp")
        || s.contains("draft")
        || s.contains("eagle")
        || s.starts_with("spec-")
        || s.ends_with("-spec")
        || s.contains("-spec-")
}

fn detect_quant(stem: &str) -> Option<String> {
    let lower = stem.to_lowercase();
    for q in QUANTS {
        let needle = format!("-{q}");
        let needle_us = format!("_{q}");
        if lower.ends_with(&needle) || lower.ends_with(&needle_us) || lower == *q {
            return Some((*q).to_string());
        }
    }
    None
}

fn detect_params(stem: &str) -> Option<String> {
    for token in stem.split(['-', '_', '.', ' ']) {
        let t = token.trim();
        if t.len() >= 2
            && t.chars().next().is_some_and(|c| c.is_ascii_digit())
            && t.chars().last().is_some_and(|c| c == 'b' || c == 'B')
            && t[..t.len() - 1].chars().all(|c| c.is_ascii_digit())
        {
            return Some(t.to_uppercase());
        }
    }
    None
}

fn detect_family(stem: &str) -> Option<String> {
    let lower = stem.to_lowercase();
    for (needle, label) in FAMILIES {
        if lower.contains(needle) {
            return Some((*label).to_string());
        }
    }
    None
}

/// Lowercase, alphanumeric-only canonical form used for name comparison.
fn canon(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Strip a trailing quantisation marker from a canonical name.
fn strip_trailing_quant(name: &str) -> String {
    let mut out = name.to_string();
    loop {
        let mut matched = false;
        for q in QUANTS {
            let qc = canon(q);
            if out.len() > qc.len() && out.ends_with(&qc) {
                out.truncate(out.len() - qc.len());
                matched = true;
                break;
            }
        }
        if !matched {
            break;
        }
    }
    out
}

/// Length of the longest common prefix, normalised by the shorter input.
fn lcp_ratio(a: &str, b: &str) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let common = a
        .chars()
        .zip(b.chars())
        .take_while(|(x, y)| x == y)
        .count();
    let denom = a.chars().count().min(b.chars().count());
    if denom == 0 {
        0.0
    } else {
        common as f64 / denom as f64
    }
}

/// Find the projector that best matches the given main model.
///
/// Ranking strategy:
/// 1. Candidate scope — ONLY projectors living in the SAME directory as the
///    main model are considered. A projector shipped next to a *different*
///    model (in another folder) is never matched; an auxiliary model belongs
///    to its own main model only.
/// 2. Name correlation — how much of the model stem the projector stem shares
///    (e.g. `Qwen3.6-35B-...-Q4_K_M.gguf` ↔ `mmproj-Qwen3.6-35B-...-f16.gguf`).
/// 3. If the directory holds exactly one projector, that is taken regardless
///    of how uninformative its name is (e.g. `mmproj-F16.gguf`).
pub fn match_mmproj(model_path: &str, all: &[ModelFile]) -> MmprojMatch {
    let model = Path::new(model_path);
    let model_dir = model
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let model_stem = model
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let model_key = strip_trailing_quant(&canon(&model_stem));

    // Only consider projectors that live in the SAME directory as the main
    // model. A vision projector shipped next to a different model (in another
    // folder) must never be matched — an auxiliary model belongs to its own
    // main model only.
    let projectors: Vec<&ModelFile> = all
        .iter()
        .filter(|m| m.kind == ModelKind::Vision && m.dir == model_dir)
        .collect();

    if projectors.is_empty() {
        return MmprojMatch {
            mmproj_path: None,
            confidence: MatchConfidence::None,
            score: 0.0,
            candidates: Vec::new(),
        };
    }

    let mut scored: Vec<(f64, &ModelFile)> = projectors
        .iter()
        .map(|p| {
            let stem = Path::new(&p.name)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| p.name.clone());
            let key = strip_trailing_quant(&canon(&stem).replace("mmproj", ""));
            let score = lcp_ratio(&model_key, &key);
            (score.min(1.0), *p)
        })
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let best_score = scored.first().map(|(s, _)| *s).unwrap_or(0.0);
    let best = scored.first().map(|(_, m)| *m);

    let same_dir_count = projectors.iter().filter(|p| p.dir == model_dir).count();
    let candidates = scored
        .iter()
        .take(8)
        .map(|(_, m)| m.path.clone())
        .collect::<Vec<_>>();

    let confidence = if best_score >= 0.6 {
        MatchConfidence::Exact
    } else if same_dir_count == 1 {
        // Only one projector ships with this model — take it regardless of
        // how uninformative its name is.
        MatchConfidence::Unique
    } else if best_score > 0.0 {
        MatchConfidence::Weak
    } else {
        MatchConfidence::None
    };

    let resolved = match confidence {
        MatchConfidence::Exact | MatchConfidence::Weak => best,
        MatchConfidence::Unique => projectors
            .iter()
            .find(|p| p.dir == model_dir)
            .copied()
            .or(best),
        // Ambiguous: leave the choice to the user rather than guessing.
        MatchConfidence::None => None,
    };

    MmprojMatch {
        mmproj_path: resolved.map(|m| m.path.clone()),
        confidence,
        score: best_score,
        candidates,
    }
}

/// Find the draft model (speculative decoding) that best matches the given main
/// model. Strategy is identical to `match_mmproj` but operates on `Draft` files
/// and strips the `mtp`/`draft`/`eagle` prefix tokens before comparing names.
pub fn match_draft(model_path: &str, all: &[ModelFile]) -> DraftMatch {
    let model = Path::new(model_path);
    let model_dir = model
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let model_stem = model
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let model_key = strip_trailing_quant(&canon(&model_stem));

    // Only consider draft models that live in the SAME directory as the main
    // model. A draft shipped next to a different model (in another folder)
    // must never be matched — an auxiliary model belongs to its own main
    // model only.
    let drafts: Vec<&ModelFile> = all
        .iter()
        .filter(|m| m.kind == ModelKind::Draft && m.dir == model_dir)
        .collect();

    if drafts.is_empty() {
        return DraftMatch {
            draft_path: None,
            confidence: MatchConfidence::None,
            score: 0.0,
            candidates: Vec::new(),
        };
    }

    let mut scored: Vec<(f64, &ModelFile)> = drafts
        .iter()
        .map(|p| {
            let stem = Path::new(&p.name)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| p.name.clone());
            let key = strip_trailing_quant(
                &canon(&stem)
                    .replace("mtp", "")
                    .replace("draft", "")
                    .replace("eagle", "")
                    .replace("spec", ""),
            );
            let score = lcp_ratio(&model_key, &key);
            (score.min(1.0), *p)
        })
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let best_score = scored.first().map(|(s, _)| *s).unwrap_or(0.0);
    let best = scored.first().map(|(_, m)| *m);

    let same_dir_count = drafts.iter().filter(|p| p.dir == model_dir).count();
    let candidates = scored
        .iter()
        .take(8)
        .map(|(_, m)| m.path.clone())
        .collect::<Vec<_>>();

    let confidence = if best_score >= 0.6 {
        MatchConfidence::Exact
    } else if same_dir_count == 1 {
        MatchConfidence::Unique
    } else if best_score > 0.0 {
        MatchConfidence::Weak
    } else {
        MatchConfidence::None
    };

    let resolved = match confidence {
        MatchConfidence::Exact | MatchConfidence::Weak => best,
        MatchConfidence::Unique => drafts
            .iter()
            .find(|p| p.dir == model_dir)
            .copied()
            .or(best),
        MatchConfidence::None => None,
    };

    DraftMatch {
        draft_path: resolved.map(|m| m.path.clone()),
        confidence,
        score: best_score,
        candidates,
    }
}
