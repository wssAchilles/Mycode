export const OFFLINE_TRAINER_VERSION = 'cross_fitted_full_batch_logistic_v1' as const;

export type LogisticTrainingRowV1 = {
  rowId: string;
  features: Record<string, number>;
  label: number;
};

export type LogisticTrainingConfigV1 = {
  epochs: number;
  learningRate: number;
  l2Lambda: number;
};

export type LogisticModelV1 = {
  intercept: number;
  coefficients: Record<string, number>;
};

const compareText = (left: string, right: string) => Buffer.compare(
  Buffer.from(left),
  Buffer.from(right),
);

const positiveZero = (value: number): number => value === 0 ? 0 : value;

export function stableSigmoid(value: number): number {
  if (!Number.isFinite(value)) throw new Error('non_finite_training_value');
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function validateConfig(config: LogisticTrainingConfigV1): void {
  if (
    !Number.isInteger(config.epochs)
    || config.epochs < 1
    || config.epochs > 1_000
    || !Number.isFinite(config.learningRate)
    || config.learningRate <= 0
    || !Number.isFinite(config.l2Lambda)
    || config.l2Lambda < 0
  ) {
    throw new Error('invalid_training_config');
  }
}

export function trainFullBatchLogisticV1(
  inputRows: readonly LogisticTrainingRowV1[],
  config: LogisticTrainingConfigV1,
): LogisticModelV1 {
  validateConfig(config);
  if (inputRows.length === 0) throw new Error('empty_training_rows');
  const rows = [...inputRows].sort((left, right) => compareText(left.rowId, right.rowId));
  const featureKeys = [...new Set(rows.flatMap((row) => Object.keys(row.features)))]
    .filter((key) => key !== 'bias')
    .sort(compareText);
  for (const row of rows) {
    if (!Number.isFinite(row.label)) throw new Error('non_finite_training_value');
    if (row.label < 0 || row.label > 1) throw new Error('invalid_soft_label');
    for (const value of Object.values(row.features)) {
      if (!Number.isFinite(value)) throw new Error('non_finite_training_value');
    }
  }

  let intercept = 0;
  const coefficients = Object.fromEntries(featureKeys.map((key) => [key, 0]));
  for (let epoch = 0; epoch < config.epochs; epoch += 1) {
    let interceptGradient = 0;
    const gradients = Object.fromEntries(featureKeys.map((key) => [key, 0]));
    for (const row of rows) {
      let logit = intercept;
      for (const key of featureKeys) logit += coefficients[key] * (row.features[key] ?? 0);
      const residual = stableSigmoid(logit) - row.label;
      interceptGradient += residual;
      for (const key of featureKeys) gradients[key] += residual * (row.features[key] ?? 0);
    }
    intercept = positiveZero(intercept - config.learningRate * (interceptGradient / rows.length));
    for (const key of featureKeys) {
      const gradient = gradients[key] / rows.length + config.l2Lambda * coefficients[key];
      coefficients[key] = positiveZero(coefficients[key] - config.learningRate * gradient);
      if (!Number.isFinite(coefficients[key])) throw new Error('non_finite_training_value');
    }
    if (!Number.isFinite(intercept)) throw new Error('non_finite_training_value');
  }
  return { intercept, coefficients };
}

export function predictLogisticV1(
  model: LogisticModelV1,
  features: Readonly<Record<string, number>>,
): number {
  if (!Number.isFinite(model.intercept)) throw new Error('non_finite_training_value');
  let logit = model.intercept;
  for (const key of Object.keys(model.coefficients).sort(compareText)) {
    const coefficient = model.coefficients[key];
    const feature = features[key] ?? 0;
    if (!Number.isFinite(coefficient) || !Number.isFinite(feature)) {
      throw new Error('non_finite_training_value');
    }
    logit += coefficient * feature;
  }
  return stableSigmoid(logit);
}
