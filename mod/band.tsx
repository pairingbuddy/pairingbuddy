import { fitBand } from '../shared-node/glance.mjs'
import type { Segment, Tags } from './view'

const IDLE = 'Pairing Buddy · idle'
export const DETAILS = '▸ details'

export const bandColumns = (columns: number) => columns - DETAILS.length - 1

// While a stage is active, only the segments that fit beside the details button; otherwise one dim "idle".
export function Band({ Box, Text, Button, band, columns, running, onDetails }: Tags & {
  band: Segment[]
  columns: number
  running: boolean
  onDetails: () => void
}) {
  const shown = running ? fitBand(band, bandColumns(columns)) : undefined

  return (
    <Box>
      {shown
        ? shown.map((segment: Segment) => <Text key={segment.id}>{segment.text}</Text>)
        : <Text dimColor>{IDLE}</Text>}
      <Button key="details" label={DETAILS} onPress={onDetails} />
    </Box>
  )
}
