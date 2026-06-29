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
let isDecentralizedGlobal = false;
let isMafraOverrideActive = false; 
let currentMafraTargetDivision = null;

io.on('connection', (socket) => {
    console.log(`[M.G.I NEXUS] Agente conectado ao terminal: ${socket.id}`);

    socket.on('join-network', (userData) => {
        userData.socketId = socket.id;
        connectedUsers = connectedUsers.filter(u => u.id !== userData.id);
        connectedUsers.push(userData);

        // Envia o estado atual da rede para quem acabou de entrar
        socket.emit('network-users', connectedUsers, {
            decentralized: isDecentralizedGlobal,
            override: isMafraOverrideActive,
            mafraTargetDivision: currentMafraTargetDivision
        });
        socket.broadcast.emit('user-joined', userData);
    });

    socket.on('webrtc-signal', ({ to, signal }) => {
        io.to(to).emit('webrtc-signal', { from: socket.id, signal });
    });

    socket.on('voice-state', (isSpeaking) => {
        socket.broadcast.emit('user-voice-state', { socketId: socket.id, isSpeaking });
    });

    // TRANSMISSÃO TEXTUAL COORDENADA
    socket.on('muted-chat-msg-send', (payload) => {
        io.emit('muted-chat-msg-broadcast', payload);
    });

    // MAFRA DIVISION PODERES SINK
    socket.on('mafra-target-division-change', (division) => {
        currentMafraTargetDivision = division;
        socket.broadcast.emit('mafra-target-division-broadcast', division);
    });

    // PTT LÍDERES
    socket.on('leader-ptt-start', () => socket.broadcast.emit('leader-ptt-activated', socket.id));
    socket.on('leader-ptt-stop', () => socket.broadcast.emit('leader-ptt-deactivated', socket.id));

    // OVERRIDE MAFRAINF (CRÍTICO)
    socket.on('mafra-override-start', () => {
        isMafraOverrideActive = true;
        socket.broadcast.emit('mafra-override-activated');
    });
    
    socket.on('mafra-override-stop', () => {
        isMafraOverrideActive = false;
        socket.broadcast.emit('mafra-override-deactivated');
    });

    // CONTROLE ADMINISTRATIVO RIGOROSO
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
                io.emit('admin-action-broadcast', { targetId, action });
                
                // EXECUTA O CORTE EM TEMPO REAL E DISPARA EMISSÃO DE TRAVA FÍSICA NO CODIGO CLIENTE
                const targetSocket = io.sockets.sockets.get(user.socketId);
                if (targetSocket && user.status === 'banned') {
                    targetSocket.emit('banned-from-network-lock');
                    targetSocket.disconnect();
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