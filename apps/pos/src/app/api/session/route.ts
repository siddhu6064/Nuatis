import { createSessionRoute } from '@nuatis/pos-web'

// Shared with the KDS — see createSessionRoute for why this is not two copies.
export const { POST, DELETE } = createSessionRoute()
