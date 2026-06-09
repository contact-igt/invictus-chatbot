/**
 * Smooth exponential decay for lead recency scoring.
 *
 * Replaces the old 4-step cliff (100→70→30→15) with a smooth curve:
 *   heat_score = 100 × e^(-λ × hours)
 *
 * @param {Date|string|null} lastMessageAt - When the last user message was sent
 * @param {number} decayLambda - Decay rate constant. Higher = faster decay.
 *   - hospital/clinic:  0.018 (half-life ~38h)
 *   - education/academy: 0.010 (half-life ~69h)
 *   - law:              0.008 (half-life ~87h)
 *   - organization:     0.012 (half-life ~58h)
 *   - default:          0.015 (half-life ~46h)
 * @returns {{ heat_state: string, heat_score: number }}
 */
export const calculateHeatState = (lastMessageAt, decayLambda = 0.015) => {
  if (!lastMessageAt) {
    return { heat_state: "supercold", heat_score: 10 };
  }

  const now = new Date();
  const last = new Date(lastMessageAt);

  // Guard: invalid date → treat as supercold
  if (isNaN(last.getTime())) {
    return { heat_state: "supercold", heat_score: 10 };
  }

  const diffMs = now - last;
  // Guard: future timestamps (clock drift / timezone bugs) → clamp to 0
  const diffHours = Math.max(0, diffMs / (1000 * 60 * 60));

  // Smooth exponential decay: score = 100 × e^(-λ × hours)
  // Floor at 5 to avoid zero-score leads that still exist
  const heat_score = Math.round(
    Math.max(5, Math.min(100, 100 * Math.exp(-decayLambda * diffHours)))
  );

  // Labels for backward compatibility (UI badges, filters, DB enum)
  let heat_state;
  if (diffHours <= 6) heat_state = "hot";
  else if (diffHours <= 24) heat_state = "warm";
  else if (diffHours <= 72) heat_state = "cold";
  else heat_state = "supercold";

  return { heat_state, heat_score };
};
