import { startMockSite } from "./server.js";
const port = Number(process.env.PORT ?? 4780);
const s = await startMockSite(port);
console.log(`mock site: ${s.url}  (/, /ce, /download, /needs-login)`);
