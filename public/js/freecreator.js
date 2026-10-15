// FreeCreator Online landing: sign in, then open the app.
import { getMe, signInCard, onSignInDone } from "./auth.js";
const $ = (id) => document.getElementById(id);
async function show() {
  const me = await getMe(true);
  if (me.user) {
    $("fc-go").hidden = false; $("fc-signin").hidden = true; $("fc-need").hidden = true;
    $("fc-who").textContent = `Signed in as ${me.user.email}.`;
    if (new URLSearchParams(location.search).has("signin")) location.replace("/freecreator/app/");
    return;
  }
  $("fc-need").hidden = !new URLSearchParams(location.search).has("signin");
  $("fc-signin").hidden = false;
  onSignInDone(() => location.assign("/freecreator/app/"));
  await signInCard($("fc-card"));
}
show();
