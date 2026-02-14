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
const STREAM_KEY = 'gvote-votes-stream';
const GROUP_NAME = `group-${uuidv4().substring(0, 4)}`;
const CONSUMER_NAME = 'processor-1';

const redisClient = createClient({
    url: REDIS_URL,
    socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 2000)
    }
});

// Create WebSocket server
const wss = new WebSocket.Server({ noServer: true });

// Attach WS to HTTP server manually for better control
server.on('upgrade', (request, socket, head) => {
    if (request.url.startsWith('/ws')) {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// WebSocket clients: pollId -> Set of { ws, role }
const clients = new Map();

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
    Object.keys(rawVotes).forEach(key => {
        numericVotes[key] = Number(rawVotes[key]);
    });
    return numericVotes;
}

function broadcast(pollId, data) {
    const pollClients = clients.get(pollId);
    if (pollClients) {
        pollClients.forEach(client => {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify(data));
            }
        });
    }
}

// --- STREAM CONSUMER ---

async function startStreamConsumer() {
    console.log('📡 [LIVE] Initializing Secure Data System...');
    try {
        if (!redisClient.isOpen) await redisClient.connect();

        try {
            await redisClient.xGroupCreate(STREAM_KEY, GROUP_NAME, '$', { MKSTREAM: true });
        } catch (e) { }

        while (true) {
            try {
                const response = await redisClient.xReadGroup(
                    GROUP_NAME,
                    CONSUMER_NAME,
                    [{ key: STREAM_KEY, id: '>' }],
                    { COUNT: 1, BLOCK: 2000 }
                );

                if (response && response.length > 0) {
                    const message = response[0].messages[0];
                    const event = JSON.parse(message.message.payload);
                    const updatedVotes = await updateVoteCount(event.pollId, event.option);

                    broadcast(event.pollId, {
                        type: 'VOTE_EVENT',
                        metadata: {
                            id: message.id,
                            timestamp: Date.now(),
                        },
                        payload: event,
                        totalVotes: Object.values(updatedVotes).reduce((a, b) => a + b, 0),
                        votes: updatedVotes
                    });

                    await redisClient.xAck(STREAM_KEY, GROUP_NAME, message.id);
                }
            } catch (err) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    } catch (e) {
        console.error('❌ [SERVER] CRITICAL FAILURE:', e.message);
    }
}

// --- WS HANDLER ---

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pollId = url.searchParams.get('pollId');
    const role = url.searchParams.get('role');

    if (!pollId) return ws.terminate();

    if (!clients.has(pollId)) clients.set(pollId, new Set());
    const clientRecord = { ws, role };
    clients.get(pollId).add(clientRecord);

    ws.on('close', () => {
        const pollClients = clients.get(pollId);
        if (pollClients) pollClients.delete(clientRecord);
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
    await redisClient.xAdd(STREAM_KEY, '*', {
        payload: JSON.stringify({ pollId, option })
    });
    res.json({ success: true });
});

app.post('/api/polls/:pollId/release', async (req, res) => {
    const pollId = req.params.pollId;
    const poll = await getPoll(pollId);
    if (!poll) return res.status(404).json({ error: 'Not found' });
    poll.status = 'RESULT_RELEASED';
    await savePoll(pollId, poll);
    const rawVotes = await redisClient.hGetAll(`poll:${pollId}:votes`) || {};
    const votes = {};
    Object.keys(rawVotes).forEach(k => votes[k] = Number(rawVotes[k]));
    broadcast(pollId, { type: 'RESULTS_RELEASED', votes });
    res.json({ success: true });
});

// Final catch-all route for React
app.get('/*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
    console.log(`🚀 [SERVER] RUNNING ON PORT ${PORT}`);
    if (!redisClient.isOpen) await redisClient.connect();
    startStreamConsumer();
});
