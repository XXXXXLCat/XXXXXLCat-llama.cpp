use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};

use crate::types::ModelMeta;

/// A single GGUF metadata value, exactly mirroring the on-disk
/// `GGUFMetadataValueType` discriminant table.
#[derive(Debug, Clone)]
#[allow(dead_code)]
enum GgufValue {
    U8(u8),
    I8(i8),
    U16(u16),
    I16(i16),
    U32(u32),
    I32(i32),
    F32(f32),
    Bool(bool),
    Str(String),
    U64(u64),
    I64(i64),
    F64(f64),
    Array(Vec<GgufValue>),
}

/// Little-endian sequential reader over a `BufReader<File>`. We deliberately
/// stop after the metadata KV section, so multi-GB weight tensors are never
/// read into memory.
struct Reader<R: Read> {
    r: R,
}

impl<R: Read> Reader<R> {
    fn read_exact_bytes(&mut self, n: usize) -> Result<Vec<u8>, String> {
        let mut buf = vec![0u8; n];
        self.r
            .read_exact(&mut buf)
            .map_err(|e| format!("读取 GGUF 失败: {e}"))?;
        Ok(buf)
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.read_exact_bytes(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, String> {
        let b = self.read_exact_bytes(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }
    fn u32(&mut self) -> Result<u32, String> {
        let b = self.read_exact_bytes(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn u64(&mut self) -> Result<u64, String> {
        let b = self.read_exact_bytes(8)?;
        Ok(u64::from_le_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }
    fn i32(&mut self) -> Result<i32, String> {
        let b = self.read_exact_bytes(4)?;
        Ok(i32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn i64(&mut self) -> Result<i64, String> {
        let b = self.read_exact_bytes(8)?;
        Ok(i64::from_le_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }
    fn f32(&mut self) -> Result<f32, String> {
        let b = self.read_exact_bytes(4)?;
        Ok(f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn f64(&mut self) -> Result<f64, String> {
        let b = self.read_exact_bytes(8)?;
        Ok(f64::from_le_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }
    fn gguf_str(&mut self) -> Result<String, String> {
        let len = self.u64()? as usize;
        let bytes = self.read_exact_bytes(len)?;
        String::from_utf8(bytes).map_err(|e| format!("GGUF 字符串非 UTF-8: {e}"))
    }

    fn value(&mut self, t: u32) -> Result<GgufValue, String> {
        let v = match t {
            0 => GgufValue::U8(self.u8()?),
            1 => GgufValue::I8(self.u8()? as i8),
            2 => GgufValue::U16(self.u16()?),
            3 => GgufValue::I16(self.u16()? as i16),
            4 => GgufValue::U32(self.u32()?),
            5 => GgufValue::I32(self.i32()?),
            6 => GgufValue::F32(self.f32()?),
            7 => GgufValue::Bool(self.u8()? != 0),
            8 => GgufValue::Str(self.gguf_str()?),
            9 => {
                let et = self.u32()?;
                let n = self.u64()?;
                let mut arr = Vec::with_capacity(n as usize);
                for _ in 0..n {
                    arr.push(self.value(et)?);
                }
                GgufValue::Array(arr)
            }
            10 => GgufValue::U64(self.u64()?),
            11 => GgufValue::I64(self.i64()?),
            12 => GgufValue::F64(self.f64()?),
            _ => return Err(format!("未知 GGUF 元数据值类型: {t}")),
        };
        Ok(v)
    }
}

fn get_str(m: &HashMap<String, GgufValue>, key: &str) -> Option<String> {
    match m.get(key) {
        Some(GgufValue::Str(s)) => Some(s.clone()),
        _ => None,
    }
}

fn get_u32(m: &HashMap<String, GgufValue>, key: &str) -> Option<u32> {
    match m.get(key) {
        Some(GgufValue::U32(v)) => Some(*v),
        Some(GgufValue::U64(v)) => Some(*v as u32),
        _ => None,
    }
}

fn get_u64(m: &HashMap<String, GgufValue>, key: &str) -> Option<u64> {
    match m.get(key) {
        Some(GgufValue::U64(v)) => Some(*v),
        Some(GgufValue::U32(v)) => Some(*v as u64),
        _ => None,
    }
}

fn get_f64(m: &HashMap<String, GgufValue>, key: &str) -> Option<f64> {
    match m.get(key) {
        Some(GgufValue::F64(v)) => Some(*v),
        Some(GgufValue::F32(v)) => Some(*v as f64),
        Some(GgufValue::U64(v)) => Some(*v as f64),
        Some(GgufValue::U32(v)) => Some(*v as f64),
        _ => None,
    }
}

fn get_f32(m: &HashMap<String, GgufValue>, key: &str) -> Option<f32> {
    match m.get(key) {
        Some(GgufValue::F32(v)) => Some(*v),
        Some(GgufValue::F64(v)) => Some(*v as f32),
        _ => None,
    }
}

fn get_bool(m: &HashMap<String, GgufValue>, key: &str) -> Option<bool> {
    match m.get(key) {
        Some(GgufValue::Bool(v)) => Some(*v),
        _ => None,
    }
}

fn get_str_array(m: &HashMap<String, GgufValue>, key: &str) -> Option<Vec<String>> {
    match m.get(key) {
        Some(GgufValue::Array(arr)) => {
            let v: Vec<String> = arr
                .iter()
                .filter_map(|x| match x {
                    GgufValue::Str(s) => Some(s.clone()),
                    _ => None,
                })
                .collect();
            if v.is_empty() {
                None
            } else {
                Some(v)
            }
        }
        _ => None,
    }
}

/// Render any GGUF value as a display string. Arrays are summarised when
/// large (the UI gets the *shape*, not 150k token ids).
fn fmt_value(v: &GgufValue) -> String {
    match v {
        GgufValue::U8(x) => x.to_string(),
        GgufValue::I8(x) => x.to_string(),
        GgufValue::U16(x) => x.to_string(),
        GgufValue::I16(x) => x.to_string(),
        GgufValue::U32(x) => x.to_string(),
        GgufValue::I32(x) => x.to_string(),
        GgufValue::U64(x) => x.to_string(),
        GgufValue::I64(x) => x.to_string(),
        GgufValue::F32(x) => x.to_string(),
        GgufValue::F64(x) => x.to_string(),
        GgufValue::Bool(x) => x.to_string(),
        GgufValue::Str(s) => s.clone(),
        GgufValue::Array(arr) => {
            if arr.is_empty() {
                "[]".to_string()
            } else if arr.len() <= 64 {
                let inner = arr.iter().map(fmt_value).collect::<Vec<_>>().join(", ");
                format!("[{inner}]")
            } else {
                let tname = match &arr[0] {
                    GgufValue::Str(_) => "str",
                    GgufValue::U8(_) => "u8",
                    GgufValue::U16(_) => "u16",
                    GgufValue::I8(_) => "i8",
                    GgufValue::I16(_) => "i16",
                    GgufValue::U32(_) => "u32",
                    GgufValue::U64(_) => "u64",
                    GgufValue::I32(_) => "i32",
                    GgufValue::I64(_) => "i64",
                    GgufValue::F32(_) => "f32",
                    GgufValue::F64(_) => "f64",
                    GgufValue::Bool(_) => "bool",
                    GgufValue::Array(_) => "array",
                };
                format!("[{tname}; {}]", arr.len())
            }
        }
    }
}

/// llama.cpp `GGUF` `file_type` enum → human quant label.
fn file_type_label(ft: u32) -> &'static str {
    match ft {
        0 => "F32",
        1 => "F16",
        2 => "Q4_0",
        3 => "Q4_1",
        4 => "Q4_K",
        5 => "Q5_0",
        6 => "Q5_1",
        7 => "Q8_0",
        8 => "Q2_K",
        9 => "Q3_K_S",
        10 => "Q3_K_M",
        11 => "Q3_K_L",
        12 => "Q4_K_S",
        13 => "Q4_K_M",
        14 => "Q5_K_S",
        15 => "Q5_K_M",
        16 => "Q6_K",
        17 => "IQ2_XXS",
        18 => "IQ2_XS",
        19 => "IQ3_XXS",
        20 => "IQ3_S",
        21 => "IQ3_M",
        22 => "IQ4_XS",
        23 => "IQ4_NL",
        24 => "IQ5_XS",
        25 => "IQ5_NL",
        _ => "unknown",
    }
}

/// GGUF metadata keys carrying huge arrays we must NOT ship to the UI.
fn is_giant_array(key: &str) -> bool {
    key == "tokenizer.ggml.tokens"
        || key == "tokenizer.ggml.merges"
        || key == "tokenizer.ggml.scores"
        || key == "tokenizer.ggml.token_type"
        || key == "tokenizer.huggingface.ggml.token_type"
}

/// Read the GGUF header + **full** metadata KV block (weights are NOT loaded)
/// and surface both a curated `ModelMeta` for the headline cards and a
/// verbatim `extra` map so the UI can show every metadata key.
pub fn parse_gguf(path: &str) -> Result<ModelMeta, String> {
    let file = File::open(path).map_err(|e| format!("无法打开模型文件: {e}"))?;
    let mut rd = Reader {
        r: BufReader::new(file),
    };

    let magic = rd.read_exact_bytes(4)?;
    if magic != b"GGUF" {
        return Err("不是 GGUF 文件（magic 不匹配）".to_string());
    }
    let format_version = rd.u32()?;
    let _tensor_count = rd.u64()?;
    let kv_count = rd.u64()?;

    let mut map: HashMap<String, GgufValue> = HashMap::new();
    for _ in 0..kv_count {
        let key = rd.gguf_str()?;
        let vtype = rd.u32()?;
        let val = rd.value(vtype)?;
        map.insert(key, val);
    }

    let arch = get_str(&map, "general.architecture");
    let a = arch.as_deref();

    // 通用元数据
    let context_length = a
        .and_then(|a| get_u32(&map, &format!("{a}.context_length")))
        .or_else(|| get_u32(&map, "general.context_length"));
    let file_type = get_u32(&map, "general.file_type");
    let quant = file_type.map(file_type_label).map(|s| s.to_string());

    let vocab_size = a
        .and_then(|a| get_u32(&map, &format!("{a}.vocab_size")))
        .or_else(|| get_u32(&map, "general.vocab_size"));
    let embedding_length = a.and_then(|a| get_u32(&map, &format!("{a}.embedding_length")));
    let block_count = a.and_then(|a| get_u32(&map, &format!("{a}.block_count")));

    // 注意力 / RoPE / MoE（架构块）—— 注意真实 RoPE key 是 {arch}.rope.freq_base
    let head_count = a.and_then(|a| get_u32(&map, &format!("{a}.attention.head_count")));
    let head_count_kv = a.and_then(|a| get_u32(&map, &format!("{a}.attention.head_count_kv")));
    let key_length = a.and_then(|a| get_u32(&map, &format!("{a}.attention.key_length")));
    let value_length = a.and_then(|a| get_u32(&map, &format!("{a}.attention.value_length")));
    let norm_epsilon = a.and_then(|a| {
        get_f32(&map, &format!("{a}.attention.layer_norm_rms_epsilon"))
            .or_else(|| get_f32(&map, &format!("{a}.norm_epsilon")))
    });
    let causal = a.and_then(|a| get_bool(&map, &format!("{a}.attention.causal")));
    let rope_freq_base = a
        .and_then(|a| get_f64(&map, &format!("{a}.rope.freq_base")))
        .or_else(|| get_f64(&map, "general.rope.freq_base"));
    let rope_dim = a.and_then(|a| get_u32(&map, &format!("{a}.rope.dimension_count")));
    let rope_scale_linear = a.and_then(|a| get_f64(&map, &format!("{a}.rope.scale_linear")));
    let rope_scaling_type = a.and_then(|a| get_str(&map, &format!("{a}.rope.scaling_type")));
    let sliding_window = a.and_then(|a| get_u32(&map, &format!("{a}.sliding_window")));
    let pooling_type = a.and_then(|a| get_str(&map, &format!("{a}.pooling_type")));
    let expert_count = a.and_then(|a| get_u32(&map, &format!("{a}.expert_count")));
    let expert_used_count = a.and_then(|a| get_u32(&map, &format!("{a}.expert_used_count")));
    let bos_token_id = a
        .and_then(|a| get_u32(&map, &format!("{a}.bos_token_id")))
        .or_else(|| get_u32(&map, "tokenizer.ggml.bos_token_id"));
    let eos_token_id = a
        .and_then(|a| get_u32(&map, &format!("{a}.eos_token_id")))
        .or_else(|| get_u32(&map, "tokenizer.ggml.eos_token_id"));

    // Tokenizer
    let tokenizer_model = get_str(&map, "tokenizer.ggml.model");
    let tokenizer_pre = get_str(&map, "tokenizer.ggml.pre");
    let add_bos = get_bool(&map, "tokenizer.ggml.add_bos");
    let add_eos = get_bool(&map, "tokenizer.ggml.add_eos");

    // 全量剩余 KV（排除巨型 tokenizer 数组）
    let mut extra: HashMap<String, String> = HashMap::new();
    for (k, v) in &map {
        if is_giant_array(k) {
            continue;
        }
        extra.insert(k.clone(), fmt_value(v));
    }

    Ok(ModelMeta {
        architecture: arch,
        name: get_str(&map, "general.name"),
        author: get_str(&map, "general.author"),
        basename: get_str(&map, "general.basename"),
        finetune: get_str(&map, "general.finetune"),
        description: get_str(&map, "general.description"),
        license: get_str(&map, "general.license"),
        tags: get_str_array(&map, "general.tags"),
        languages: get_str_array(&map, "general.languages"),
        domain: get_str(&map, "general.domain"),
        format_version: Some(format_version),
        file_version: get_u32(&map, "general.file_version"),
        quantization_version: get_u32(&map, "general.quantization_version"),
        tensor_data_layout: get_str(&map, "general.tensor_data_layout"),
        param_count: get_u64(&map, "general.parameter_count"),
        context_length,
        size_label: get_str(&map, "general.size_label"),
        quant,
        file_type,
        vocab_size,
        embedding_length,
        block_count,
        chat_template: get_str(&map, "general.chat_template"),
        head_count,
        head_count_kv,
        key_length,
        value_length,
        norm_epsilon,
        causal,
        rope_freq_base,
        rope_dim,
        rope_scale_linear,
        rope_scaling_type,
        sliding_window,
        pooling_type,
        expert_count,
        expert_used_count,
        bos_token_id,
        eos_token_id,
        tokenizer_model,
        tokenizer_pre,
        add_bos,
        add_eos,
        extra,
    })
}
