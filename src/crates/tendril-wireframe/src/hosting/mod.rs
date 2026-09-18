//! Serving a wireframe: the document, the payload and the live-reload channel.
//!
//! Two hosts sit on this. The standalone one is what `tendril wireframe serve` runs, on a free port
//! with one site. Tendril's own is what serves `/__wireframes/{plan}/{name}/` from the daemon's
//! origin, so a preview works over HTTPS and through a share link.

pub mod index_html;

pub use index_html::WireframeSite;
