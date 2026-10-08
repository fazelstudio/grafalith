//! Chrome design tokens (not element colors).
//!
//! TS sources: `packages/core/src/theme/types.ts`,
//! `default-theme.ts`, `theme-provider.ts` (one-time deep-merge
//! `resolveTheme` with copy-not-reference semantics, pinned by
//! `theme-provider.test.ts`).
//!
//! Pure token types + pure merge. Element colors stay on elements
//! (`element.rs`); the theme covers selection chrome, handles, and fonts.
//! Customization passes config explicitly (no global mutation), so multiple
//! instances can carry different themes (ARCHITECTURE §9.2). Rust ownership
//! makes the copy-not-reference rule structural: every resolve clones,
//! including the `availableFamilies` list that TS shares by reference on
//! the no-override path.

/// Chrome colors for selection outlines, handles, and canvas furniture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThemeColors {
    /// Canvas background color.
    pub canvas_background: String,
    /// Selection outline color.
    pub selection_outline: String,
    /// Resize handle fill color.
    pub handle_fill: String,
    /// Resize handle stroke color.
    pub handle_stroke: String,
    /// Rubber-band selection fill (usually semi-transparent).
    pub rubber_band_fill: String,
    /// Rubber-band selection border color.
    pub rubber_band_stroke: String,
    /// Background grid line color.
    pub grid_line: String,
    /// Overlay color for area outside a bounded canvas.
    pub canvas_out_of_bounds_overlay: String,
    /// Border color for the bounded canvas boundary.
    pub canvas_bounds_border: String,
}

/// Font tokens for engine chrome and new text elements.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThemeFonts {
    /// Default font family for new text elements.
    pub family: String,
    /// Families offered by the font picker.
    pub available_families: Vec<String>,
}

/// Size tokens for selection chrome and hit tolerances.
#[derive(Debug, Clone, PartialEq)]
pub struct ThemeSizes {
    /// Resize handle size in px.
    pub handle_size: f64,
    /// Rotate handle circle radius in px.
    pub rotate_handle_radius: f64,
    /// Distance from selection-box top edge to the rotate handle in px.
    pub rotate_handle_offset: f64,
    /// Selection outline stroke width in px.
    pub selection_outline_width: f64,
    /// Rotate handle connector line width in px.
    pub rotate_handle_line_width: f64,
    /// Resize handle stroke width in px.
    pub handle_line_width: f64,
    /// Hit-test tolerance in px for bounding-box edge clicks.
    pub bounding_box_hit_threshold: f64,
}

/// Corner radii for engine chrome.
#[derive(Debug, Clone, PartialEq)]
pub struct ThemeBorderRadius {
    /// Resize handle radius.
    pub handle: f64,
    /// UI panel radius.
    pub panel: f64,
}

/// Full resolved theme (engine chrome only — never element colors).
#[derive(Debug, Clone, PartialEq)]
pub struct OpenNaryTheme {
    /// Chrome colors.
    pub colors: ThemeColors,
    /// Font tokens.
    pub fonts: ThemeFonts,
    /// Size tokens.
    pub sizes: ThemeSizes,
    /// Corner radii.
    pub border_radius: ThemeBorderRadius,
}

/// Partial color overrides; every field optional.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ThemeColorsOverride {
    /// Canvas background color.
    pub canvas_background: Option<String>,
    /// Selection outline color.
    pub selection_outline: Option<String>,
    /// Resize handle fill color.
    pub handle_fill: Option<String>,
    /// Resize handle stroke color.
    pub handle_stroke: Option<String>,
    /// Rubber-band selection fill.
    pub rubber_band_fill: Option<String>,
    /// Rubber-band selection border color.
    pub rubber_band_stroke: Option<String>,
    /// Background grid line color.
    pub grid_line: Option<String>,
    /// Overlay color for area outside a bounded canvas.
    pub canvas_out_of_bounds_overlay: Option<String>,
    /// Border color for the bounded canvas boundary.
    pub canvas_bounds_border: Option<String>,
}

/// Partial font overrides.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ThemeFontsOverride {
    /// Default font family.
    pub family: Option<String>,
    /// Available families.
    pub available_families: Option<Vec<String>>,
}

/// Partial size overrides.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ThemeSizesOverride {
    /// Resize handle size in px.
    pub handle_size: Option<f64>,
    /// Rotate handle circle radius in px.
    pub rotate_handle_radius: Option<f64>,
    /// Distance from selection-box top edge to the rotate handle.
    pub rotate_handle_offset: Option<f64>,
    /// Selection outline stroke width in px.
    pub selection_outline_width: Option<f64>,
    /// Rotate handle connector line width in px.
    pub rotate_handle_line_width: Option<f64>,
    /// Resize handle stroke width in px.
    pub handle_line_width: Option<f64>,
    /// Hit-test tolerance in px for bounding-box edge clicks.
    pub bounding_box_hit_threshold: Option<f64>,
}

/// Partial corner-radius overrides.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ThemeBorderRadiusOverride {
    /// Resize handle radius.
    pub handle: Option<f64>,
    /// UI panel radius.
    pub panel: Option<f64>,
}

/// Developer-supplied partial theme (TS `ThemeOverride`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ThemeOverride {
    /// Color overrides.
    pub colors: Option<ThemeColorsOverride>,
    /// Font overrides.
    pub fonts: Option<ThemeFontsOverride>,
    /// Size overrides.
    pub sizes: Option<ThemeSizesOverride>,
    /// Corner-radius overrides.
    pub border_radius: Option<ThemeBorderRadiusOverride>,
}

/// Engine default theme. Values match the TS `defaultTheme` exactly
/// (zero visual regression when no override is provided).
pub fn default_theme() -> OpenNaryTheme {
    OpenNaryTheme {
        colors: ThemeColors {
            canvas_background: "#ffffff".to_string(),
            selection_outline: "#4a90d9".to_string(),
            handle_fill: "#ffffff".to_string(),
            handle_stroke: "#4a90d9".to_string(),
            rubber_band_fill: "rgba(74, 144, 217, 0.15)".to_string(),
            rubber_band_stroke: "rgba(74, 144, 217, 0.8)".to_string(),
            grid_line: "#e0e0e0".to_string(),
            canvas_out_of_bounds_overlay: "rgba(0, 0, 0, 0.08)".to_string(),
            canvas_bounds_border: "rgba(0, 0, 0, 0.2)".to_string(),
        },
        fonts: ThemeFonts {
            family: "Virgil, Hand-drawn, sans-serif".to_string(),
            available_families: vec![
                "Virgil".to_string(),
                "Hand-drawn".to_string(),
                "sans-serif".to_string(),
            ],
        },
        sizes: ThemeSizes {
            handle_size: 8.0,
            rotate_handle_radius: 6.0,
            rotate_handle_offset: 24.0,
            selection_outline_width: 1.5,
            rotate_handle_line_width: 1.0,
            handle_line_width: 1.5,
            bounding_box_hit_threshold: 4.0,
        },
        border_radius: ThemeBorderRadius {
            handle: 0.0,
            panel: 8.0,
        },
    }
}

/// Deep-merges a partial override onto the defaults (TS `resolveTheme`).
///
/// Called once at engine initialization, never per-frame (ARCHITECTURE
/// §9.6). The result is fully owned: mutating it can never affect the
/// defaults or another instance's theme.
pub fn resolve_theme(override_value: Option<&ThemeOverride>) -> OpenNaryTheme {
    let mut theme = default_theme();
    if let Some(override_value) = override_value {
        if let Some(colors) = &override_value.colors {
            let target = &mut theme.colors;
            if let Some(value) = &colors.canvas_background {
                target.canvas_background = value.clone();
            }
            if let Some(value) = &colors.selection_outline {
                target.selection_outline = value.clone();
            }
            if let Some(value) = &colors.handle_fill {
                target.handle_fill = value.clone();
            }
            if let Some(value) = &colors.handle_stroke {
                target.handle_stroke = value.clone();
            }
            if let Some(value) = &colors.rubber_band_fill {
                target.rubber_band_fill = value.clone();
            }
            if let Some(value) = &colors.rubber_band_stroke {
                target.rubber_band_stroke = value.clone();
            }
            if let Some(value) = &colors.grid_line {
                target.grid_line = value.clone();
            }
            if let Some(value) = &colors.canvas_out_of_bounds_overlay {
                target.canvas_out_of_bounds_overlay = value.clone();
            }
            if let Some(value) = &colors.canvas_bounds_border {
                target.canvas_bounds_border = value.clone();
            }
        }
        if let Some(fonts) = &override_value.fonts {
            if let Some(value) = &fonts.family {
                theme.fonts.family = value.clone();
            }
            if let Some(value) = &fonts.available_families {
                theme.fonts.available_families = value.clone();
            }
        }
        if let Some(sizes) = &override_value.sizes {
            let target = &mut theme.sizes;
            if let Some(value) = sizes.handle_size {
                target.handle_size = value;
            }
            if let Some(value) = sizes.rotate_handle_radius {
                target.rotate_handle_radius = value;
            }
            if let Some(value) = sizes.rotate_handle_offset {
                target.rotate_handle_offset = value;
            }
            if let Some(value) = sizes.selection_outline_width {
                target.selection_outline_width = value;
            }
            if let Some(value) = sizes.rotate_handle_line_width {
                target.rotate_handle_line_width = value;
            }
            if let Some(value) = sizes.handle_line_width {
                target.handle_line_width = value;
            }
            if let Some(value) = sizes.bounding_box_hit_threshold {
                target.bounding_box_hit_threshold = value;
            }
        }
        if let Some(border_radius) = &override_value.border_radius {
            if let Some(value) = border_radius.handle {
                theme.border_radius.handle = value;
            }
            if let Some(value) = border_radius.panel {
                theme.border_radius.panel = value;
            }
        }
    }
    theme
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_defaults_without_override() {
        assert_eq!(resolve_theme(None), default_theme());
        assert_eq!(
            resolve_theme(Some(&ThemeOverride::default())),
            default_theme()
        );
    }

    #[test]
    fn resolved_theme_is_fully_owned() {
        let mut theme = resolve_theme(None);
        theme.colors.selection_outline = "#ff0000".to_string();
        theme
            .fonts
            .available_families
            .push("Comic Sans".to_string());
        // Defaults are untouched: no aliasing, stronger than the TS
        // reference path that shares `availableFamilies` by reference.
        assert_eq!(default_theme().colors.selection_outline, "#4a90d9");
        assert_eq!(default_theme().fonts.available_families.len(), 3);
    }

    #[test]
    fn single_overrides_preserve_siblings() {
        let theme = resolve_theme(Some(&ThemeOverride {
            colors: Some(ThemeColorsOverride {
                selection_outline: Some("#ff0000".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        }));
        assert_eq!(theme.colors.selection_outline, "#ff0000");
        assert_eq!(
            theme.colors.canvas_background,
            default_theme().colors.canvas_background
        );

        let theme = resolve_theme(Some(&ThemeOverride {
            sizes: Some(ThemeSizesOverride {
                handle_size: Some(12.0),
                ..Default::default()
            }),
            ..Default::default()
        }));
        assert_eq!(theme.sizes.handle_size, 12.0);
        assert_eq!(
            theme.sizes.rotate_handle_radius,
            default_theme().sizes.rotate_handle_radius
        );
    }

    #[test]
    fn fonts_and_radius_overrides_apply() {
        let theme = resolve_theme(Some(&ThemeOverride {
            fonts: Some(ThemeFontsOverride {
                family: Some("Arial, sans-serif".to_string()),
                available_families: Some(vec!["Arial".to_string(), "Helvetica".to_string()]),
            }),
            border_radius: Some(ThemeBorderRadiusOverride {
                handle: Some(4.0),
                panel: Some(12.0),
            }),
            ..Default::default()
        }));
        assert_eq!(theme.fonts.family, "Arial, sans-serif");
        assert_eq!(theme.fonts.available_families, vec!["Arial", "Helvetica"]);
        assert_eq!(theme.border_radius.handle, 4.0);
        assert_eq!(theme.border_radius.panel, 12.0);
    }

    #[test]
    fn partial_nested_override_preserves_sibling_defaults() {
        let theme = resolve_theme(Some(&ThemeOverride {
            colors: Some(ThemeColorsOverride {
                canvas_background: Some("#000000".to_string()),
                ..Default::default()
            }),
            sizes: Some(ThemeSizesOverride {
                handle_size: Some(16.0),
                ..Default::default()
            }),
            ..Default::default()
        }));
        assert_eq!(theme.colors.canvas_background, "#000000");
        assert_eq!(
            theme.colors.selection_outline,
            default_theme().colors.selection_outline
        );
        assert_eq!(theme.sizes.handle_size, 16.0);
        assert_eq!(theme.fonts, default_theme().fonts);
        assert_eq!(theme.border_radius, default_theme().border_radius);
    }
}
