export const calculateHeatState = (lastMessageAt) => {
  if (!lastMessageAt) {
    return { heat_state: "super_cold", heat_score: 0 };
  }

  const now = new Date();
  const last = new Date(lastMessageAt);
  const diffMs = now - last;
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours <= 4) {
    return { heat_state: "hot", heat_score: 90 };
  }

  if (diffHours <= 24) {
    return { heat_state: "warm", heat_score: 60 };
  }

  if (diffHours <= 72) {
    return { heat_state: "cold", heat_score: 30 };
  }

  return { heat_state: "super_cold", heat_score: 10 };
};
