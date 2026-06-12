import type { AlertDecision, PriceStatus } from "./types.js";

export function getPriceStatus(price: number, thresholdPrice: number): PriceStatus {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`price must be a positive finite number: ${price}`);
  }
  if (!Number.isFinite(thresholdPrice) || thresholdPrice <= 0) {
    throw new Error(`thresholdPrice must be a positive finite number: ${thresholdPrice}`);
  }

  return price < thresholdPrice ? "below" : "above";
}

export function decideAlert(
  previousStatus: PriceStatus | null,
  price: number,
  thresholdPrice: number,
): AlertDecision {
  const nextStatus = getPriceStatus(price, thresholdPrice);

  if (previousStatus === null || previousStatus === nextStatus) {
    return { nextStatus, alertType: null };
  }

  if (previousStatus !== "below" && nextStatus === "below") {
    return { nextStatus, alertType: "breach" };
  }

  if (previousStatus === "below" && nextStatus === "above") {
    return { nextStatus, alertType: "recovery" };
  }

  return { nextStatus, alertType: null };
}
