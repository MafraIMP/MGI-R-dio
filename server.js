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

io.on('connection', (socket) => {
    console.log(`[M.G.I NEXUS] Agente conectado ao terminal: ${socket.id}`);

    socket.on('join-network', (userData) => {
        const clientIP = socket.handshake.address;

        // SISTEMA ANTI-ALT ACCOUNTS (BLOQUEIO POR IP)
        if (activeIPs.has(clientIP)) {
            const registeredName = activeIPs.get(clientIP);
            // Se o IP tentar usar um nome diferente do primeiro que ele registrou...
            if (registeredName !== userData.name) {
                socket.emit('kicked-from-network'); // Expulsa sumariamente
                return; 
            }
        } else {
            // Registra o IP e o nome no banco temporário
            activeIPs.set(clientIP, userData.name);
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
                connectedUsers = connectedUsers.filter(u => u.id !== targetId);
            }
        }
    });

    socket.on('decentralize-network-execute', (status) => {
        isDecentralizedGlobal = status;
        socket.broadcast.emit('decentralize-network-broadcast', status);
    });

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