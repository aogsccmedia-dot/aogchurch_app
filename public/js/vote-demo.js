// Example data for the "How voting works" pictures (vote.html?demo=pick|voted|final). Made-up people, never real ballots.
const P = (id, name, picture = null) => ({ id, name, picture });
const people = [P("d1", "Thandi Mokoena"), P("d2", "Sipho Dlamini"), P("d3", "Lerato Khumalo"), P("d4", "Kagiso Nkosi"), P("d5", "Nomsa Zulu"), P("d6", "Tshepo Molefe")];
const day = (d) => new Date(Date.now() + d * 86400000).toISOString();
export function demo(kind) {
  const complete = kind === "final";
  const poll = { id: "demo", title: "Youth committee 2027", event_name: "Youth AGM", description: "Choosing the youth committee for next year.", rounds: 2,
    state: complete ? "complete" : "open", round: complete ? 2 : 1, next: { opens_at: day(-1), closes_at: day(3) }, min_saved_years: 2,
    schedule: [{ round: 1, opens_at: day(-1), closes_at: day(3) }, { round: 2, opens_at: day(5), closes_at: day(8) }] };
  const results = [["d1", 14], ["d3", 11], ["d2", 7], ["d5", 4]].map(([id, votes]) => ({ ...people.find((x) => x.id === id), votes }));
  const role = { id: "chair", name: "Youth chairperson", description: "Leads the youth committee and its meetings.", seats: 1,
    candidates: complete ? [] : people, my_vote: kind === "voted" ? "d1" : null, total: results.reduce((n, r) => n + r.votes, 0),
    results: kind === "pick" ? [] : results, appointed: complete ? [people[0]] : [] };
  return { poll, roles: [role], me: "me" };
}
