import { fitBand } from '../shared-node/glance.mjs'
import type { Segment, Tags } from './view'

const IDLE = 'Pairing Buddy · idle'
export const DETAILS = '▸ details'

export const bandColumns = (columns: number) => columns - DETAILS.length - 1

export const OPENED_DETAILS = 'needs you · opened details'

// Once the alert opened the pane, the needs-you segment reads as opened; fitBand keeps it whole.
const asOpened = (band: Segment[]): Segment[] => band.map(segment => (segment.id === 'needsYou' && segment.standing ? { ...segment, text: OPENED_DETAILS } : segment))

// While a stage is active, only the segments that fit beside the details button; otherwise one dim "idle".
export function Band({ Box, Text, Button, band, columns, running, opened, onDetails }: Tags & {
  band: Segment[]
  columns: number
  running: boolean
  opened?: boolean
  onDetails: () => void
}) {
  const shown = running ? fitBand(opened ? asOpened(band) : band, bandColumns(columns)) : undefined

  return (
    <Box>
      {shown
        ? shown.map((segment: Segment) => <Text key={segment.id}>{segment.text}</Text>)
        : <Text dimColor>{IDLE}</Text>}
      <Button key="details" label={DETAILS} onPress={onDetails} />
    </Box>
  )
}
