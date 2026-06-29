const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Servir os arquivos estáticos da pasta atual
app.use(express.static(__dirname));

let connectedUsers = [];
let isDecentralizedGlobal = false;

io.on('connection', (socket) => {
    console.log(`[M.G.I NEXUS] Agente conectado ao terminal: ${socket.id}`);

    // Quando um novo agente faz login com sucesso
    socket.on('join-network', (userData) => {
        userData.socketId = socket.id;
        
        // Evita registros duplicados na mesma sessão
        connectedUsers = connectedUsers.filter(u => u.id !== userData.id);
        connectedUsers.push(userData);

        // Retorna a lista atual de usuários ativos e o estado da rede para o novo usuário
        socket.emit('network-users', connectedUsers, isDecentralizedGlobal);
        
        // Avisa os demais agentes sobre a chegada do novo membro
        socket.broadcast.emit('user-joined', userData);
    });

    // Canalizadores de Sinalização WebRTC (Troca de Offers, Answers e ICE Candidates)
    socket.on('webrtc-signal', ({ to, signal }) => {
        io.to(to).emit('webrtc-signal', { from: socket.id, signal });
    });

    // Retransmite o estado de fala (Pulsar do microfone por VAD)
    socket.on('voice-state', (isSpeaking) => {
        socket.broadcast.emit('user-voice-state', { socketId: socket.id, isSpeaking });
    });

    // Sincroniza ações administrativas (Promover, Banir, Expulsar) executadas pelo Imperador
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
        io.emit('admin-action-broadcast', { targetId, action });
    });

    // Sincroniza a descentralização global da rede de comunicação
    socket.on('decentralize-network-execute', (status) => {
        isDecentralizedGlobal = status;
        socket.broadcast.emit('decentralize-network-broadcast', status);
    });

    // Tratamento de desconexão de agentes
    socket.on('disconnect', () => {
        const disconnectedUser = connectedUsers.find(u => u.socketId === socket.id);
        if (disconnectedUser) {
            console.log(`[M.G.I NEXUS] Agente desconectado: ${disconnectedUser.name}`);
        }
        connectedUsers = connectedUsers.filter(u => u.socketId !== socket.id);
        io.emit('user-left', socket.id);
    });
});

// Porta padrão para o servidor rodar localmente ou em nuvem
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` M.G.I // NEXUS DE COMUNICAÇÃO SUPREMO ATIVO      `);
    console.log(` Endereço Local: http://localhost:${PORT}          `);
    console.log(`==================================================`);
});