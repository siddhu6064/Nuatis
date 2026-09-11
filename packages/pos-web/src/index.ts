// Extensionless specifiers, unlike apps/api's Node-ESM code: this package is
// consumed by Next/Turbopack via transpilePackages, and Turbopack will not
// resolve a './session.js' specifier to session.ts when bundling middleware.
export {
  POS_COOKIE,
  readPosSession,
  serializePosSession,
  isExpired,
  type PosSession,
} from './session'
export { createPosProxy, type PosProxyOptions } from './proxy'
