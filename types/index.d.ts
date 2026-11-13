declare module 'claude-code' {
  interface PluginState {
    pairingbuddy: {
      // What the poller read from the run's files each second; null until the first poll has landed.
      inputs: {
        ledger: unknown
        tests: string[]
        now: number | null
      } | null
    }
  }
}
