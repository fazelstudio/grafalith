//! `nary` — Python (PyO3/maturin) distribution of the Nary Rust engine.
//!
//! This crate exposes the instance-scoped [`PyEngine`] handle through a
//! `#[pymodule]` named `_nary` (see `pyproject.toml`
//! `module-name = "nary._nary"`). The Pythonic wrapper lives in
//! `python/nary/__init__.py` and converts the JSON-string boundary into
//! plain `dict`/`list`/`str` values.
//!
//! Boundary rules (same as `nary-bindings`): every crossing is JSON
//! compatible and Rust domain types never cross; layout ops (`align`,
//! `distribute`, `applyAutoLayout`) flow through the generic
//! [`PyEngine::apply_batch`] path with no dedicated method by design;
//! Rust failures become `ValueError` and never panic across the FFI.
//!
//! JSON conversion is manual via `pyo3` `PyDict`/`PyList` types — no
//! `pythonize` dependency.

// `?` on `Result<_, PyErr>` inside `PyResult` functions triggers a known
// clippy false positive (`From<PyErr> for PyErr` is the identity).
#![allow(clippy::useless_conversion)]

use nary_bindings::{Engine, BINDINGS_VERSION, PROTOCOL_VERSION};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::{PyBool, PyDict, PyFloat, PyInt, PyList, PyString, PyTuple};
use pyo3::{BoundObject, IntoPyObject, Py, PyAny};

/// Instance-scoped engine handle for one Python document view.
///
/// Owns one [`Engine`]: document, history, selection, viewport, and the
/// instance clipboard. Instances are independent (no shared globals).
/// All mutation flows through [`apply_batch`](PyEngine::apply_batch) so
/// one frame costs one crossing.
#[pyclass]
pub struct PyEngine {
    inner: Engine,
}

/// Converts a Python object to its JSON value.
///
/// Accepts `None`, `bool`, `int`, `float` (finite only), `str`,
/// `list`/`tuple`, and `dict` (string keys). Anything else is a
/// `ValueError`. `bool` is checked before `int` because Python `bool`
/// subclasses `int`.
fn py_to_json_value(obj: &Bound<'_, PyAny>) -> PyResult<serde_json::Value> {
    if obj.is_none() {
        return Ok(serde_json::Value::Null);
    }
    if obj.is_instance_of::<PyBool>() {
        let b: bool = obj.extract()?;
        return Ok(serde_json::Value::Bool(b));
    }
    if obj.is_instance_of::<PyInt>() {
        if let Ok(n) = obj.extract::<i64>() {
            return Ok(serde_json::Value::from(n));
        }
        if let Ok(n) = obj.extract::<u64>() {
            return Ok(serde_json::Value::from(n));
        }
        return Err(PyErr::new::<PyValueError, _>(
            "integer out of i64/u64 range for JSON conversion",
        ));
    }
    if obj.is_instance_of::<PyFloat>() {
        let n: f64 = obj.extract()?;
        return serde_json::Number::from_f64(n)
            .map(serde_json::Value::Number)
            .ok_or_else(|| {
                PyErr::new::<PyValueError, _>(
                    "non-finite floats (NaN/inf) have no JSON representation",
                )
            });
    }
    if obj.is_instance_of::<PyString>() {
        let s: String = obj.extract()?;
        return Ok(serde_json::Value::String(s));
    }
    if obj.is_instance_of::<PyList>() || obj.is_instance_of::<PyTuple>() {
        let iter = obj.try_iter()?;
        let mut items = Vec::new();
        for item in iter {
            items.push(py_to_json_value(&item?)?);
        }
        return Ok(serde_json::Value::Array(items));
    }
    if obj.is_instance_of::<PyDict>() {
        let dict = obj
            .cast::<PyDict>()
            .map_err(|_| PyErr::new::<PyValueError, _>("failed to downcast dict"))?;
        let mut map = serde_json::Map::new();
        for (key, value) in dict.iter() {
            let key_str: String = key.extract().map_err(|_| {
                PyErr::new::<PyValueError, _>("dict keys must be strings for JSON conversion")
            })?;
            map.insert(key_str, py_to_json_value(&value)?);
        }
        return Ok(serde_json::Value::Object(map));
    }
    Err(PyErr::new::<PyValueError, _>(
        "unsupported Python type for JSON conversion (expected None, bool, int, float, str, list, tuple, or dict)",
    ))
}

/// Converts a primitive into an owned `PyAny`.
///
/// Infallible by construction: primitive Python conversions cannot fail,
/// so the empty error arm documents the invariant instead of panicking.
fn into_py_any<T>(py: Python<'_>, value: T) -> Py<PyAny>
where
    T: for<'py> IntoPyObject<'py, Error = std::convert::Infallible>,
{
    match value.into_pyobject(py) {
        Ok(bound) => bound.into_any().unbind(),
        Err(never) => match never {},
    }
}

/// Converts a JSON value to its Python object.
///
/// Uses `PyDict` for objects and `PyList` for arrays; scalars map to
/// `None`/`bool`/`int`/`float`/`str` directly.
fn json_to_py(py: Python<'_>, value: &serde_json::Value) -> PyResult<Py<PyAny>> {
    match value {
        serde_json::Value::Null => Ok(py.None()),
        serde_json::Value::Bool(b) => Ok(into_py_any(py, *b)),
        serde_json::Value::Number(n) => {
            if let Some(n) = n.as_i64() {
                Ok(into_py_any(py, n))
            } else if let Some(n) = n.as_u64() {
                Ok(into_py_any(py, n))
            } else if let Some(n) = n.as_f64() {
                Ok(into_py_any(py, n))
            } else {
                Err(PyErr::new::<PyValueError, _>(
                    "JSON number out of range for Python conversion",
                ))
            }
        }
        serde_json::Value::String(s) => Ok(into_py_any(py, s.clone())),
        serde_json::Value::Array(items) => {
            let list = PyList::empty(py);
            for item in items {
                list.append(json_to_py(py, item)?)?;
            }
            Ok(list.into_any().unbind())
        }
        serde_json::Value::Object(map) => {
            let dict = PyDict::new(py);
            for (key, item) in map {
                dict.set_item(key, json_to_py(py, item)?)?;
            }
            Ok(dict.into_any().unbind())
        }
    }
}

/// Parses a JSON-text string into a Python object.
fn json_str_to_py(py: Python<'_>, text: &str) -> PyResult<Py<PyAny>> {
    let value: serde_json::Value = serde_json::from_str(text).map_err(|err| {
        PyErr::new::<PyValueError, _>(format!("engine returned invalid JSON: {err}"))
    })?;
    json_to_py(py, &value)
}

/// Converts a Python `list[dict]` (or an already-encoded JSON-text
/// string) into the batch JSON text the engine consumes.
fn batch_to_json_string(py: Python<'_>, ops: &Py<PyAny>) -> PyResult<String> {
    let bound = ops.bind(py);
    if let Ok(text) = bound.extract::<String>() {
        return Ok(text);
    }
    let value = py_to_json_value(bound)?;
    if !value.is_array() {
        return Err(PyErr::new::<PyValueError, _>(
            "apply_batch expects a list of op dicts (or a JSON array string)",
        ));
    }
    serde_json::to_string(&value)
        .map_err(|err| PyErr::new::<PyValueError, _>(format!("failed to encode batch: {err}")))
}

/// Converts a Python scene (`dict` or JSON-text string) into the scene
/// JSON text the engine consumes.
fn scene_to_json_string(py: Python<'_>, scene: &Py<PyAny>) -> PyResult<String> {
    let bound = scene.bind(py);
    if let Ok(text) = bound.extract::<String>() {
        return Ok(text);
    }
    let value = py_to_json_value(bound)?;
    serde_json::to_string(&value)
        .map_err(|err| PyErr::new::<PyValueError, _>(format!("failed to encode scene: {err}")))
}

/// Converts Python PNG options (`dict`, JSON-text string, or `None`) into
/// the options JSON text the engine consumes (`None` means defaults).
fn options_to_json_string(py: Python<'_>, options: &Py<PyAny>) -> PyResult<String> {
    let bound = options.bind(py);
    if bound.is_none() {
        return Ok("{}".to_string());
    }
    if let Ok(text) = bound.extract::<String>() {
        return Ok(text);
    }
    let value = py_to_json_value(bound)?;
    serde_json::to_string(&value).map_err(|err| {
        PyErr::new::<PyValueError, _>(format!("failed to encode PNG options: {err}"))
    })
}

/// Maps an engine failure to `ValueError`.
fn engine_err<E: std::fmt::Display>(err: E) -> PyErr {
    PyErr::new::<PyValueError, _>(err.to_string())
}

#[pymethods]
impl PyEngine {
    /// Creates an empty engine.
    #[new]
    pub fn new() -> Self {
        Self {
            inner: Engine::new(),
        }
    }
    /// Executes a list of op dicts in one crossing and returns the batch-result dict.
    ///
    /// Accepts `list[dict]` (or a JSON array string). Covers the full
    /// protocol, including `align`, `distribute`, and `applyAutoLayout`
    /// (e.g. `{"op": "align", "ids": ["a", "b"], "mode": "left"}`).
    /// Per-op problems are `ok: False` entries — never raised.
    pub fn apply_batch(&mut self, py: Python<'_>, ops: Py<PyAny>) -> PyResult<Py<PyAny>> {
        batch_to_json_string(py, &ops).and_then(|batch_json| {
            let out = self.inner.apply_batch(&batch_json);
            json_str_to_py(py, &out)
        })
    }

    /// Returns the whitelisted status snapshot as a dict (render-loop dirty checks, toolbar state).
    pub fn status(&self, py: Python<'_>) -> PyResult<Py<PyAny>> {
        serde_json::to_value(self.inner.status())
            .map_err(engine_err)
            .and_then(|value| json_to_py(py, &value))
    }

    /// Exports the document to its scene dict.
    pub fn export_scene(&self, py: Python<'_>) -> PyResult<Py<PyAny>> {
        self.inner
            .export_scene()
            .map_err(engine_err)
            .and_then(|text| json_str_to_py(py, &text))
    }

    /// Replaces document content from a scene dict (or JSON-text string).
    ///
    /// `tracked` records the replacement as one undo entry. Returns
    /// `{"imported": ..., "skipped": ...}`.
    #[pyo3(signature = (scene, tracked=false))]
    pub fn import_scene(
        &mut self,
        py: Python<'_>,
        scene: Py<PyAny>,
        tracked: bool,
    ) -> PyResult<Py<PyAny>> {
        scene_to_json_string(py, &scene).and_then(|payload| {
            let summary = self
                .inner
                .import_scene(&payload, tracked)
                .map_err(engine_err)?;
            let value = serde_json::json!({
                "imported": summary.imported,
                "skipped": summary.skipped,
            });
            json_to_py(py, &value)
        })
    }

    /// Undoes one history entry (`True` = something was undone).
    pub fn undo(&mut self) -> PyResult<bool> {
        self.inner.undo().map_err(engine_err)
    }

    /// Redoes one history entry (`True` = something was redone).
    pub fn redo(&mut self) -> PyResult<bool> {
        self.inner.redo().map_err(engine_err)
    }

    /// Whether `undo` would do anything.
    pub fn can_undo(&self) -> bool {
        self.inner.can_undo()
    }

    /// Whether `redo` would do anything.
    pub fn can_redo(&self) -> bool {
        self.inner.can_redo()
    }

    /// Live (non-deleted) element count.
    pub fn element_count(&self) -> usize {
        self.inner.element_count()
    }

    /// Current document nonce (render-loop dirty check).
    pub fn scene_nonce(&self) -> u64 {
        self.inner.scene_nonce()
    }

    /// Encodes the clipboard buffer to the versioned payload string for host clipboard writes.
    pub fn encode_clipboard(&self) -> PyResult<String> {
        self.inner.encode_clipboard().map_err(engine_err)
    }

    /// Decodes a clipboard payload string to `{"count", "skipped", "ids"}` without touching engine state.
    #[staticmethod]
    pub fn decode_clipboard(py: Python<'_>, payload: &str) -> PyResult<Py<PyAny>> {
        Engine::decode_clipboard(payload)
            .map_err(engine_err)
            .and_then(|value| json_to_py(py, &value))
    }

    /// Plans PNG export from an options dict and returns the plan dict (pure math — the host rasterizes).
    pub fn plan_png_export(&self, py: Python<'_>, options: Py<PyAny>) -> PyResult<Py<PyAny>> {
        options_to_json_string(py, &options).and_then(|options_json| {
            self.inner
                .plan_png_export(&options_json)
                .map_err(engine_err)
                .and_then(|value| json_to_py(py, &value))
        })
    }

    /// Plans JPEG export from an options dict and returns the plan dict (no alpha: transparent resolves to white).
    pub fn plan_jpeg_export(&self, py: Python<'_>, options: Py<PyAny>) -> PyResult<Py<PyAny>> {
        options_to_json_string(py, &options).and_then(|options_json| {
            self.inner
                .plan_jpeg_export(&options_json)
                .map_err(engine_err)
                .and_then(|value| json_to_py(py, &value))
        })
    }

    /// Plans WebP export from an options dict and returns the plan dict (pure math — the host encodes).
    pub fn plan_webp_export(&self, py: Python<'_>, options: Py<PyAny>) -> PyResult<Py<PyAny>> {
        options_to_json_string(py, &options).and_then(|options_json| {
            self.inner
                .plan_webp_export(&options_json)
                .map_err(engine_err)
                .and_then(|value| json_to_py(py, &value))
        })
    }

    /// Returns the bindings crate version string.
    #[staticmethod]
    pub fn version() -> &'static str {
        BINDINGS_VERSION
    }

    /// Returns the protocol version for host-side skew checks.
    #[staticmethod]
    pub fn protocol_version() -> u32 {
        PROTOCOL_VERSION
    }

    /// Aligns elements to one edge (or center) of their combined bounds.
    ///
    /// `mode` is one of `"left"`, `"right"`, `"top"`, `"bottom"`,
    /// `"centerH"`, `"centerV"`. Returns the batch-result dict.
    pub fn align(&mut self, py: Python<'_>, ids: Vec<String>, mode: String) -> PyResult<Py<PyAny>> {
        let ops = serde_json::json!([{ "op": "align", "ids": ids, "mode": mode }]).to_string();
        text_to_py(py, &ops).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Distributes elements with equal gaps along one axis (outer fixed).
    ///
    /// `axis` is `"horizontal"` or `"vertical"`. Returns the batch-result dict.
    pub fn distribute(
        &mut self,
        py: Python<'_>,
        ids: Vec<String>,
        axis: String,
    ) -> PyResult<Py<PyAny>> {
        let ops = serde_json::json!([{ "op": "distribute", "ids": ids, "axis": axis }]).to_string();
        text_to_py(py, &ops).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Runs a frame's auto-layout config as one undo step.
    pub fn apply_auto_layout(&mut self, py: Python<'_>, frame_id: String) -> PyResult<Py<PyAny>> {
        let ops = serde_json::json!([{ "op": "applyAutoLayout", "frameId": frame_id }]).to_string();
        text_to_py(py, &ops).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Proportionally rescales a multi-selection between combined bounds.
    ///
    /// `original`/`next` are `(min_x, min_y, max_x, max_y)` tuples.
    pub fn resize_selection(
        &mut self,
        py: Python<'_>,
        ids: Vec<String>,
        original: (f64, f64, f64, f64),
        next: (f64, f64, f64, f64),
    ) -> PyResult<Py<PyAny>> {
        let ops = serde_json::json!([{
            "op": "resizeSelection",
            "ids": ids,
            "original": {
                "minX": original.0,
                "minY": original.1,
                "maxX": original.2,
                "maxY": original.3,
            },
            "next": {
                "minX": next.0,
                "minY": next.1,
                "maxX": next.2,
                "maxY": next.3,
            },
        }])
        .to_string();
        text_to_py(py, &ops).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Starts a pen session for multi-click path creation.
    pub fn pen_begin(&mut self, py: Python<'_>) -> PyResult<Py<PyAny>> {
        text_to_py(py, r#"[{"op":"penBegin"}]"#).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Clicks a pen anchor at a scene point (`closed` = path closed).
    pub fn pen_click(&mut self, py: Python<'_>, x: f64, y: f64) -> PyResult<Py<PyAny>> {
        let ops = format!(r#"[{{"op":"penClick","x":{x},"y":{y}}}]"#);
        text_to_py(py, &ops).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Drags the last pen anchor's Bezier handles (`alt_break` splits symmetry).
    pub fn pen_drag_handle(
        &mut self,
        py: Python<'_>,
        x: f64,
        y: f64,
        alt_break: bool,
    ) -> PyResult<Py<PyAny>> {
        let ops = format!(r#"[{{"op":"penDragHandle","x":{x},"y":{y},"altBreak":{alt_break}}}]"#);
        text_to_py(py, &ops).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Commits the pen session as one history entry (`committed` + `id`).
    pub fn pen_commit(&mut self, py: Python<'_>) -> PyResult<Py<PyAny>> {
        text_to_py(py, r#"[{"op":"penCommit"}]"#).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Cancels the pen session with no document effect.
    pub fn pen_cancel(&mut self, py: Python<'_>) -> PyResult<Py<PyAny>> {
        text_to_py(py, r#"[{"op":"penCancel"}]"#).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Starts a crop session over an image element.
    pub fn crop_start(&mut self, py: Python<'_>, id: String) -> PyResult<Py<PyAny>> {
        let ops = format!(r#"[{{"op":"cropStart","id":"{id}"}}]"#);
        text_to_py(py, &ops).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Drags the crop session's handle to natural-pixel coordinates.
    pub fn crop_drag(
        &mut self,
        py: Python<'_>,
        handle: String,
        x: f64,
        y: f64,
    ) -> PyResult<Py<PyAny>> {
        let ops = format!(r#"[{{"op":"cropDrag","handle":"{handle}","x":{x},"y":{y}}}]"#);
        text_to_py(py, &ops).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Commits the crop session as one history entry.
    pub fn crop_commit(&mut self, py: Python<'_>) -> PyResult<Py<PyAny>> {
        text_to_py(py, r#"[{"op":"cropCommit"}]"#).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Cancels the crop session with no document effect.
    pub fn crop_cancel(&mut self, py: Python<'_>) -> PyResult<Py<PyAny>> {
        text_to_py(py, r#"[{"op":"cropCancel"}]"#).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Starts a path-edit session over a path element.
    pub fn path_edit_begin(&mut self, py: Python<'_>, id: String) -> PyResult<Py<PyAny>> {
        let ops = format!(r#"[{{"op":"pathEditBegin","id":"{id}"}}]"#);
        text_to_py(py, &ops).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Presses at a scene point during path editing (`kind` in
    /// `"anchor"`, `"handle"`, `"add"`, `"delete"`, `"none"`).
    pub fn path_edit_press(
        &mut self,
        py: Python<'_>,
        x: f64,
        y: f64,
        zoom: f64,
        alt: bool,
    ) -> PyResult<Py<PyAny>> {
        let ops =
            format!(r#"[{{"op":"pathEditPress","x":{x},"y":{y},"zoom":{zoom},"alt":{alt}}}]"#);
        text_to_py(py, &ops).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Drags the active path-edit target (`alt_break` splits symmetry).
    pub fn path_edit_drag(
        &mut self,
        py: Python<'_>,
        x: f64,
        y: f64,
        alt_break: bool,
    ) -> PyResult<Py<PyAny>> {
        let ops = format!(r#"[{{"op":"pathEditDrag","x":{x},"y":{y},"altBreak":{alt_break}}}]"#);
        text_to_py(py, &ops).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Releases the active path-edit drag.
    pub fn path_edit_release(&mut self, py: Python<'_>) -> PyResult<Py<PyAny>> {
        text_to_py(py, r#"[{"op":"pathEditRelease"}]"#).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Commits the path-edit session as one history entry.
    pub fn path_edit_commit(&mut self, py: Python<'_>) -> PyResult<Py<PyAny>> {
        text_to_py(py, r#"[{"op":"pathEditCommit"}]"#).and_then(|ops| self.apply_batch(py, ops))
    }

    /// Cancels the path-edit session with no document effect.
    pub fn path_edit_cancel(&mut self, py: Python<'_>) -> PyResult<Py<PyAny>> {
        text_to_py(py, r#"[{"op":"pathEditCancel"}]"#).and_then(|ops| self.apply_batch(py, ops))
    }
}

/// Parses a JSON-text string into a Python object.
fn text_to_py(py: Python<'_>, text: &str) -> PyResult<Py<PyAny>> {
    json_str_to_py(py, text)
}

impl Default for PyEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Python extension module (`nary._nary`).
///
/// Exposes [`PyEngine`], plus `__version__` and `PROTOCOL_VERSION` for
/// skew checks. The Pythonic wrapper in `python/nary/__init__.py`
/// re-exports these behind the `Engine` facade.
#[pymodule]
fn _nary(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyEngine>()?;
    m.add("__version__", BINDINGS_VERSION)?;
    m.add("PROTOCOL_VERSION", PROTOCOL_VERSION)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_round_trip_covers_scalars_and_containers() {
        Python::attach(|py| {
            let cases = [
                serde_json::json!(null),
                serde_json::json!(true),
                serde_json::json!(42),
                serde_json::json!(3.5),
                serde_json::json!("hello"),
                serde_json::json!([1, "two", false]),
                serde_json::json!({"a": 1, "b": [true, null]}),
            ];
            for value in cases {
                let obj = json_to_py(py, &value).expect("to py");
                let back = py_to_json_value(obj.bind(py)).expect("to json");
                assert_eq!(back, value);
            }
        });
    }

    #[test]
    fn engine_version_matches_protocol() {
        assert_eq!(PyEngine::version(), "0.1.0");
        assert_eq!(PyEngine::protocol_version(), 1);
    }
}
