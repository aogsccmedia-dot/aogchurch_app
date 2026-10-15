// A steady frame clock for the Studio. Timers in a worker keep their pace when the Studio window is behind
// other windows (the main page's timers get slowed down by the browser), so the stream never stutters.
let t = 0;
onmessage = (e) => { clearInterval(t); if (e.data > 0) t = setInterval(() => postMessage(0), e.data); };
