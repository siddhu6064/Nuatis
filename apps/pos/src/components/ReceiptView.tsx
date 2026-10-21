'use client'

import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import Alert from '@mui/material/Alert'
import GlobalStyles from '@mui/material/GlobalStyles'
import { toDollars } from '@nuatis/pos-core'
import { formatReceiptText, type Receipt } from '@/lib/receipt'

/** The id the print stylesheet keys on. */
const PRINT_ID = 'pos-receipt-print'

const TENDER_LABELS: Record<Receipt['tenders'][number]['method'], string> = {
  cash: 'Cash',
  card: 'Card',
  gift_card: 'Gift card',
}

/**
 * The customer's receipt: itemised on screen, and fixed-width for the printer.
 *
 * Two renderings of one `Receipt` on purpose. The screen version is readable
 * at a counter; the print version is the 40-column monospace text a thermal
 * printer expects, which is also what survives being handed to a customer.
 * Both come from the same object, so they cannot disagree about the money.
 *
 * Printing goes through the browser's own print dialog rather than a driver
 * integration: a register is a browser on a counter, and the receipt printer
 * is whatever the operating system has installed. `@media print` hides the
 * rest of the page by visibility rather than `display: none`, because a
 * display-none element does not print at all.
 */
export function ReceiptView({
  receipt,
  warning = null,
}: {
  receipt: Receipt
  warning?: string | null
}) {
  const text = formatReceiptText(receipt)

  return (
    <>
      <GlobalStyles
        styles={{
          '@media print': {
            'body *': { visibility: 'hidden' },
            [`#${PRINT_ID}, #${PRINT_ID} *`]: { visibility: 'visible' },
            [`#${PRINT_ID}`]: {
              display: 'block',
              position: 'absolute',
              left: 0,
              top: 0,
              margin: 0,
              padding: 0,
              border: 'none',
              fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
              fontSize: '12px',
              lineHeight: 1.35,
              whiteSpace: 'pre',
              color: '#000',
            },
          },
        }}
      />

      <Box sx={{ py: 1 }}>
        <Typography variant="h6" sx={{ textAlign: 'center' }}>
          {receipt.businessName}
        </Typography>
        {receipt.locationName && (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            {receipt.locationName}
          </Typography>
        )}

        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          {receipt.orderNumber ? `Order ${receipt.orderNumber}` : 'Order number unavailable'}
          {receipt.cashierName ? ` · Served by ${receipt.cashierName}` : ''}
        </Typography>

        <Divider sx={{ my: 1.5 }} />

        {receipt.lines.map((line, i) => (
          <Box key={`${line.name}-${i}`} sx={{ mb: 1 }}>
            <Row
              label={`${line.quantity}× ${line.name}`}
              amount={toDollars(line.lineTotalCents)}
              bold
            />
            {line.modifiers.map((modifier, j) => (
              <Row
                key={`${modifier.name}-${j}`}
                label={`+ ${modifier.name}`}
                // A free option is a preparation note, not a charge.
                amount={modifier.priceDeltaCents === 0 ? '' : toDollars(modifier.priceDeltaCents)}
                muted
                indent
              />
            ))}
          </Box>
        ))}

        <Divider sx={{ my: 1.5 }} />

        <Row label="Subtotal" amount={toDollars(receipt.subtotalCents)} />
        <Row label="Tax" amount={toDollars(receipt.taxCents)} />
        {receipt.tipCents > 0 && <Row label="Tip" amount={toDollars(receipt.tipCents)} />}
        <Row label="Total" amount={toDollars(receipt.totalCents)} bold large />

        <Divider sx={{ my: 1.5 }} />

        {receipt.tenders.map((tender, i) => (
          <Row
            key={`${tender.method}-${i}`}
            label={TENDER_LABELS[tender.method]}
            amount={toDollars(tender.amountCents)}
            muted
          />
        ))}

        {receipt.changeDueCents > 0 && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Change due <strong>${toDollars(receipt.changeDueCents)}</strong>
          </Alert>
        )}

        {warning && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {warning}
          </Alert>
        )}
      </Box>

      {/*
        The printed article. Hidden on screen, and deliberately NOT a second
        formatting of the numbers — it is formatReceiptText() over the same
        Receipt the screen above renders.
      */}
      <Box id={PRINT_ID} component="pre" sx={{ display: 'none' }}>
        {text}
      </Box>
    </>
  )
}

function Row({
  label,
  amount,
  bold = false,
  muted = false,
  large = false,
  indent = false,
}: {
  label: string
  amount: string
  bold?: boolean
  muted?: boolean
  large?: boolean
  indent?: boolean
}) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, pl: indent ? 2 : 0 }}>
      <Typography
        variant={large ? 'h6' : 'body2'}
        color={muted ? 'text.secondary' : 'text.primary'}
        sx={{ fontWeight: bold ? 600 : 400 }}
      >
        {label}
      </Typography>
      <Typography
        variant={large ? 'h6' : 'body2'}
        color={muted ? 'text.secondary' : 'text.primary'}
        sx={{ fontWeight: bold ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}
      >
        {amount && `$${amount}`}
      </Typography>
    </Box>
  )
}
