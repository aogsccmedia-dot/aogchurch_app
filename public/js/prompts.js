// One pop-up at a time: the cookie notice, the install tip and the daily-verse offer wait until nothing else is open
// (another prompt, a menu, a dialog, the welcome animation), so people never face a stack of boxes.
const OPEN = ".consent.show, .push-offer, .app-tip, .app-sheet, .tools-sheet, .search-sheet, dialog[open], .welcome-screen, .hello-black";
export const popupOpen = () => !!document.querySelector(OPEN);
export function whenNoPopup(show, { delay = 600 } = {}) {
  let t = 0;
  const tick = () => { if (document.hidden || popupOpen()) { t = setTimeout(tick, 1200); return; } show(); };
  t = setTimeout(tick, delay);
  return () => clearTimeout(t);
}
