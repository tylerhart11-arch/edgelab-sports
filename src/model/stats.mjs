export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const sigmoid = (value) => 1 / (1 + Math.exp(-value));

export function logit(probability) {
  const p = clamp(probability, 0.001, 0.999);
  return Math.log(p / (1 - p));
}

export function americanToProb(odds) {
  if (!Number.isFinite(odds) || odds === 0) return 0.5;
  return odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100);
}

export function probToAmerican(probability) {
  const p = clamp(probability, 0.01, 0.99);
  if (p >= 0.5) return Math.round((-100 * p) / (1 - p));
  return Math.round((100 * (1 - p)) / p);
}

export function removeVig(homeOdds, awayOdds) {
  const homeRaw = americanToProb(homeOdds);
  const awayRaw = americanToProb(awayOdds);
  const total = homeRaw + awayRaw || 1;
  return {
    home: homeRaw / total,
    away: awayRaw / total,
    hold: total - 1
  };
}

export function expectedValue(probability, americanOdds) {
  const p = clamp(probability, 0.001, 0.999);
  if (americanOdds > 0) return p * (americanOdds / 100) - (1 - p);
  return p * (100 / Math.abs(americanOdds)) - (1 - p);
}

export function kellyFraction(probability, americanOdds, fraction = 0.25) {
  const p = clamp(probability, 0.001, 0.999);
  const b = americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
  const fullKelly = (b * p - (1 - p)) / b;
  return clamp(fullKelly * fraction, 0, 0.08);
}

export function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * absX);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = sign * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX));
  return 0.5 * (1 + erf);
}

export function logLoss(predictions) {
  if (!predictions.length) return 0;
  const total = predictions.reduce((sum, row) => {
    const p = clamp(row.probability, 0.001, 0.999);
    return sum - (row.actual ? Math.log(p) : Math.log(1 - p));
  }, 0);
  return total / predictions.length;
}

export function brierScore(predictions) {
  if (!predictions.length) return 0;
  return predictions.reduce((sum, row) => sum + (row.probability - row.actual) ** 2, 0) / predictions.length;
}

export function accuracy(predictions) {
  if (!predictions.length) return 0;
  const wins = predictions.filter((row) => (row.probability >= 0.5 ? 1 : 0) === row.actual).length;
  return wins / predictions.length;
}

export function calibrationError(predictions, buckets = 10) {
  if (!predictions.length) return 0;
  const bucketRows = Array.from({ length: buckets }, () => []);
  predictions.forEach((row) => {
    const idx = clamp(Math.floor(row.probability * buckets), 0, buckets - 1);
    bucketRows[idx].push(row);
  });
  const weighted = bucketRows.reduce((sum, rows) => {
    if (!rows.length) return sum;
    const avgProb = rows.reduce((total, row) => total + row.probability, 0) / rows.length;
    const avgActual = rows.reduce((total, row) => total + row.actual, 0) / rows.length;
    return sum + Math.abs(avgProb - avgActual) * rows.length;
  }, 0);
  return weighted / predictions.length;
}

export function deterministicNoise(input, scale = 1) {
  const text = String(input);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unit = ((hash >>> 0) % 10000) / 10000;
  return (unit - 0.5) * 2 * scale;
}

export function formatPercent(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}
