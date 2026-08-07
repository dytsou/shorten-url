export function hasPassedAccess(request) {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  return Boolean(jwt && email);
}
