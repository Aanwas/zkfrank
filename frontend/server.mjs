// Serves the visualiser and streams a real claim to it.
//
// Bound to 127.0.0.1 on purpose: this exposes an unauthenticated endpoint that
// reads an NFC card and sends a transaction, and it has no business being
// reachable from the network. Because nothing outside this machine can talk to
// it, the threat model excludes a network attacker - which is why there is no
// auth, no CORS and no CSRF handling here. Change the bind address and all three
// become necessary.
//
// Server-Sent Events rather than a WebSocket: the stream only ever goes
// server -> browser, and SSE needs no dependency on either side.
//
// Usage: node --env-file=.env frontend/server.mjs

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

import { runClaim } from '../scripts/lib/claim.mjs';

const PORT = Number(process.env.ZKFRANK_UI_PORT ?? 4173);
const PAGE = new URL('./index.html', import.meta.url);

// One claim at a time. Two overlapping runs would fight over the card reader and
// spend the same nullifier, and the second failure would look like a bug.
let running = false;

function sse(res) {
    res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
    });
    return (stage, data) => res.write(`data: ${JSON.stringify({ stage, ...data })}\n\n`);
}

const server = createServer(async (req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(await readFile(PAGE));
        return;
    }

    if (req.url === '/run') {
        const emit = sse(res);

        if (running) {
            emit('error', { message: 'A claim is already in progress' });
            res.end();
            return;
        }

        running = true;
        try {
            await runClaim(emit);
        } catch (e) {
            // The browser gets the real message. Hiding it would leave the page
            // stuck on a spinner with the reason only in this terminal.
            emit('error', { message: e.message });
        } finally {
            running = false;
            res.end();
        }
        return;
    }

    res.writeHead(404).end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`zkfrank visualiser on http://localhost:${PORT} (loopback only)`);
});
