pub mod candidate_hydrators;
pub mod filters;
pub mod query_hydrators;
pub mod scorers;
pub mod selectors;
pub mod side_effects;

pub fn to_component_names(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_string()).collect()
}
