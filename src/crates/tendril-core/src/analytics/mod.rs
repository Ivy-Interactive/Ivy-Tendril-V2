//! Pure calculators behind the dashboard's analytics, ported from the original app's
//! `CostForecastCalculator` and `RollingAverageCalculator`.
//!
//! Both take the series and an explicit `today`, own no clock and do no formatting, exactly as the
//! originals do — that is what makes them testable at a fixed date.

pub mod forecast;
pub mod rolling_average;

pub use forecast::*;
pub use rolling_average::*;
