/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * rostr's tailnet address. Set: the browser calls rostr there itself and each viewer is who Tailscale
   * says they are. Unset: same origin, through the dev server's proxy and its token.
   */
  readonly VITE_ROSTR_URL?: string;
}
