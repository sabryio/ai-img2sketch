//! What the engine can do, and what it needs from the world to do it.
//!
//! - [`ports`] declares the boundary: the traits an adapter outside this crate implements.
//! - [`services`] holds the rules that are too small to be a use case and too important to be a
//!   detail — grid arithmetic, drawing order, dimension fitting.
//! - [`use_cases`] orchestrates services and ports into one thing a caller asks for.

pub mod ports;
pub mod services;
pub mod use_cases;
