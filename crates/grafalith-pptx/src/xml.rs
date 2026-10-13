//! Hand-written XML builders for generated package parts.
//!
//! Exported parts are produced by this crate, so generation is plain string
//! building with correct escaping — no parser is needed on the way out.
//! Parsing (the import direction) uses `quick-xml` instead; hand-rolled
//! parsers are a classic source of imprese conformance bugs.

/// Escapes text and attribute content (`&`, `<`, `>`, quotes).
pub fn escape(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    for char in content.chars() {
        match char {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(char),
        }
    }
    out
}

/// One XML child: a nested element or escaped text.
pub enum XmlNode {
    /// Nested element.
    Element(XmlElement),
    /// Text content (escaped on render).
    Text(String),
}

/// An XML element with attributes and children.
pub struct XmlElement {
    name: String,
    attributes: Vec<(String, String)>,
    children: Vec<XmlNode>,
}

impl XmlElement {
    /// Creates an element with the given qualified name (e.g. `"p:sld"`).
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            attributes: Vec::new(),
            children: Vec::new(),
        }
    }

    /// Adds an attribute (the value is escaped on render).
    pub fn attribute(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.attributes.push((name.into(), value.into()));
        self
    }

    /// Appends a child node.
    pub fn child(mut self, node: XmlNode) -> Self {
        self.children.push(node);
        self
    }

    /// Appends escaped text.
    pub fn text(self, content: impl Into<String>) -> Self {
        self.child(XmlNode::Text(content.into()))
    }

    /// Renders the element (empty elements self-close).
    pub fn render(&self) -> String {
        let mut out = String::new();
        out.push('<');
        out.push_str(&self.name);
        for (name, value) in &self.attributes {
            out.push(' ');
            out.push_str(name);
            out.push_str("=\"");
            out.push_str(&escape(value));
            out.push('"');
        }
        if self.children.is_empty() {
            out.push_str("/>");
            return out;
        }
        out.push('>');
        for child in &self.children {
            match child {
                XmlNode::Element(element) => out.push_str(&element.render()),
                XmlNode::Text(text) => out.push_str(&escape(text)),
            }
        }
        out.push_str("</");
        out.push_str(&self.name);
        out.push('>');
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escaping_covers_markup_characters() {
        assert_eq!(escape("a&b<c>d\"e'f"), "a&amp;b&lt;c&gt;d&quot;e&apos;f");
        assert_eq!(escape("plain"), "plain");
    }

    #[test]
    fn elements_render_with_attributes_and_nesting() {
        let document = XmlElement::new("p:sld")
            .attribute(
                "xmlns:p",
                "http://schemas.openxmlformats.org/presentationml/2006/main",
            )
            .child(XmlNode::Element(
                XmlElement::new("p:cSld").attribute("name", "blank & <layout>"),
            ));
        assert_eq!(
            document.render(),
            "<p:sld xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">\
             <p:cSld name=\"blank &amp; &lt;layout&gt;\"/></p:sld>"
        );
    }
}
