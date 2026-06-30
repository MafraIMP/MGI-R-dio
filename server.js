const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(__dirname));

let connectedUsers = [];
let bannedIdentities = []; // Lista de banimentos por nome armazenada no servidor
let isDecentralizedGlobal = false;
let isMafraOverrideActive = false; 
let currentMafraTargetDivision = null;
let currentMGIStatusGlobal = "4-7 (Pacificação)";
const activeIPs = new Map();

// ===== ESTADO DO MINI-JOGO (PIQUE-ESCONDE) =====
let gameState = {
    active: false,          // partida rolando?
    phase: 'idle',          // idle | hiding | seeking | results
    seekerId: null,         // id do usuário que é o pegador
    hiders: {},             // { userId: roomNumber } -- quem está em qual sala
    eliminated: [],         // ids eliminados
    attemptsLeft: 7,        // tentativas restantes do pegador
    attackedRooms: []       // salas já atacadas
};

io.on('connection', (socket) => {
    console.log(`[M.G.I NEXUS] Agente conectado ao terminal: ${socket.id}`);

    socket.on('join-network', (userData) => {
        const rawIP = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim()
                   || socket.handshake.address;
        const clientIP = rawIP.replace(/^::ffff:/, '');

        // Extrai e remove o código de auth do payload antes de processar
        const authCode = userData._authCode || '';
        delete userData._authCode;

        // VERIFICAÇÃO IMPERIAL NO SERVIDOR: só aceita role 'imperador' com a senha correta
        if (userData.role === 'imperador' && authCode !== 'm1a2f3r4a5') {
            socket.emit('kicked-from-network');
            return;
        }

        // Bloqueia a conexão e notifica administradores se o nome estiver na lista de banimento
        if (bannedIdentities.includes(userData.name)) {
            socket.emit('banned-from-network-lock');
            io.emit('banned-user-attempt', userData.name);
            return; 
        }

        userData.socketId = socket.id;
        connectedUsers = connectedUsers.filter(u => u.id !== userData.id);
        connectedUsers.push(userData);

        socket.emit('network-users', connectedUsers, {
            decentralized: isDecentralizedGlobal,
            override: isMafraOverrideActive,
            mafraTargetDivision: currentMafraTargetDivision,
            mgiStatus: currentMGIStatusGlobal // <-- LINHA ADICIONADA AQUI
        });
        socket.broadcast.emit('user-joined', userData);
    });

    socket.on('mgi-status-change', (newStatus) => {
        currentMGIStatusGlobal = newStatus;
        socket.broadcast.emit('mgi-status-broadcast', newStatus);
    });

    socket.on('unban-user-request', (name) => {
        bannedIdentities = bannedIdentities.filter(n => n !== name);
        io.emit('unban-success', name);
    });

    socket.on('webrtc-signal', ({ to, signal }) => {
        io.to(to).emit('webrtc-signal', { from: socket.id, signal });
    });

    socket.on('voice-state', (isSpeaking) => {
        socket.broadcast.emit('user-voice-state', { socketId: socket.id, isSpeaking });
    });

    socket.on('muted-chat-msg-send', (payload) => {
        io.emit('muted-chat-msg-broadcast', payload);
    });

    socket.on('mafra-target-division-change', (division) => {
        currentMafraTargetDivision = division;
        socket.broadcast.emit('mafra-target-division-broadcast', division);
    });

    socket.on('leader-ptt-start', () => socket.broadcast.emit('leader-ptt-activated', socket.id));
    socket.on('leader-ptt-stop', () => socket.broadcast.emit('leader-ptt-deactivated', socket.id));

    socket.on('mafra-override-start', () => {
        isMafraOverrideActive = true;
        socket.broadcast.emit('mafra-override-activated');
    });
    
    socket.on('mafra-override-stop', () => {
        isMafraOverrideActive = false;
        socket.broadcast.emit('mafra-override-deactivated');
    });

    socket.on('admin-action-execute', ({ targetId, action }) => {
        const user = connectedUsers.find(u => u.id === targetId);
        if (user) {
            if (action === 'role') {
                if (user.role === 'membro') {
                    let liderAtual = connectedUsers.find(u => u.division === user.division && u.role === 'lider');
                    if (liderAtual) liderAtual.role = 'membro';
                    user.role = 'lider';
                } else {
                    user.role = 'membro';
                }
                io.emit('admin-action-broadcast', { targetId, action });
            } else if (action === 'ban') {
                user.status = user.status === 'banned' ? 'active' : 'banned';
                
                if (user.status === 'banned') {
                    if (!bannedIdentities.includes(user.name)) bannedIdentities.push(user.name);
                } else {
                    bannedIdentities = bannedIdentities.filter(n => n !== user.name);
                }

                io.emit('admin-action-broadcast', { targetId, action });
                
                const targetSocket = io.sockets.sockets.get(user.socketId);
                if (targetSocket && user.status === 'banned') {
                    targetSocket.emit('banned-from-network-lock');
                    targetSocket.disconnect(); // Desconecta para garantir o corte
                }
            } else if (action === 'kick') {
                user.status = 'kicked';
                io.emit('admin-action-broadcast', { targetId, action });
                
                const targetSocket = io.sockets.sockets.get(user.socketId);
                if (targetSocket) {
                    targetSocket.emit('kicked-from-network');
                    targetSocket.disconnect();
                }
                // Libera o IP do mapa para permitir reentrada futura
                for (let [ip, name] of activeIPs.entries()) {
                    if (name === user.name) { activeIPs.delete(ip); break; }
                }
                connectedUsers = connectedUsers.filter(u => u.id !== targetId);
            }
        }
    });

    socket.on('change-division', ({ targetId, newDivision }) => {
        const user = connectedUsers.find(u => u.id === targetId);
        if (user) {
            user.division = newDivision;
            io.emit('division-changed', { targetId, newDivision });
        }
    });

    socket.on('toggle-command-room', (inCommandRoom) => {
        const user = connectedUsers.find(u => u.socketId === socket.id);
        if (user) {
            user.inCommandRoom = inCommandRoom;
            socket.broadcast.emit('user-command-room-updated', { socketId: socket.id, inCommandRoom });
        }
    });

    socket.on('decentralize-network-execute', (status) => {
        isDecentralizedGlobal = status;
        socket.broadcast.emit('decentralize-network-broadcast', status);
    });

    // ===== EVENTOS DO MINI-JOGO (PIQUE-ESCONDE) =====

    socket.on('game-start-request', () => {
        if (gameState.active) return; // já tem partida rolando

        const eligiblePlayers = connectedUsers.filter(u => u.status !== 'banned' && u.status !== 'kicked');
        if (eligiblePlayers.length < 2) {
            socket.emit('game-error', 'É necessário pelo menos 2 jogadores conectados.');
            return;
        }

        // Pegador escolhido aleatoriamente
        const seeker = eligiblePlayers[Math.floor(Math.random() * eligiblePlayers.length)];

        gameState = {
            active: true,
            phase: 'hiding',
            seekerId: seeker.id,
            hiders: {},
            eliminated: [],
            attemptsLeft: 7,
            attackedRooms: []
        };

        io.emit('game-started', { seekerId: seeker.id, seekerName: seeker.name, players: eligiblePlayers });
    });

    socket.on('game-hide-in-room', (roomNumber) => {
        if (!gameState.active || gameState.phase !== 'hiding') return;
        const user = connectedUsers.find(u => u.socketId === socket.id);
        if (!user || user.id === gameState.seekerId) return;

        gameState.hiders[user.id] = roomNumber;
        io.emit('game-player-hidden', { userId: user.id, userName: user.name, roomNumber });
    });

    socket.on('game-seeker-ready', () => {
        if (!gameState.active || gameState.phase !== 'hiding') return;
        const user = connectedUsers.find(u => u.socketId === socket.id);
        if (!user || user.id !== gameState.seekerId) return;

        gameState.phase = 'seeking';
        io.emit('game-phase-seeking', { hidersCount: Object.keys(gameState.hiders).length });
    });

    socket.on('game-seeker-move', (position) => {
        if (!gameState.active || gameState.phase !== 'seeking') return;
        const user = connectedUsers.find(u => u.socketId === socket.id);
        if (!user || user.id !== gameState.seekerId) return;

        socket.broadcast.emit('game-seeker-position', position);
    });

    socket.on('game-attack-room', (roomNumber) => {
        if (!gameState.active || gameState.phase !== 'seeking') return;
        const user = connectedUsers.find(u => u.socketId === socket.id);
        if (!user || user.id !== gameState.seekerId) return;
        if (gameState.attemptsLeft <= 0) return;
        if (gameState.attackedRooms.includes(roomNumber)) return;

        gameState.attackedRooms.push(roomNumber);
        gameState.attemptsLeft--;

        const foundIds = Object.keys(gameState.hiders).filter(uid => gameState.hiders[uid] === roomNumber && !gameState.eliminated.includes(uid));
        const foundPlayers = foundIds.map(uid => {
            const u = connectedUsers.find(c => c.id === uid);
            gameState.eliminated.push(uid);
            return { id: uid, name: u ? u.name : 'Desconhecido' };
        });

        io.emit('game-room-attacked', {
            roomNumber,
            foundPlayers,
            attemptsLeft: gameState.attemptsLeft
        });

        const totalHiders = Object.keys(gameState.hiders).length;
        const allEliminated = gameState.eliminated.length >= totalHiders;
        const noAttemptsLeft = gameState.attemptsLeft <= 0;

        if (allEliminated || noAttemptsLeft) {
            endGameAndShowPodium();
        }
    });

    socket.on('game-stop-request', () => {
        if (!gameState.active) return;
        endGameAndShowPodium();
    });

    function endGameAndShowPodium() {
        const survivors = Object.keys(gameState.hiders)
            .filter(uid => !gameState.eliminated.includes(uid))
            .map(uid => {
                const u = connectedUsers.find(c => c.id === uid);
                return { id: uid, name: u ? u.name : 'Desconhecido' };
            });

        gameState.phase = 'results';
        io.emit('game-ended', { survivors, eliminatedCount: gameState.eliminated.length });

        gameState.active = false;
        gameState.phase = 'idle';
    }

    socket.on('disconnect', () => {
        connectedUsers = connectedUsers.filter(u => u.socketId !== socket.id);
        io.emit('user-left', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` M.G.I // NEXUS DE COMUNICAÇÃO SUPREMO ATIVO      `);
    console.log(` Endereço Local: http://localhost:${PORT}          `);
    console.log(`==================================================`);
});