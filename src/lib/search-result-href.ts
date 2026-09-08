export function searchResultHref(role: string, parentHref: string) {
  return role === "child" || role === "teen" ? "/dashboard" : parentHref;
}
