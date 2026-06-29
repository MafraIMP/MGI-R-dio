const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(__dirname));

let connectedUsers = [];
let isDecentralizedGlobal = false;

io.on('connection', (socket) => {
    console.log(`[M.G.I NEXUS] Agente conectado ao terminal: ${socket.id}`);

    socket.on('join-network', (userData) => {
        userData.socketId = socket.id;
        connectedUsers = connectedUsers.filter(u => u.id !== userData.id);
        connectedUsers.push(userData);

        socket.emit('network-users', connectedUsers, isDecentralizedGlobal);
        socket.broadcast.emit('user-joined', userData);
    });

    socket.on('webrtc-signal', ({ to, signal }) => {
        io.to(to).emit('webrtc-signal', { from: socket.id, signal });
    });

    socket.on('voice-state', (isSpeaking) => {
        socket.broadcast.emit('user-voice-state', { socketId: socket.id, isSpeaking });
    });

    // CORRIGIDO: Agora usa socket.broadcast.emit para não causar efeito bumerangue no Imperador
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
            } else if (action === 'ban') {
                user.status = user.status === 'banned' ? 'active' : 'banned';
            } else if (action === 'kick') {
                user.status = 'kicked';
            }
        }
        socket.broadcast.emit('admin-action-broadcast', { targetId, action });
    });

    socket.on('decentralize-network-execute', (status) => {
        isDecentralizedGlobal = status;
        socket.broadcast.emit('decentralize-network-broadcast', status);
    });

    socket.on('disconnect', () => {
        const disconnectedUser = connectedUsers.find(u => u.socketId === socket.id);
        if (disconnectedUser) {
            console.log(`[M.G.I NEXUS] Agente desconectado: ${disconnectedUser.name}`);
        }
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