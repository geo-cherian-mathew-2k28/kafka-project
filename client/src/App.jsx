import React, { useState, useEffect, useRef } from 'react';
import { Routes, Route, useParams, useNavigate, Link } from 'react-router-dom';
import {
    Share2, Plus, ArrowRight, CheckCircle2, Copy, Activity,
    ChevronRight, Terminal, Globe, Zap, Database, ExternalLink
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, ResponsiveContainer, Cell, Tooltip
} from 'recharts';
import confetti from 'canvas-confetti';
import { motion, AnimatePresence } from 'framer-motion';

// --- SHARED COMPONENTS ---
const Navbar = () => (
    <nav className="border-b border-white/5 bg-[#020617]/50 backdrop-blur-xl sticky top-0 z-[100] px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
            <Link to="/" className="flex items-center gap-4 group">
                <div className="w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20 group-hover:rotate-12 transition-transform flex-shrink-0">
                    <Zap className="text-white" size={20} fill="currentColor" />
                </div>
                <div className="flex flex-col">
                    <span className="text-xl font-black gradient-text tracking-tighter leading-none">KAFKA-VOTE</span>
                    <div className="flex items-center gap-1.5 mt-1">
                        <div className="live-indicator" style={{ width: 6, height: 6 }} />
                        <span className="text-[9px] font-bold text-muted uppercase tracking-widest">Live & Connected</span>
                    </div>
                </div>
            </Link>
            <div className="hidden md:flex gap-8 items-center">
                <div className="flex flex-col items-end gap-0.5">
                    <span className="text-[10px] font-black text-white uppercase tracking-widest leading-none">Connection</span>
                    <span className="text-xs font-bold text-accent leading-none">Fast & Secure</span>
                </div>
                <div className="w-[1px] h-8 bg-white/10" />
                <button className="text-[10px] font-black uppercase tracking-widest px-4 py-2 border border-white/10 rounded-full hover:bg-white/5 transition-colors">
                    Version 2.4.1
                </button>
            </div>
        </div>
    </nav>
);

// --- CREATE POLL PAGE ---
const CreatePoll = () => {
    const [question, setQuestion] = useState('');
    const [options, setOptions] = useState(['', '']);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const addOption = () => setOptions([...options, '']);
    const updateOption = (idx, val) => {
        const newOpts = [...options];
        newOpts[idx] = val;
        setOptions(newOpts);
    };

    const handleCreate = async () => {
        if (!question || options.some(o => !o)) return;
        setLoading(true);
        const res = await fetch('/api/polls', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, options: options.filter(o => o) })
        });
        const data = await res.json();
        navigate(`/owner/${data.pollId}`);
    };

    return (
        <div className="container max-w-3xl">
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="glass-card mt-12 bg-gradient-to-br from-[#0f172a] to-[#020617]">
                <div className="flex items-center gap-3 mb-10 opacity-60 uppercase font-black tracking-[0.4em] text-[10px]">
                    <Terminal size={14} className="text-primary" /> Setup Your Poll
                </div>
                <h1 className="text-left mb-8">Start a <span className="gradient-text">Live Poll</span> and get instant results</h1>

                <div className="space-y-8">
                    <div className="group">
                        <label className="text-[10px] font-black text-muted uppercase tracking-[0.3em] mb-4 block group-focus-within:text-primary transition-colors">Your Question</label>
                        <input
                            placeholder="e.g., What should we have for lunch?"
                            className="w-full bg-white/5 border-white/10 rounded-2xl p-6 text-xl font-bold transition-all"
                            onChange={e => setQuestion(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-muted uppercase tracking-[0.3em] mb-4 block">Poll Choices</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {options.map((opt, i) => (
                                <motion.div key={i} layout className="relative">
                                    <input
                                        placeholder={`Choice ${i + 1}`}
                                        className="w-full bg-white/5 border-white/10 rounded-2xl px-6 py-5 font-bold transition-all"
                                        value={opt}
                                        onChange={e => updateOption(i, e.target.value)}
                                    />
                                </motion.div>
                            ))}
                            <button onClick={addOption} className="option-card border-dashed border-white/10 flex justify-center items-center gap-3 py-5 hover:bg-white/[0.05] transition-all">
                                <Plus size={20} className="text-secondary" />
                                <span className="text-[10px] font-black uppercase tracking-widest">Add Choice</span>
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={handleCreate}
                        disabled={loading || !question}
                        className="btn btn-primary w-full py-5 text-lg flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                        {loading ? 'Launching...' : 'START YOUR POLL'}
                        <ArrowRight size={22} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

// --- OWNER DASHBOARD ---
const OwnerDashboard = () => {
    const { pollId } = useParams();
    const [poll, setPoll] = useState(null);
    const [kafkaEvents, setKafkaEvents] = useState([]);
    const [isCopied, setIsCopied] = useState(false);
    const [releasing, setReleasing] = useState(false);

    useEffect(() => {
        fetch(`/api/polls/${pollId}?role=owner`).then(res => res.json()).then(setPoll);

        const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsHost = window.location.hostname === 'localhost' ? 'localhost:5000' : window.location.host;
        const socket = new WebSocket(`${wsProtocol}://${wsHost}/ws?pollId=${pollId}&role=owner`);

        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'VOTE_EVENT') {
                setPoll(prev => prev ? { ...prev, votes: data.votes, totalVotes: data.totalVotes } : prev);
                setKafkaEvents(prev => [data.metadata, ...prev].slice(0, 6));
            }
        };

        return () => socket.close();
    }, [pollId]);

    const handleRelease = async () => {
        setReleasing(true);
        await fetch(`/api/polls/${pollId}/release`, { method: 'POST' });
        setPoll(prev => ({ ...prev, status: 'PUBLISHED' }));
        setReleasing(false);
        confetti({
            particleCount: 250,
            spread: 120,
            origin: { y: 0.6 },
            colors: ['#c084fc', '#f472b6', '#22d3ee']
        });
    };

    if (!poll) return (
        <div className="min-h-[80vh] flex flex-col items-center justify-center gap-6">
            <Activity size={48} className="text-primary animate-pulse" />
            <p className="text-[10px] font-black uppercase tracking-[0.5em] text-muted">Establishing Secure Broker Link</p>
        </div>
    );

    const chartData = Object.entries(poll.votes).map(([name, value]) => ({ name, value }));
    const COLORS = ['#c084fc', '#f472b6', '#22d3ee', '#818cf8'];
    const voterLink = `${window.location.origin}/poll/${pollId}`;

    return (
        <div className="container max-w-7xl">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 mt-4">
                <div className="glass-card p-6">
                    <div className="flex items-center gap-2 mb-3">
                        <Database size={14} className="text-primary" />
                        <span className="text-[10px] font-black text-muted uppercase tracking-widest">Total Votes</span>
                    </div>
                    <div className="stat-value leading-none mb-1">{poll.totalVotes}</div>
                </div>
                <div className="glass-card p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Globe size={14} className="text-secondary" />
                        <span className="text-[10px] font-black text-muted uppercase tracking-widest">Status</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="live-indicator" style={{ width: 8, height: 8 }} />
                        <span className="text-2xl font-black uppercase tracking-tighter text-white">
                            {poll.status === 'ACTIVE' ? 'Live' : 'Closed'}
                        </span>
                    </div>
                </div>
                <div className="glass-card p-6">
                    <span className="text-[10px] font-black text-muted uppercase tracking-widest block mb-4">Share Poll</span>
                    <button
                        onClick={() => {
                            navigator.clipboard.writeText(voterLink);
                            setIsCopied(true);
                            setTimeout(() => setIsCopied(false), 2000);
                        }}
                        className="btn btn-primary w-full py-4 flex items-center justify-center gap-2 text-[10px]"
                    >
                        {isCopied ? <CheckCircle2 size={16} /> : <Share2 size={16} />}
                        {isCopied ? 'Link Copied' : 'Copy Invite Link'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="glass-card lg:col-span-2">
                    <h2 className="text-3xl font-black mb-12 leading-tight">{poll.question}</h2>
                    <div className="h-80 mb-12">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData}>
                                <XAxis dataKey="name" stroke="#475569" dy={10} axisLine={false} tickLine={false} style={{ fontWeight: 800, fontSize: '12px', textTransform: 'uppercase' }} />
                                <Bar dataKey="value" radius={[12, 12, 12, 12]} barSize={40}>
                                    {chartData.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {chartData.map((item, i) => (
                            <div key={item.name} className="flex justify-between items-center bg-white/[0.02] border border-white/5 p-5 rounded-2xl hover:bg-white/5 transition-colors">
                                <span className="flex items-center gap-3 font-bold text-sm uppercase">
                                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length], boxShadow: `0 0 10px ${COLORS[i % COLORS.length]}` }} />
                                    {item.name}
                                </span>
                                <span className="font-mono text-primary font-bold text-lg">{item.value}</span>
                            </div>
                        ))}
                    </div>
                </motion.div>

                <div className="space-y-6">
                    <div className="glass-card">
                        <div className="flex items-center gap-3 mb-8 border-b border-white/5 pb-4">
                            <Activity className="text-primary animate-pulse" size={18} />
                            <h3 className="text-xs uppercase tracking-widest">Live Activity</h3>
                        </div>
                        <div className="space-y-3">
                            {kafkaEvents.length === 0 ? (
                                <div className="text-muted text-[10px] italic p-12 text-center border border-dashed border-white/10 rounded-2xl bg-black/20">
                                    Waiting for votes...
                                </div>
                            ) : kafkaEvents.map((ev, i) => (
                                <motion.div key={ev.id + i} initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="kafka-feed-item">
                                    <div className="flex justify-between items-center opacity-60 mb-1.5">
                                        <span className="font-black text-[9px] text-primary tracking-widest">NEW VOTE</span>
                                        <span className="text-[8px]">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-1 h-1 bg-accent rounded-full" />
                                        <span className="truncate text-white font-bold tracking-tight">ID: {ev.id.substring(0, 12)}</span>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </div>

                    {poll.status === 'ACTIVE' && (
                        <button onClick={handleRelease} disabled={releasing} className="btn btn-primary w-full py-6 text-base font-black flex items-center justify-center gap-4 bg-gradient-to-r from-accent to-[#22c55e] shadow-accent/20">
                            {releasing ? 'UPDATING...' : 'SHOW FINAL RESULTS'} <ExternalLink size={20} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- VOTER PAGE ---
const VoterPage = () => {
    const { pollId } = useParams();
    const [poll, setPoll] = useState(null);
    const [voted, setVoted] = useState(false);
    const hasVotedRef = useRef(false);
    const [selectedOption, setSelectedOption] = useState(null);
    const [results, setResults] = useState(null);

    useEffect(() => {
        fetch(`/api/polls/${pollId}`).then(res => res.json()).then(setPoll);

        const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsHost = window.location.hostname === 'localhost' ? 'localhost:5000' : window.location.host;
        const socket = new WebSocket(`${wsProtocol}://${wsHost}/ws?pollId=${pollId}&role=voter`);

        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'RESULTS_RELEASED') {
                setResults(data.votes);
                confetti({
                    particleCount: 200,
                    spread: 120,
                    colors: ['#c084fc', '#f472b6', '#22d3ee']
                });
            }
        };
        return () => socket.close();
    }, [pollId]);

    const handleVote = async (option) => {
        // Senior Logic: Atomic ref check to prevent double-click race conditions
        if (hasVotedRef.current) return;
        hasVotedRef.current = true;

        // Optimistic UI: Update state immediately for <200ms response feel
        setSelectedOption(option);
        setVoted(true);

        // Performance: Non-blocking fetch
        fetch(`/api/polls/${pollId}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ option })
        }).catch(err => {
            // Revert on failure (rare in prod)
            hasVotedRef.current = false;
            setVoted(false);
        });
    };

    if (!poll) return (
        <div className="min-h-[80vh] flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
                <Activity size={32} className="text-secondary animate-spin" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted">Loading...</p>
            </div>
        </div>
    );

    return (
        <div className="container max-w-2xl py-8">
            <AnimatePresence mode="wait">
                {!results ? (
                    <motion.div key="vote" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, y: -40 }} className="glass-card text-center bg-gradient-to-b from-white/[0.03] to-transparent">
                        <div className="flex justify-center mb-8">
                            <div className="px-4 py-1.5 bg-primary/10 border border-primary/20 rounded-full text-[9px] font-black text-primary uppercase tracking-[0.3em] flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-ping" /> Connected
                            </div>
                        </div>
                        <h2 className="text-3xl font-black mb-10 text-white tracking-tight leading-tight">{poll.question}</h2>

                        {!voted ? (
                            <div className="space-y-4">
                                {poll.options.map((opt, i) => (
                                    <motion.button
                                        key={opt}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0, transition: { delay: i * 0.1 } }}
                                        onClick={() => handleVote(opt)}
                                        className="option-card px-8 py-6 group"
                                    >
                                        <span className="font-black text-xl text-white group-hover:text-primary transition-colors">{opt}</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px] font-black opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-widest text-primary">Vote Now</span>
                                            <ChevronRight className="text-white/20 group-hover:text-primary group-hover:translate-x-1 transition-all" />
                                        </div>
                                    </motion.button>
                                ))}
                            </div>
                        ) : (
                            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="py-8 flex flex-col items-center">
                                <div className="w-20 h-20 bg-primary/20 rounded-2xl flex items-center justify-center mb-6 border border-primary/30 rotate-12">
                                    <CheckCircle2 className="text-primary" size={40} />
                                </div>
                                <h2 className="text-4xl font-black text-white mb-2 uppercase tracking-tighter">Vote Received!</h2>
                                <p className="text-xs font-bold text-muted uppercase tracking-[0.4em] mb-8 text-center w-full">Your choice has been counted</p>

                                <div className="inline-flex items-center gap-4 px-6 py-3 bg-black/50 rounded-2xl border border-white/5 font-mono text-[10px] text-accent font-bold uppercase">
                                    <Terminal size={14} /> ID: #{Math.floor(Math.random() * 1000)}
                                </div>
                            </motion.div>
                        )}

                        <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-center gap-3">
                            <Activity size={16} className="text-primary animate-pulse" />
                            <span className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">Secure & Live Data System</span>
                        </div>
                    </motion.div>
                ) : (
                    <motion.div key="results" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} className="glass-card text-center relative overflow-hidden p-10">
                        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-primary via-secondary to-accent" />
                        <h1 className="text-5xl font-black mb-10 uppercase tracking-tighter mt-4"><span className="gradient-text">Final Results</span></h1>

                        <div className="space-y-10 text-left">
                            {Object.entries(results).map(([opt, val], i) => {
                                const total = Object.values(results).reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? (val / total) * 100 : 0;
                                return (
                                    <div key={opt}>
                                        <div className="flex justify-between items-end font-black uppercase mb-3">
                                            <span className="text-sm tracking-widest opacity-60 flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                                                {opt}
                                            </span>
                                            <span className="text-2xl font-black text-white">{pct.toFixed(0)}%</span>
                                        </div>
                                        <div className="h-4 w-full bg-white/5 rounded-full overflow-hidden border border-white/10 p-[2px]">
                                            <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${COLORS[i % COLORS.length]}, #fff)` }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mt-20 pt-10 border-t border-white/5">
                            <p className="text-[10px] text-muted font-bold uppercase tracking-[0.5em] mb-10">Reference ID: {pollId.substring(0, 8)}</p>
                            <Link to="/" className="btn btn-primary w-full py-5 font-black text-sm tracking-[0.2em] shadow-lg">START NEW POLL</Link>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default function App() {
    return (
        <div className="min-h-screen pb-32 selection:bg-primary/30 selection:text-primary">
            <Navbar />
            <Routes>
                <Route path="/" element={<CreatePoll />} />
                <Route path="/owner/:pollId" element={<OwnerDashboard />} />
                <Route path="/poll/:pollId" element={<VoterPage />} />
            </Routes>
        </div>
    );
}
