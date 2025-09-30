const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const os = require('os');
require('dotenv').config();

// Import database functions
const { db, testConnection, initializeTables } = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API Routes
app.get('/api/stats', async (req, res) => {
    try {
        const onlineUsers = await db.getOnlineUsers();
        const activeGames = await db.getActiveChessGames();
        const recentMessages = await db.getRecentMessages(10);
        
        res.json({
            onlineUsers: onlineUsers.length,
            activeGames: activeGames.length,
            recentMessages: recentMessages.length,
            games: activeGames
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

app.get('/api/messages', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const messages = await db.getRecentMessages(limit);
        res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

app.get('/api/games', async (req, res) => {
    try {
        const games = await db.getActiveChessGames();
        res.json(games);
    } catch (error) {
        console.error('Error fetching games:', error);
        res.status(500).json({ error: 'Failed to fetch games' });
    }
});

// Enhanced chat API endpoints
app.get('/api/search', async (req, res) => {
    try {
        const { q: searchTerm, username, limit = 50 } = req.query;
        
        if (!searchTerm) {
            return res.status(400).json({ error: 'Search term is required' });
        }
        
        const messages = await db.searchMessages(searchTerm, username, parseInt(limit));
        res.json(messages);
    } catch (error) {
        console.error('Error searching messages:', error);
        res.status(500).json({ error: 'Failed to search messages' });
    }
});

app.get('/api/private-messages/:username1/:username2', async (req, res) => {
    try {
        const { username1, username2 } = req.params;
        const { limit = 50 } = req.query;
        
        const messages = await db.getPrivateMessages(username1, username2, parseInt(limit));
        res.json(messages);
    } catch (error) {
        console.error('Error fetching private messages:', error);
        res.status(500).json({ error: 'Failed to fetch private messages' });
    }
});

app.get('/api/message-stats', async (req, res) => {
    try {
        const stats = await db.getMessageStats();
        res.json(stats);
    } catch (error) {
        console.error('Error fetching message stats:', error);
        res.status(500).json({ error: 'Failed to fetch message statistics' });
    }
});

app.delete('/api/messages/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { username } = req.body;
        
        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }
        
        const deletedMessage = await db.deleteMessage(messageId, username);
        
        if (!deletedMessage) {
            return res.status(404).json({ error: 'Message not found or unauthorized' });
        }
        
        // Notify all clients about message deletion
        io.emit('message deleted', { messageId });
        
        res.json({ success: true, deletedMessage });
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

// In-memory storage for active connections (will be replaced with database sessions)
const activeUsers = new Map(); // socketId -> username
const chessGames = new Map(); // gameId -> game state (for active games)

// Handle socket connections
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle user joining
    socket.on('join', async (username) => {
        try {
            // Check if user exists, create if not
            let user = await db.getUserByUsername(username);
            if (!user) {
                user = await db.createUser(username);
            }
            
            // Store active connection
            activeUsers.set(socket.id, username);
            
            // Update user online status
            await db.updateUserOnlineStatus(username, true);
            
            // Broadcast user joined message
            socket.broadcast.emit('user joined', {
                username: username,
                message: `${username} joined the chat`,
                timestamp: new Date().toLocaleTimeString()
            });
            
            // Send recent messages to the new user
            const recentMessages = await db.getRecentMessages(50);
            socket.emit('message history', recentMessages);
            
            // Send current users list
            const usersList = await db.getOnlineUsers();
            socket.emit('users list', usersList);
            
            // Broadcast updated users list to all clients
            io.emit('update users', usersList);
            
        } catch (error) {
            console.error('Error handling user join:', error);
            socket.emit('error', { message: 'Failed to join chat' });
        }
    });

    // Handle chat messages
    socket.on('chat message', async (data) => {
        const username = activeUsers.get(socket.id);
        if (username) {
            try {
                const savedMessage = await db.saveMessage({
                    username: username,
                    message: data.message,
                    messageType: 'text'
                });
                
                const messageData = {
                    id: savedMessage.id,
                    username: username,
                    message: data.message,
                    timestamp: new Date(savedMessage.created_at).toLocaleTimeString(),
                    reactions: savedMessage.reactions || {},
                    type: 'text'
                };
                
                io.emit('chat message', messageData);
            } catch (error) {
                console.error('Error saving message:', error);
            }
        }
    });

    // Handle private messages
    socket.on('private message', async (data) => {
        const senderUsername = activeUsers.get(socket.id);
        if (senderUsername) {
            try {
                const targetSocketId = Array.from(activeUsers.entries())
                    .find(([id, username]) => username === data.targetUsername)?.[0];
                
                if (targetSocketId) {
                    const savedMessage = await db.saveMessage({
                        username: senderUsername,
                        message: data.message,
                        messageType: 'private',
                        isPrivate: true,
                        targetUsername: data.targetUsername
                    });
                    
                    const messageData = {
                        id: savedMessage.id,
                        from: senderUsername,
                        to: data.targetUsername,
                        message: data.message,
                        timestamp: new Date(savedMessage.created_at).toLocaleTimeString(),
                        type: 'private'
                    };
                    
                    // Send to both sender and receiver
                    socket.emit('private message', messageData);
                    socket.to(targetSocketId).emit('private message', messageData);
                }
            } catch (error) {
                console.error('Error saving private message:', error);
            }
        }
    });

    // Handle message reactions
    socket.on('message reaction', async (data) => {
        const username = activeUsers.get(socket.id);
        if (username) {
            try {
                // This is a simplified version - in production you'd want to fetch the current reactions first
                const reactions = data.reactions || {};
                if (!reactions[data.reaction]) {
                    reactions[data.reaction] = [];
                }
                
                const userIndex = reactions[data.reaction].indexOf(username);
                if (userIndex > -1) {
                    reactions[data.reaction].splice(userIndex, 1);
                } else {
                    reactions[data.reaction].push(username);
                }
                
                await db.updateMessageReactions(data.messageId, reactions);
                
                io.emit('message reaction update', {
                    messageId: data.messageId,
                    reactions: reactions
                });
            } catch (error) {
                console.error('Error updating message reactions:', error);
            }
        }
    });

    // Handle file uploads
    socket.on('file message', async (data) => {
        const username = activeUsers.get(socket.id);
        if (username) {
            try {
                const savedMessage = await db.saveMessage({
                    username: username,
                    message: `Shared a file: ${data.fileName}`,
                    messageType: 'file',
                    fileName: data.fileName,
                    fileData: data.fileData,
                    fileType: data.fileType
                });
                
                const messageData = {
                    id: savedMessage.id,
                    username: username,
                    fileName: data.fileName,
                    fileData: data.fileData,
                    fileType: data.fileType,
                    timestamp: new Date(savedMessage.created_at).toLocaleTimeString(),
                    reactions: savedMessage.reactions || {},
                    type: 'file'
                };
                
                io.emit('file message', messageData);
            } catch (error) {
                console.error('Error saving file message:', error);
            }
        }
    });

    // Chess game handlers
    socket.on('chess invite', (data) => {
        const inviterUsername = activeUsers.get(socket.id);
        const targetSocketId = Array.from(activeUsers.entries())
            .find(([id, username]) => username === data.targetUsername)?.[0];
        
        if (targetSocketId && inviterUsername) {
            socket.to(targetSocketId).emit('chess invite received', {
                from: inviterUsername,
                gameId: data.gameId
            });
        }
    });

    socket.on('chess invite response', async (data) => {
        const responderUsername = activeUsers.get(socket.id);
        const inviterSocketId = Array.from(activeUsers.entries())
            .find(([id, username]) => username === data.inviterUsername)?.[0];
        
        if (data.accepted && responderUsername && inviterSocketId) {
            try {
                // Create new chess game
                const gameState = createNewChessGame(data.inviterUsername, responderUsername);
                
                // Save to database
                await db.createChessGame({
                    gameId: data.gameId,
                    whitePlayer: data.inviterUsername,
                    blackPlayer: responderUsername,
                    boardState: gameState.board
                });
                
                // Store in memory for active game
                chessGames.set(data.gameId, gameState);
                
                // Notify both players
                io.to(socket.id).emit('chess game started', { gameId: data.gameId, gameState });
                io.to(inviterSocketId).emit('chess game started', { gameId: data.gameId, gameState });
                
                // Save system message to database
                await db.saveMessage({
                    username: 'System',
                    message: `🎯 Chess game started between ${data.inviterUsername} and ${responderUsername}`,
                    messageType: 'system'
                });
                
                // Broadcast system message
                const gameMessage = {
                    id: Date.now() + Math.random(),
                    message: `🎯 Chess game started between ${data.inviterUsername} and ${responderUsername}`,
                    timestamp: new Date().toLocaleTimeString(),
                    type: 'chess_start'
                };
                io.emit('chess game message', gameMessage);
            } catch (error) {
                console.error('Error creating chess game:', error);
            }
        } else if (inviterSocketId) {
            socket.to(inviterSocketId).emit('chess invite declined', {
                from: responderUsername
            });
        }
    });

    socket.on('chess move', async (data) => {
        const game = chessGames.get(data.gameId);
        const playerUsername = activeUsers.get(socket.id);
        
        if (game && playerUsername) {
            // Validate it's the player's turn
            if ((game.currentTurn === 'white' && game.whitePlayer === playerUsername) ||
                (game.currentTurn === 'black' && game.blackPlayer === playerUsername)) {
                
                // Validate and make the move
                if (isValidMove(game, data.from, data.to)) {
                    makeMove(game, data.from, data.to);
                    
                    // Switch turns
                    game.currentTurn = game.currentTurn === 'white' ? 'black' : 'white';
                    
                    try {
                        // Update game in database
                        await db.updateChessGame(data.gameId, {
                            currentTurn: game.currentTurn,
                            boardState: game.board,
                            gameStatus: game.gameStatus,
                            moveHistory: game.moveHistory,
                            winner: game.winner
                        });
                        
                        // Update in-memory game state
                        chessGames.set(data.gameId, game);
                        
                        // Notify both players
                        const whiteSocketId = Array.from(activeUsers.entries())
                            .find(([id, username]) => username === game.whitePlayer)?.[0];
                        const blackSocketId = Array.from(activeUsers.entries())
                            .find(([id, username]) => username === game.blackPlayer)?.[0];
                        
                        if (whiteSocketId) io.to(whiteSocketId).emit('chess move made', { gameId: data.gameId, gameState: game });
                        if (blackSocketId) io.to(blackSocketId).emit('chess move made', { gameId: data.gameId, gameState: game });
                        
                        // Check for game end conditions
                        checkGameEnd(game, data.gameId);
                    } catch (error) {
                        console.error('Error updating chess game:', error);
                    }
                }
            }
        }
    });

    // Handle typing indicator
    socket.on('typing', (data) => {
        const username = activeUsers.get(socket.id);
        if (username) {
            socket.broadcast.emit('typing', {
                username: username,
                isTyping: data.isTyping
            });
        }
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
        const username = activeUsers.get(socket.id);
        if (username) {
            try {
                // Remove from active users
                activeUsers.delete(socket.id);
                
                // Update user offline status in database
                await db.updateUserOnlineStatus(username, false);
                
                // Broadcast user left message
                socket.broadcast.emit('user left', {
                    username: username,
                    message: `${username} left the chat`,
                    timestamp: new Date().toLocaleTimeString()
                });
                
                // Broadcast updated users list
                const usersList = await db.getOnlineUsers();
                io.emit('update users', usersList);
            } catch (error) {
                console.error('Error handling user disconnect:', error);
            }
        }
        console.log('User disconnected:', socket.id);
    });
});

// Chess game logic functions
function createNewChessGame(whitePlayer, blackPlayer) {
    return {
        whitePlayer,
        blackPlayer,
        currentTurn: 'white',
        board: [
            ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
            ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
            ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
        ],
        gameStatus: 'active',
        moveHistory: []
    };
}

function isValidMove(game, from, to) {
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    
    // Basic bounds checking
    if (fromRow < 0 || fromRow > 7 || fromCol < 0 || fromCol > 7 ||
        toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) {
        return false;
    }
    
    const piece = game.board[fromRow][fromCol];
    if (!piece) return false;
    
    // Check if piece belongs to current player
    const isWhitePiece = piece === piece.toUpperCase();
    if ((game.currentTurn === 'white' && !isWhitePiece) ||
        (game.currentTurn === 'black' && isWhitePiece)) {
        return false;
    }
    
    // Basic piece movement validation (simplified)
    const targetPiece = game.board[toRow][toCol];
    
    // Can't capture own piece
    if (targetPiece) {
        const isTargetWhite = targetPiece === targetPiece.toUpperCase();
        if (isWhitePiece === isTargetWhite) return false;
    }
    
    // Simplified movement rules for each piece type
    const pieceType = piece.toLowerCase();
    const rowDiff = Math.abs(toRow - fromRow);
    const colDiff = Math.abs(toCol - fromCol);
    
    switch (pieceType) {
        case 'p': // Pawn
            const direction = isWhitePiece ? -1 : 1;
            const startRow = isWhitePiece ? 6 : 1;
            
            if (fromCol === toCol) { // Moving forward
                if (toRow === fromRow + direction && !targetPiece) return true;
                if (fromRow === startRow && toRow === fromRow + 2 * direction && !targetPiece) return true;
            } else if (colDiff === 1 && toRow === fromRow + direction && targetPiece) {
                return true; // Diagonal capture
            }
            return false;
            
        case 'r': // Rook
            return (rowDiff === 0 || colDiff === 0) && isPathClear(game.board, from, to);
            
        case 'n': // Knight
            return (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2);
            
        case 'b': // Bishop
            return rowDiff === colDiff && isPathClear(game.board, from, to);
            
        case 'q': // Queen
            return ((rowDiff === 0 || colDiff === 0) || (rowDiff === colDiff)) && isPathClear(game.board, from, to);
            
        case 'k': // King
            return rowDiff <= 1 && colDiff <= 1;
            
        default:
            return false;
    }
}

function isPathClear(board, from, to) {
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    
    const rowStep = toRow > fromRow ? 1 : toRow < fromRow ? -1 : 0;
    const colStep = toCol > fromCol ? 1 : toCol < fromCol ? -1 : 0;
    
    let currentRow = fromRow + rowStep;
    let currentCol = fromCol + colStep;
    
    while (currentRow !== toRow || currentCol !== toCol) {
        if (board[currentRow][currentCol] !== null) return false;
        currentRow += rowStep;
        currentCol += colStep;
    }
    
    return true;
}

function makeMove(game, from, to) {
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    
    const piece = game.board[fromRow][fromCol];
    const capturedPiece = game.board[toRow][toCol];
    
    // Make the move
    game.board[toRow][toCol] = piece;
    game.board[fromRow][fromCol] = null;
    
    // Record move in history
    game.moveHistory.push({
        from,
        to,
        piece,
        capturedPiece,
        timestamp: new Date().toISOString()
    });
}

function checkGameEnd(game, gameId) {
    // Simplified game end detection
    let whiteKing = false, blackKing = false;
    
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const piece = game.board[row][col];
            if (piece === 'K') whiteKing = true;
            if (piece === 'k') blackKing = true;
        }
    }
    
    if (!whiteKing) {
        game.gameStatus = 'black_wins';
        io.emit('chess game ended', { gameId, winner: game.blackPlayer, reason: 'checkmate' });
    } else if (!blackKing) {
        game.gameStatus = 'white_wins';
        io.emit('chess game ended', { gameId, winner: game.whitePlayer, reason: 'checkmate' });
    }
}

// Get local IP address for mobile access
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const interface of interfaces[name]) {
            if (interface.family === 'IPv4' && !interface.internal) {
                return interface.address;
            }
        }
    }
    return 'localhost';
}

// Initialize database and start server
async function startServer() {
    try {
        // Test database connection
        await testConnection();
        
        // Initialize database tables
        await initializeTables();
        
        // Start the server
        server.listen(PORT, '0.0.0.0', () => {
            const localIP = getLocalIP();
            console.log(`🚀 Chat server running on http://localhost:${PORT}`);
            console.log(`📱 Mobile access: http://${localIP}:${PORT}`);
            console.log(`🌐 Network access: http://0.0.0.0:${PORT}`);
            console.log(`💾 Database: Connected to Supabase PostgreSQL`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
