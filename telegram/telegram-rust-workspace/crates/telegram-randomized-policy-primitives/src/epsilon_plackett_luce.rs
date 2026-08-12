pub const PROBABILITY_MASS_TOLERANCE: f64 = 1e-12;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EpsilonPlackettLuceError {
    EmptySupport,
    InvalidEpsilon,
    InvalidTemperature,
    NonFiniteLogit,
    NonFiniteArithmetic,
    ProbabilityUnderflow,
    ProbabilityMassMismatch,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ProbabilityMassDiagnostics {
    pub plackett_luce_mass: f64,
    pub mixed_mass: f64,
    pub plackett_luce_mass_error: f64,
    pub mixed_mass_error: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FullDistribution {
    pub probabilities: Vec<(f64, f64)>,
    pub diagnostics: ProbabilityMassDiagnostics,
}

pub fn compute_full_distribution(
    logits_in_deterministic_order: &[f64],
    epsilon: f64,
    temperature: f64,
) -> Result<FullDistribution, EpsilonPlackettLuceError> {
    if logits_in_deterministic_order.is_empty() {
        return Err(EpsilonPlackettLuceError::EmptySupport);
    }
    if !epsilon.is_finite() || epsilon <= 0.0 || epsilon > 1.0 {
        return Err(EpsilonPlackettLuceError::InvalidEpsilon);
    }
    if !temperature.is_finite() || temperature <= 0.0 {
        return Err(EpsilonPlackettLuceError::InvalidTemperature);
    }
    if logits_in_deterministic_order
        .iter()
        .any(|logit| !logit.is_finite())
    {
        return Err(EpsilonPlackettLuceError::NonFiniteLogit);
    }

    let max_logit = logits_in_deterministic_order
        .iter()
        .copied()
        .reduce(f64::max)
        .expect("non-empty support was checked");
    let mut weights = Vec::with_capacity(logits_in_deterministic_order.len());
    for logit in logits_in_deterministic_order {
        let scaled = (*logit - max_logit) / temperature;
        if !scaled.is_finite() {
            return Err(EpsilonPlackettLuceError::NonFiniteArithmetic);
        }
        let weight = scaled.exp();
        if weight == 0.0 {
            return Err(EpsilonPlackettLuceError::ProbabilityUnderflow);
        }
        if !weight.is_finite() {
            return Err(EpsilonPlackettLuceError::NonFiniteArithmetic);
        }
        weights.push(weight);
    }

    let denominator = weights.iter().sum::<f64>();
    if !denominator.is_finite() || denominator <= 0.0 {
        return Err(EpsilonPlackettLuceError::NonFiniteArithmetic);
    }
    let probabilities = weights
        .into_iter()
        .enumerate()
        .map(|(index, weight)| {
            let plackett_luce = weight / denominator;
            let mixed = (1.0 - epsilon) * f64::from(index == 0) + epsilon * plackett_luce;
            if !plackett_luce.is_finite() || !mixed.is_finite() {
                return Err(EpsilonPlackettLuceError::NonFiniteArithmetic);
            }
            if plackett_luce <= 0.0 || mixed <= 0.0 {
                return Err(EpsilonPlackettLuceError::ProbabilityUnderflow);
            }
            Ok((plackett_luce, mixed))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let plackett_luce_mass = probabilities.iter().map(|value| value.0).sum::<f64>();
    let mixed_mass = probabilities.iter().map(|value| value.1).sum::<f64>();
    if !plackett_luce_mass.is_finite() || !mixed_mass.is_finite() {
        return Err(EpsilonPlackettLuceError::NonFiniteArithmetic);
    }
    let plackett_luce_mass_error = (plackett_luce_mass - 1.0).abs();
    let mixed_mass_error = (mixed_mass - 1.0).abs();
    if plackett_luce_mass_error > PROBABILITY_MASS_TOLERANCE
        || mixed_mass_error > PROBABILITY_MASS_TOLERANCE
    {
        return Err(EpsilonPlackettLuceError::ProbabilityMassMismatch);
    }

    Ok(FullDistribution {
        probabilities,
        diagnostics: ProbabilityMassDiagnostics {
            plackett_luce_mass,
            mixed_mass,
            plackett_luce_mass_error,
            mixed_mass_error,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{EpsilonPlackettLuceError, PROBABILITY_MASS_TOLERANCE, compute_full_distribution};

    #[test]
    fn plus_mixture_preserves_both_probability_masses() {
        let output = compute_full_distribution(&[0.0, 2.0, 1.0], 0.2, 1.0).unwrap();
        let pl_sum = output
            .probabilities
            .iter()
            .map(|value| value.0)
            .sum::<f64>();
        let mixed_sum = output
            .probabilities
            .iter()
            .map(|value| value.1)
            .sum::<f64>();

        assert!((pl_sum - 1.0).abs() <= PROBABILITY_MASS_TOLERANCE);
        assert!((mixed_sum - 1.0).abs() <= PROBABILITY_MASS_TOLERANCE);
        assert_eq!(
            output.probabilities[0].1,
            0.8 + 0.2 * output.probabilities[0].0
        );
        assert_eq!(output.probabilities[1].1, 0.2 * output.probabilities[1].0);
    }

    #[test]
    fn epsilon_one_and_common_offset_preserve_plackett_luce() {
        let base = compute_full_distribution(&[0.0, 2.0, 1.0], 1.0, 1.0).unwrap();
        let shifted =
            compute_full_distribution(&[1.0e12, 1.0e12 + 2.0, 1.0e12 + 1.0], 1.0, 1.0).unwrap();

        assert_eq!(base, shifted);
        assert_eq!(
            base.probabilities.iter().map(|p| p.0).collect::<Vec<_>>(),
            base.probabilities.iter().map(|p| p.1).collect::<Vec<_>>()
        );
    }

    #[test]
    fn invalid_or_underflowing_inputs_fail_closed() {
        assert_eq!(
            compute_full_distribution(&[], 0.2, 1.0),
            Err(EpsilonPlackettLuceError::EmptySupport)
        );
        assert_eq!(
            compute_full_distribution(&[0.0], 0.0, 1.0),
            Err(EpsilonPlackettLuceError::InvalidEpsilon)
        );
        assert_eq!(
            compute_full_distribution(&[1000.0, 0.0], 1.0, 1.0),
            Err(EpsilonPlackettLuceError::ProbabilityUnderflow)
        );
        assert_eq!(
            compute_full_distribution(&[0.0, 0.0], f64::from_bits(1), 1.0),
            Err(EpsilonPlackettLuceError::ProbabilityUnderflow)
        );
    }
}
