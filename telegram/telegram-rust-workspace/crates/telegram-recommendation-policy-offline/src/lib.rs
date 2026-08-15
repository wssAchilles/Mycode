pub mod target_distribution;

// This diagnostic is deliberately test-only: it cannot become a serving or OPE
// entry point without a separately reviewed evidence contract.
#[cfg(test)]
mod policy_frontier;
