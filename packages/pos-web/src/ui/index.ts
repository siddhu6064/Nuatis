// React entry point, kept OFF the package root on purpose.
//
// `@nuatis/pos-web` is imported by apps/api's Jest run (for the proxy and
// session tests), which has no React or MUI in scope. Pulling a component into
// the root barrel would drag both into that runtime for no reason, so anything
// that renders lives behind `@nuatis/pos-web/ui` instead.
export { PinPad, type PinPadProps } from './PinPad'
