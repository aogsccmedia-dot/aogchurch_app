// FreeCreator Online: output and stage windows follow the control window (same browser, BroadcastChannel).
export function subscribe(cb) {
  const ch = new BroadcastChannel("freecreator-live");
  ch.onmessage = (e) => { if (e.data?.type === "state") cb(e.data.state); };
  ch.postMessage({ type: "hello" });
  return () => ch.close();
}
export const mediaUrl = (id) => { try { return window.opener?.__fcMediaUrl?.(id) || window.__fcMediaUrl?.(id) || ""; } catch { return ""; } };
