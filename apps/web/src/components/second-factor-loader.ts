// The second factor's screens are their own chunk (SecondFactorStep): the
// sign-in page every visitor loads stays within its budget, and the chunk is
// fetched while the password is checked, so the step shows at once.
export const loadSecondFactor = () => import('./SecondFactor');

export function preloadSecondFactor(): void {
  // A failure surfaces when the step renders (the route's error page).
  loadSecondFactor().catch(() => undefined);
}
