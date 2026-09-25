// Unreachable in normal operation: middleware.ts redirects "/" to /login or
// the signed-in user's portal before this ever renders.
export default function RootPage() {
  return null;
}
