import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

/**
 * Placeholder. The live ticket board replaces this in Task 8 — reaching this
 * page at all proves the proxy let a signed-in screen through, which is what
 * this task is verifying.
 */
export default function BoardPage() {
  return (
    <Box component="main" sx={{ p: 4 }}>
      <Typography variant="h4">Kitchen</Typography>
      <Typography color="text.secondary">No tickets yet.</Typography>
    </Box>
  )
}
