const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('redis');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../client/dist')));

const server = http.createServer(app);

// --- CONFIG ---
const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
    console.error('❌ [CRITICAL] REDIS_URL is not defined.');
}

const STREAM_KEY = 'gvote-votes-stream';
// Using a consistent group name so only one server instance processes each vote
const GROUP_NAME = 'gvote-global-consumer-group';
const CONSUMER_ID = `node-${uuidv4().substring(0, 4)}`;
const PUB_SUB_CHANNEL = 'poll-updates';

// Main client for state/streams
const redisClient = createClient({ url: REDIS_URL || 'redis://localhost:6379' });
// Dedicated client for Pub/Sub subscriptions
const subscriber = createClient({ url: REDIS_URL || 'redis://localhost:6379' });
// Dedicated client for Publishing
const publisher = createClient({ url: REDIS_URL || 'redis://localhost:6379' });

// Create WebSocket server
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    if (request.url.startsWith('/ws')) {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// WebSocket clients: pollId -> Set of ws
const clients = new Map();

// --- REDIS PUB/SUB BRIDGE ---
async function startPubSub() {
    await subscriber.connect();
    await publisher.connect();

    console.log('🔗 [PUBSUB] Real-time synchronization active');

    await subscriber.subscribe(PUB_SUB_CHANNEL, (message) => {
        const { pollId, data } = JSON.parse(message);
        broadcastLocal(pollId, data);
    });
}

function broadcastLocal(pollId, data) {
    const pollClients = clients.get(pollId);
    if (pollClients) {
        pollClients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(data));
            }
        });
    }
}

async function publishUpdate(pollId, data) {
    await publisher.publish(PUB_SUB_CHANNEL, JSON.stringify({ pollId, data }));
}

// --- HELPERS ---

async function getPoll(pollId) {
    const data = await redisClient.get(`poll:${pollId}:meta`);
    return data ? JSON.parse(data) : null;
}

async function savePoll(pollId, pollData) {
    await redisClient.set(`poll:${pollId}:meta`, JSON.stringify(pollData));
}

async function updateVoteCount(pollId, option) {
    await redisClient.hIncrBy(`poll:${pollId}:votes`, option, 1);
    const rawVotes = await redisClient.hGetAll(`poll:${pollId}:votes`);
    const numericVotes = {};
    Object.keys(rawVotes).forEach(key => numericVotes[key] = Number(rawVotes[key]));
    return numericVotes;
}

// --- STREAM CONSUMER (Worker) ---
async function startStreamConsumer() {
    try {
        if (!redisClient.isOpen) await redisClient.connect();
        try {
            await redisClient.xGroupCreate(STREAM_KEY, GROUP_NAME, '$', { MKSTREAM: true });
        } catch (e) { }

        while (true) {
            const response = await redisClient.xReadGroup(
                GROUP_NAME, CONSUMER_ID,
                [{ key: STREAM_KEY, id: '>' }],
                { COUNT: 1, BLOCK: 2000 }
            );

            if (response && response.length > 0) {
                const message = response[0].messages[0];
                const event = JSON.parse(message.message.payload);
                const updatedVotes = await updateVoteCount(event.pollId, event.option);

                // Publish update to ALL server instances via Pub/Sub
                await publishUpdate(event.pollId, {
                    type: 'VOTE_EVENT',
                    metadata: { id: message.id, timestamp: Date.now() },
                    payload: event,
                    totalVotes: Object.values(updatedVotes).reduce((a, b) => a + b, 0),
                    votes: updatedVotes
                });

                await redisClient.xAck(STREAM_KEY, GROUP_NAME, message.id);
            }
        }
    } catch (e) {
        console.error('❌ [STREAM] Processor Error:', e.message);
        setTimeout(startStreamConsumer, 5000);
    }
}

// --- WS HANDLER ---
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pollId = url.searchParams.get('pollId');
    if (!pollId) return ws.terminate();

    if (!clients.has(pollId)) clients.set(pollId, new Set());
    clients.get(pollId).add(ws);

    ws.on('close', () => {
        const pollClients = clients.get(pollId);
        if (pollClients) {
            pollClients.delete(ws);
            if (pollClients.size === 0) clients.delete(pollId);
        }
    });
});

// --- API ---
app.post('/api/polls', async (req, res) => {
    const { question, options } = req.body;
    const pollId = uuidv4().substring(0, 8);
    const pollData = { question, options, status: 'ACTIVE', createdAt: Date.now() };
    await savePoll(pollId, pollData);
    res.json({ pollId });
});

app.get('/api/polls/:pollId', async (req, res) => {
    const pollId = req.params.pollId;
    const poll = await getPoll(pollId);
    if (!poll) return res.status(404).json({ error: 'Not found' });
    const rawVotes = await redisClient.hGetAll(`poll:${pollId}:votes`) || {};
    const pollVotes = {};
    Object.keys(rawVotes).forEach(k => pollVotes[k] = Number(rawVotes[k]));
    res.json({
        ...poll,
        votes: pollVotes,
        totalVotes: Object.values(pollVotes).reduce((a, b) => a + Number(b), 0)
    });
});

app.post('/api/polls/:pollId/vote', async (req, res) => {
    const { pollId } = req.params;
    const { option } = req.body;
    const poll = await getPoll(pollId);
    if (!poll || poll.status !== 'ACTIVE') return res.status(403).json({ error: 'Poll closed' });
    await redisClient.xAdd(STREAM_KEY, '*', { payload: JSON.stringify({ pollId, option }) });
    res.json({ success: true });
});

app.post('/api/polls/:pollId/release', async (req, res) => {
    const pollId = req.params.pollId;
    const poll = await getPoll(pollId);
    if (!poll) return res.status(404).json({ error: 'Not found' });
    poll.status = 'CLOSED';
    await savePoll(pollId, poll);
    const rawVotes = await redisClient.hGetAll(`poll:${pollId}:votes`) || {};
    const votes = {};
    Object.keys(rawVotes).forEach(k => votes[k] = Number(rawVotes[k]));
    await publishUpdate(pollId, { type: 'RESULTS_RELEASED', votes });
    res.json({ success: true });
});

app.get('/:path*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
    console.log(`🚀 [SERVER] PORT ${PORT}`);
    await startPubSub();
    startStreamConsumer();
});
