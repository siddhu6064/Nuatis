import { createSessionRoute } from '@nuatis/pos-web'

// Shared with the register — see createSessionRoute for why this is not two
// copies. A manager PINs the kitchen screen in once and it runs the whole
// shift on the 12h cookie.
export const { POST, DELETE } = createSessionRoute()
