/**
 * Daily Word: a 40-day cycle of verses (King James Version, public domain) with a question and a
 * prayer prompt. Everyone sees the same verse each day (South African time), so the church reads together.
 */
export interface Word { ref: string; text: string; reflect: string; pray: string; usfm: string }

export const PLAN: Word[] = [
  { ref: "Psalm 119:105", usfm: "PSA.119", text: "Thy word is a lamp unto my feet, and a light unto my path.", reflect: "Where do you need God's light on your path this week?", pray: "Ask God to make His Word clear to you today, one step at a time." },
  { ref: "Joshua 1:9", usfm: "JOS.1", text: "Have not I commanded thee? Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.", reflect: "What's one thing you're nervous about that God is already walking into with you?", pray: "Hand that fear to God by name, and thank Him that you won't face it alone." },
  { ref: "Jeremiah 29:11", usfm: "JER.29", text: "For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end.", reflect: "Which part of your future feels most uncertain right now?", pray: "Tell God you trust His thoughts toward you more than your own worries." },
  { ref: "Proverbs 3:5–6", usfm: "PRO.3", text: "Trust in the LORD with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths.", reflect: "Where are you leaning on your own understanding?", pray: "Invite God into one decision you're facing today." },
  { ref: "Philippians 4:13", usfm: "PHP.4", text: "I can do all things through Christ which strengtheneth me.", reflect: "What feels too hard for you today?", pray: "Ask Christ for His strength for that exact thing." },
  { ref: "Isaiah 40:31", usfm: "ISA.40", text: "But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint.", reflect: "Where are you running on empty?", pray: "Take two quiet minutes to simply wait on God, then ask Him to renew you." },
  { ref: "1 Timothy 4:12", usfm: "1TI.4", text: "Let no man despise thy youth; but be thou an example of the believers, in word, in conversation, in charity, in spirit, in faith, in purity.", reflect: "Which of these could you be an example in this week: word, love, faith or purity?", pray: "Ask God to use your life, at your age, to point others to Him." },
  { ref: "Romans 12:2", usfm: "ROM.12", text: "And be not conformed to this world: but be ye transformed by the renewing of your mind, that ye may prove what is that good, and acceptable, and perfect, will of God.", reflect: "What are you feeding your mind with most days?", pray: "Ask God to renew one thought pattern that isn't from Him." },
  { ref: "Matthew 6:33", usfm: "MAT.6", text: "But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you.", reflect: "What usually comes first in your day?", pray: "Put God first right now. Give Him the first words of your plans today." },
  { ref: "John 3:16", usfm: "JHN.3", text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.", reflect: "Read it again with your own name in place of “the world”.", pray: "Thank Jesus personally for giving Himself for you." },
  { ref: "Psalm 46:10", usfm: "PSA.46", text: "Be still, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth.", reflect: "When was the last time you were truly still?", pray: "Put your phone down for one minute of silence before God." },
  { ref: "2 Corinthians 5:17", usfm: "2CO.5", text: "Therefore if any man be in Christ, he is a new creature: old things are passed away; behold, all things are become new.", reflect: "What old thing are you still carrying that Jesus has already made new?", pray: "Thank God that in Christ your past doesn't define you." },
  { ref: "Philippians 4:6–7", usfm: "PHP.4", text: "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God. And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.", reflect: "What are you anxious about today?", pray: "Turn each worry into a request, and add one thank-you for every request." },
  { ref: "Psalm 139:14", usfm: "PSA.139", text: "I will praise thee; for I am fearfully and wonderfully made: marvellous are thy works; and that my soul knoweth right well.", reflect: "What do you find hard to accept about yourself?", pray: "Thank God for one thing He made well in you." },
  { ref: "Galatians 2:20", usfm: "GAL.2", text: "I am crucified with Christ: nevertheless I live; yet not I, but Christ liveth in me: and the life which I now live in the flesh I live by the faith of the Son of God, who loved me, and gave himself for me.", reflect: "What would change today if Christ really lived through you?", pray: "Surrender one area of your life to Him: your phone, your words or your time." },
  { ref: "Romans 8:28", usfm: "ROM.8", text: "And we know that all things work together for good to them that love God, to them who are the called according to his purpose.", reflect: "What hard thing might God be working into good?", pray: "Tell God you trust Him with the parts of your story you don't understand yet." },
  { ref: "Lamentations 3:22–23", usfm: "LAM.3", text: "It is of the LORD's mercies that we are not consumed, because his compassions fail not. They are new every morning: great is thy faithfulness.", reflect: "Did yesterday go wrong? Today's mercy is brand new.", pray: "Receive today's fresh mercy, and thank God for His faithfulness." },
  { ref: "Matthew 11:28", usfm: "MAT.11", text: "Come unto me, all ye that labour and are heavy laden, and I will give you rest.", reflect: "What's making you tired: school, work, people, or yourself?", pray: "Come to Jesus with it, exactly as you are." },
  { ref: "Psalm 23:1", usfm: "PSA.23", text: "The LORD is my shepherd; I shall not want.", reflect: "Read the whole of Psalm 23 slowly. Which line speaks to you?", pray: "Ask the Good Shepherd to lead you through today." },
  { ref: "John 14:6", usfm: "JHN.14", text: "Jesus saith unto him, I am the way, the truth, and the life: no man cometh unto the Father, but by me.", reflect: "Who in your life needs to know the Way?", pray: "Pray by name for one friend who doesn't know Jesus yet." },
  { ref: "Acts 1:8", usfm: "ACT.1", text: "But ye shall receive power, after that the Holy Ghost is come upon you: and ye shall be witnesses unto me both in Jerusalem, and in all Judaea, and in Samaria, and unto the uttermost part of the earth.", reflect: "Where is your “Jerusalem”: your school, your workplace, your family?", pray: "Ask the Holy Spirit for boldness to be a witness there this week." },
  { ref: "Romans 1:16", usfm: "ROM.1", text: "For I am not ashamed of the gospel of Christ: for it is the power of God unto salvation to every one that believeth; to the Jew first, and also to the Greek.", reflect: "When do you feel shy about your faith?", pray: "Ask God for courage to share one thing He's done for you." },
  { ref: "James 1:5", usfm: "JAS.1", text: "If any of you lack wisdom, let him ask of God, that giveth to all men liberally, and upbraideth not; and it shall be given him.", reflect: "What decision do you need wisdom for?", pray: "Ask God for wisdom, and expect Him to give it generously." },
  { ref: "1 John 1:9", usfm: "1JN.1", text: "If we confess our sins, he is faithful and just to forgive us our sins, and to cleanse us from all unrighteousness.", reflect: "Is there something you've been hiding from God?", pray: "Confess it honestly, then receive His forgiveness. You're clean." },
  { ref: "Psalm 34:8", usfm: "PSA.34", text: "O taste and see that the LORD is good: blessed is the man that trusteth in him.", reflect: "Where have you “tasted” God's goodness recently?", pray: "Thank God for three good things from this week." },
  { ref: "Hebrews 11:1", usfm: "HEB.11", text: "Now faith is the substance of things hoped for, the evidence of things not seen.", reflect: "What are you hoping for that you can't see yet?", pray: "Bring that hope to God, and choose to trust Him with it." },
  { ref: "Isaiah 41:10", usfm: "ISA.41", text: "Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee; yea, I will uphold thee with the right hand of my righteousness.", reflect: "Count the promises in this verse. Which one do you need most?", pray: "Pray that promise back to God in your own words." },
  { ref: "Matthew 5:14", usfm: "MAT.5", text: "Ye are the light of the world. A city that is set on an hill cannot be hid.", reflect: "Where could your light shine brighter this week?", pray: "Ask God to show you one person to encourage today." },
  { ref: "1 Thessalonians 5:16–18", usfm: "1TH.5", text: "Rejoice evermore. Pray without ceasing. In every thing give thanks: for this is the will of God in Christ Jesus concerning you.", reflect: "Can you turn ordinary moments today into short prayers?", pray: "Set three moments today to pause and thank God." },
  { ref: "Psalm 51:10", usfm: "PSA.51", text: "Create in me a clean heart, O God; and renew a right spirit within me.", reflect: "What would a clean heart look like for you today?", pray: "Pray this verse slowly, word for word, as your own prayer." },
  { ref: "John 15:5", usfm: "JHN.15", text: "I am the vine, ye are the branches: He that abideth in me, and I in him, the same bringeth forth much fruit: for without me ye can do nothing.", reflect: "What helps you stay connected to Jesus during a busy week?", pray: "Ask Jesus to help you remain in Him: in His Word, prayer and church family." },
  { ref: "Galatians 5:22–23", usfm: "GAL.5", text: "But the fruit of the Spirit is love, joy, peace, longsuffering, gentleness, goodness, faith, meekness, temperance: against such there is no law.", reflect: "Which fruit is growing in you, and which needs more sun?", pray: "Ask the Holy Spirit to grow that fruit in you this week." },
  { ref: "Micah 6:8", usfm: "MIC.6", text: "He hath shewed thee, O man, what is good; and what doth the LORD require of thee, but to do justly, and to love mercy, and to walk humbly with thy God?", reflect: "Justice, mercy, humility: which is hardest for you?", pray: "Ask God to show you one practical way to live it out today." },
  { ref: "Psalm 37:4", usfm: "PSA.37", text: "Delight thyself also in the LORD; and he shall give thee the desires of thine heart.", reflect: "What does delighting in God look like for you?", pray: "Spend a minute simply enjoying who God is, before asking for anything." },
  { ref: "Romans 10:9", usfm: "ROM.10", text: "That if thou shalt confess with thy mouth the Lord Jesus, and shalt believe in thine heart that God hath raised him from the dead, thou shalt be saved.", reflect: "Have you made this confession your own?", pray: "Say it out loud today: “Jesus is Lord.” If it's your first time, tell a leader. We'd love to celebrate with you!" },
  { ref: "Ephesians 2:10", usfm: "EPH.2", text: "For we are his workmanship, created in Christ Jesus unto good works, which God hath before ordained that we should walk in them.", reflect: "What good work might God have prepared for you this week?", pray: "Ask God to open your eyes to it, and say yes in advance." },
  { ref: "Zephaniah 3:17", usfm: "ZEP.3", text: "The LORD thy God in the midst of thee is mighty; he will save, he will rejoice over thee with joy; he will rest in his love, he will joy over thee with singing.", reflect: "Imagine God singing over you. How does that change how you see yourself?", pray: "Thank God that He delights in you, not just in what you do." },
  { ref: "2 Timothy 1:7", usfm: "2TI.1", text: "For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind.", reflect: "Where is fear speaking louder than faith?", pray: "Ask God for power, love and a sound mind in that exact situation." },
  { ref: "Psalm 119:11", usfm: "PSA.119", text: "Thy word have I hid in mine heart, that I might not sin against thee.", reflect: "Which verse from this plan could you memorise this week?", pray: "Pick one and say it three times today. Ask God to plant it deep." },
  { ref: "Revelation 3:20", usfm: "REV.3", text: "Behold, I stand at the door, and knock: if any man hear my voice, and open the door, I will come in to him, and will sup with him, and he with me.", reflect: "Jesus wants to spend time with you. When will you open the door today?", pray: "Open the door: tell Jesus you want more of Him." },
];

/** Today's date in South Africa as YYYY-MM-DD. */
export function saDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const EPOCH = Date.UTC(2026, 0, 1);
export function wordFor(day: string) {
  const n = Math.floor((Date.parse(day + "T00:00:00Z") - EPOCH) / 86400_000);
  const i = ((n % PLAN.length) + PLAN.length) % PLAN.length;
  const w = PLAN[i];
  return { day, number: i + 1, of: PLAN.length, ...w, read_url: `https://www.bible.com/bible/111/${w.usfm}.NIV` };
}

/** Current streak (consecutive days up to today, or up to yesterday if today isn't done yet) + last 7 days. */
export function streakFrom(days: string[], today: string) {
  const set = new Set(days);
  const prev = (d: string) => saDay(new Date(Date.parse(d + "T12:00:00Z") - 86400_000));
  let cur = set.has(today) ? today : prev(today), streak = 0;
  while (set.has(cur)) { streak++; cur = prev(cur); }
  const last7: { day: string; done: boolean }[] = [];
  let d = today;
  for (let i = 0; i < 7; i++) { last7.unshift({ day: d, done: set.has(d) }); d = prev(d); }
  return { streak, last7, total: set.size };
}
