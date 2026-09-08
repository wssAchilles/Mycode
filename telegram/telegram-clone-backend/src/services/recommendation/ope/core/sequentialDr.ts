import { OPE_V3_LOG_MAX, OPE_V3_LOG_MIN, scaleLogValueV3 } from '../v3/numerics';

export type SequentialDrTargetQValueV1 = Readonly<{
  probability: number;
  qValue: number;
}>;

export type SequentialDrSlotInputV1 = Readonly<{
  prefixLogWeight: number;
  behaviorProbability: number;
  targetProbability: number;
  reward: number;
  targetQValues?: readonly SequentialDrTargetQValueV1[];
  loggedQ?: number;
}>;

export type SequentialDrSlotResultV1 = Readonly<{
  status: 'evaluated';
  prefixLogWeight: number;
  logWeight: number;
  prefixWeight: number;
  weight: number;
  ipsContribution: number;
  drContribution?: number;
}> | Readonly<{
  status: 'not_evaluable';
  blocker: string;
}>;

export function evaluateSequentialDrSlotV1(
  input: SequentialDrSlotInputV1,
): SequentialDrSlotResultV1 {
  const logWeight = input.prefixLogWeight + Math.log(input.targetProbability)
    - Math.log(input.behaviorProbability);
  if (!Number.isFinite(input.prefixLogWeight) || !Number.isFinite(logWeight)) {
    return reject('ope_v3_numerical_error');
  }
  if (logWeight > OPE_V3_LOG_MAX) return reject('importance_weight_overflow');
  if (logWeight < OPE_V3_LOG_MIN) return reject('importance_weight_underflow');
  const prefixWeight = Math.exp(input.prefixLogWeight);
  const weight = Math.exp(logWeight);
  const scaledIps = scaleLogValueV3(logWeight, input.reward, 'importance');
  if (scaledIps.status === 'not_evaluable') return scaledIps;

  if (!input.targetQValues) {
    return {
      status: 'evaluated',
      prefixLogWeight: input.prefixLogWeight,
      logWeight,
      prefixWeight,
      weight,
      ipsContribution: scaledIps.value,
    };
  }
  if (input.loggedQ === undefined) return reject('ope_v3_qhat_invalid');

  const targetTerms: number[] = [];
  for (const entry of input.targetQValues) {
    const term = scaleLogValueV3(
      entry.probability === 0
        ? Number.NEGATIVE_INFINITY
        : input.prefixLogWeight + Math.log(entry.probability),
      entry.qValue,
      'importance',
    );
    if (term.status === 'not_evaluable') {
      return reject(`dr_target_${term.blocker}`);
    }
    targetTerms.push(term.value);
  }
  const targetTerm = targetTerms.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(targetTerm)) return reject('dr_target_sum_non_finite');
  const residual = scaleLogValueV3(
    logWeight,
    input.reward - input.loggedQ,
    'importance',
  );
  if (residual.status === 'not_evaluable') {
    return reject(`dr_residual_${residual.blocker}`);
  }
  const drContribution = targetTerm + residual.value;
  if (!Number.isFinite(drContribution)) return reject('dr_contribution_sum_non_finite');
  return {
    status: 'evaluated',
    prefixLogWeight: input.prefixLogWeight,
    logWeight,
    prefixWeight,
    weight,
    ipsContribution: scaledIps.value,
    drContribution,
  };
}

const reject = (blocker: string): SequentialDrSlotResultV1 => ({
  status: 'not_evaluable',
  blocker,
});
