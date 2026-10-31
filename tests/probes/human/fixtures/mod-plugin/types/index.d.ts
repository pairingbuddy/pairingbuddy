export type PbmodState = string

declare module 'claude-code' {
  interface PluginState {
    pbmod: { state: PbmodState }
  }
}
