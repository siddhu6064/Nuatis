import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import { PinPad } from '@nuatis/pos-web/ui'

/**
 * Tenant and location come from env for now.
 *
 * TODO: a real deployment pairs the device once and stores this server-side,
 * rather than baking it into the bundle — a register should not need a rebuild
 * to move to another location.
 */
const TENANT_ID = process.env.NEXT_PUBLIC_POS_TENANT_ID ?? ''
const LOCATION_ID = process.env.NEXT_PUBLIC_POS_LOCATION_ID ?? ''

export default function SignInPage() {
  const configured = TENANT_ID !== '' && LOCATION_ID !== ''

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        p: 3,
      }}
    >
      <Typography variant="h4">Nuatis Register</Typography>

      {configured ? (
        <PinPad tenantId={TENANT_ID} locationId={LOCATION_ID} />
      ) : (
        <Alert severity="warning" sx={{ maxWidth: 480 }}>
          This register is not paired yet. Set <code>NEXT_PUBLIC_POS_TENANT_ID</code> and{' '}
          <code>NEXT_PUBLIC_POS_LOCATION_ID</code>, then restart the app.
        </Alert>
      )}
    </Box>
  )
}
