// Who is using FreeCreator Online. No account is needed: anyone on a computer goes straight in and their work is
// saved in their own browser. Signed-in members of a church workspace also share songs and shows with their church
// (each church only ever sees its own). FreeCreator runs on computers only; on phones and tablets the few accounts the
// main admin allows can use the phone as an extra Studio camera, and everyone else is asked to use a computer.

/** Phones and tablets (including iPads, which report themselves as a Mac with a touch screen). */
export function isPhoneOrTablet() {
  const ua = navigator.userAgent || "";
  if (navigator.userAgentData?.mobile) return true;
  if (/iPhone|iPod|iPad|Android|Mobile|Silk|Kindle|PlayBook|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
}

const get = (url) => fetch(url, { credentials: "same-origin", cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));

/** Resolves who is here, or sends phones away (never resolves in that case). */
export async function gate() {
  const me = await get("/api/auth/me");
  const access = me?.user && !me.user.visitor && !me.visitor ? await get("/api/freecreator/access") : {};
  if (isPhoneOrTablet()) {
    location.replace(access.mobile ? "/freecreator/app/camera.html" : "/freecreator?phone=1");
    await new Promise(() => {});
  }
  const church = access.church || null;
  return {
    user: me?.user || null,
    church,
    guest: !church,
    /** Storage scope: the church workspace + account, or this browser for guests. */
    scope: church ? `${church.id}:${me.user.id}` : "guest",
    name: church ? (me.user.given_name || me.user.email) : (me?.user?.given_name || ""),
  };
}
