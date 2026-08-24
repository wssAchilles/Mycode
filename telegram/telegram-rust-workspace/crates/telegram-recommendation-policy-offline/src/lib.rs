pub mod target_distribution;

// This diagnostic is deliberately test-only: it cannot become a serving or OPE
// entry point without a separately reviewed evidence contract.
#[cfg(test)]
mod policy_frontier;

// This fixture is deliberately private and test-only: it validates cursor
// assumptions without creating an online pagination or serving contract.
#[cfg(test)]
mod cursor_consistency;
