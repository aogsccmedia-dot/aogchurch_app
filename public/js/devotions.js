// Devotions: today's verse (word.js fills [data-word]) inside the member portal.
import { getMe } from "./auth.js";
import { helloOnce, renderTabs } from "./portal.js";
getMe().then((me) => { renderTabs(document.getElementById("portal-tabs"), me, "/devotions"); helloOnce(me); }).catch(() => {});
