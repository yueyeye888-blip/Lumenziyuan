const fullRate = 10000;
const maximumRawAmount = BigInt(Number.MAX_SAFE_INTEGER);

export function validDiscount(value) {
  return Number.isInteger(value) && value > 0 && value <= fullRate;
}

function roundedPrice(raw, rate) {
  if (raw === 0n) return 0;
  const rounded = (raw * BigInt(rate) + 5000n) / 10000n;
  if (rounded > maximumRawAmount) throw new Error('价格超出支持范围。');
  return Math.max(1, Number(rounded));
}

function customerRate(user) {
  return validDiscount(user?.discountBps) ? user.discountBps : fullRate;
}

export function discountedPrice(retailRaw, user) {
  if (!Number.isSafeInteger(retailRaw) || retailRaw < 0) throw new Error('标价无效。');
  return roundedPrice(BigInt(retailRaw), customerRate(user));
}

export function esimPrice(supplierRaw, user, atCost = false) {
  if (!Number.isSafeInteger(supplierRaw) || supplierRaw < 0) return null;
  try { return atCost ? supplierRaw : roundedPrice(BigInt(supplierRaw) * 2n, customerRate(user)); }
  catch { return null; }
}
