//! Queries actual renderer layout during explicit QA runs, without OS input automation.
use iced::{
    Rectangle,
    advanced::widget::{Id, Operation, operation::Outcome},
};
#[derive(Debug, Clone, serde::Serialize)]
pub struct Bounds {
    pub label: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}
#[derive(Default)]
pub struct Collect(pub Vec<Bounds>);
impl Operation<Vec<Bounds>> for Collect {
    fn traverse(&mut self, operate: &mut dyn FnMut(&mut dyn Operation<Vec<Bounds>>)) {
        operate(self)
    }
    fn container(&mut self, id: Option<&Id>, bounds: Rectangle) {
        if let Some(id) = id {
            self.0.push(Bounds {
                label: format!("{id:?}"),
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
            });
        }
    }
    fn finish(&self) -> Outcome<Vec<Bounds>> {
        Outcome::Some(self.0.clone())
    }
}
pub fn failures(nodes: &[Bounds]) -> usize {
    nodes
        .iter()
        .filter(|node| {
            let expected = if node.label.contains("caption-") {
                Some((46., 36.))
            } else if node.label.contains("nav-item-") {
                Some((44., 44.))
            } else {
                node.label
                    .split("avatar-")
                    .nth(1)
                    .and_then(|s| {
                        s.chars()
                            .take_while(char::is_ascii_digit)
                            .collect::<String>()
                            .parse::<f32>()
                            .ok()
                    })
                    .map(|size| (size, size))
            };
            expected.is_some_and(|(width, height)| {
                (node.width - width).abs() > 0.5 || (node.height - height).abs() > 0.5
            })
        })
        .count()
}
