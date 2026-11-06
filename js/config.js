/* =====================================================================
   Site config
   API_BASE: the address of your Cloudflare Worker (no trailing slash),
   e.g. 'https://boinga-accounts.yourname.workers.dev'.
   Leave it empty ('') to turn accounts off — the rest of the site still works.
   ===================================================================== */
window.BOINGA_CONFIG = {
  API_BASE: 'https://boinga-accounts.boingagames.workers.dev',
  // Ask first-time visitors if they want an account
  ASK_TO_SIGN_UP: true,
  // How often (seconds) the site tells the server you're online
  HEARTBEAT_SECONDS: 45
};
