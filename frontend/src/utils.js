export function sqrtPriceX96ToPrice(sqrtPrice) {
  const Q96 = 2n ** 96n;
  const sqrtPriceX96 = BigInt(sqrtPrice);

  const priceBase = Number(sqrtPriceX96) / Number(Q96);

  const priceRatioSquared = priceBase * priceBase;

  const rawPriceWithDecimals = priceRatioSquared * 10 ** 12;

  const finalPrice = rawPriceWithDecimals / 10**17; 

  return finalPrice;
}