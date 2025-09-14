export function createTitleStatus({ playerName = "Player", version = "" } = {}) {
  if (typeof document === "undefined") {
    return { setStatus() {} };
  }

  const baseTitle = document.title || "Fully AI Game";

  function formatTitle({ peers = 0, avgPing = null }) {
    const pingStr = (avgPing == null || Number.isNaN(avgPing)) ? "-" : `${avgPing}ms`;
    const verStr = version ? ` • v${version}` : "";
    return `${baseTitle} — Player: ${playerName} • Peers: ${peers} • Ping: ${pingStr}${verStr}`;
  }

  // Initial title
  document.title = formatTitle({ peers: 0, avgPing: null });

  function setStatus({ peers = 0, avgPing = null } = {}) {
    document.title = formatTitle({ peers, avgPing });
  }

  return { setStatus };
}
