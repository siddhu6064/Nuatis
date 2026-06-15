// Sanitize a user-supplied search term before interpolating it into a PostgREST
// .or() filter string. Strips the DSL structural metacharacters — comma, parens,
// double-quote, backslash — that would otherwise let a caller inject extra
// or()/filter clauses or break the query (FILT-1). Value-position characters
// (apostrophes, dots, hyphens, spaces, alphanumerics) are preserved so
// legitimate searches (O'Brien, john.doe, smith-jones) still match.
const DSL_METACHARS = /[,()"\\]/g

const MAX_LEN = 100

export function sanitizeSearchTerm(q: string): string {
  return q.replace(DSL_METACHARS, '').trim().slice(0, MAX_LEN)
}
