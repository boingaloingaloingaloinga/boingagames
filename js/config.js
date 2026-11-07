/* =====================================================================
   Site config
   API_BASE: the address of your Cloudflare Worker (no trailing slash).
   Leave it empty ('') to turn accounts off — the rest of the site still works.
   ===================================================================== */
window.BOINGA_CONFIG = {
  API_BASE: 'https://boinga-accounts.boingagames.workers.dev',
  // Ask first-time visitors if they want an account
  ASK_TO_SIGN_UP: true,
  // How often (seconds) the site tells the server you're online.
  // The server slows this down automatically when data saver is on.
  HEARTBEAT_SECONDS: 45,
  // KLIPY GIF search key (GIFs only, used in chat)
  KLIPY_KEY: 'GlC9WAS2orygH40I5gUjBpLheAcNgkBu1PeR1heEwuOapMAukl6XOMHWXQdhUzL6'
};
