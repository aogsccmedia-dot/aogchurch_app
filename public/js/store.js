// AOG Store: books by our brethren. Empty for now; the portal tabs still work here.
import { getMe } from "./auth.js";
import { renderTabs } from "./portal.js";
getMe().then((me) => renderTabs(document.getElementById("portal-tabs"), me, "/store")).catch(() => {});
