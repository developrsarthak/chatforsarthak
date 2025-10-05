const { Pool } = require('pg');
require('dotenv').config();

// Create PostgreSQL connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test database connection
async function testConnection() {
    try {
        const client = await pool.connect();
        console.log('✅ Connected to Supabase PostgreSQL database');
        client.release();
    } catch (err) {
        console.error('❌ Database connection error:', err);
    }
}

// Initialize database tables
async function initializeTables() {
    const client = await pool.connect();
    
    try {
        // Users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100),
                password_hash VARCHAR(255),
                avatar_url TEXT,
                is_online BOOLEAN DEFAULT false,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Messages table
        await client.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                username VARCHAR(50) NOT NULL,
                message TEXT NOT NULL,
                message_type VARCHAR(20) DEFAULT 'text',
                file_name VARCHAR(255),
                file_data TEXT,
                file_type VARCHAR(50),
                is_private BOOLEAN DEFAULT false,
                target_username VARCHAR(50),
                reactions JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Chess games table
        await client.query(`
            CREATE TABLE IF NOT EXISTS chess_games (
                id SERIAL PRIMARY KEY,
                game_id VARCHAR(100) UNIQUE NOT NULL,
                white_player_id INTEGER REFERENCES users(id),
                black_player_id INTEGER REFERENCES users(id),
                white_player VARCHAR(50) NOT NULL,
                black_player VARCHAR(50) NOT NULL,
                current_turn VARCHAR(10) DEFAULT 'white',
                board_state JSONB NOT NULL,
                game_status VARCHAR(20) DEFAULT 'active',
                move_history JSONB DEFAULT '[]',
                winner VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // User sessions table (for socket management)
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                socket_id VARCHAR(100) NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Social: posts table
        await client.query(`
            CREATE TABLE IF NOT EXISTS posts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                username VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                like_count INTEGER DEFAULT 0,
                comment_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Social: comments table
        await client.query(`
            CREATE TABLE IF NOT EXISTS comments (
                id SERIAL PRIMARY KEY,
                post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                username VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Social: post likes table
        await client.query(`
            CREATE TABLE IF NOT EXISTS post_likes (
                id SERIAL PRIMARY KEY,
                post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(post_id, user_id)
            )
        `);

        // Social: follows table
        await client.query(`
            CREATE TABLE IF NOT EXISTS follows (
                follower_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                following_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (follower_id, following_id)
            )
        `);

        // Create indexes for better performance
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_messages_username ON messages(username);
            CREATE INDEX IF NOT EXISTS idx_chess_games_players ON chess_games(white_player, black_player);
            CREATE INDEX IF NOT EXISTS idx_user_sessions_socket ON user_sessions(socket_id);
            CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
            CREATE INDEX IF NOT EXISTS idx_comments_post_id_created_at ON comments(post_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes(post_id);
            CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
            CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
        `);

        console.log('✅ Database tables initialized successfully');
        
    } catch (err) {
        console.error('❌ Error initializing tables:', err);
    } finally {
        client.release();
    }
}

// Database query functions
const db = {
    // User operations
    async createUser(username, email = null, passwordHash = null) {
        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
            [username, email, passwordHash]
        );
        return result.rows[0];
    },

    async getUserByUsername(username) {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        return result.rows[0];
    },

    async updateUserOnlineStatus(username, isOnline) {
        await pool.query(
            'UPDATE users SET is_online = $1, last_seen = CURRENT_TIMESTAMP WHERE username = $2',
            [isOnline, username]
        );
    },

    async getOnlineUsers() {
        const result = await pool.query('SELECT username FROM users WHERE is_online = true ORDER BY username');
        return result.rows.map(row => row.username);
    },

    // Message operations
    async saveMessage(messageData) {
        const { username, message, messageType = 'text', fileName = null, fileData = null, fileType = null, isPrivate = false, targetUsername = null } = messageData;
        
        const result = await pool.query(`
            INSERT INTO messages (username, message, message_type, file_name, file_data, file_type, is_private, target_username)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
        `, [username, message, messageType, fileName, fileData, fileType, isPrivate, targetUsername]);
        
        return result.rows[0];
    },

    async getRecentMessages(limit = 50) {
        const result = await pool.query(`
            SELECT * FROM messages 
            WHERE is_private = false 
            ORDER BY created_at DESC 
            LIMIT $1
        `, [limit]);
        return result.rows.reverse();
    },

    async getPrivateMessages(username1, username2, limit = 50) {
        const result = await pool.query(`
            SELECT * FROM messages 
            WHERE is_private = true 
            AND ((username = $1 AND target_username = $2) OR (username = $2 AND target_username = $1))
            ORDER BY created_at DESC 
            LIMIT $3
        `, [username1, username2, limit]);
        return result.rows.reverse();
    },

    async searchMessages(searchTerm, username = null, limit = 50) {
        let query = `
            SELECT * FROM messages 
            WHERE is_private = false 
            AND message ILIKE $1
        `;
        let params = [`%${searchTerm}%`];
        
        if (username) {
            query += ` AND username = $2`;
            params.push(username);
        }
        
        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        
        const result = await pool.query(query, params);
        return result.rows;
    },

    async getMessageById(messageId) {
        const result = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
        return result.rows[0];
    },

    async updateMessageReactions(messageId, reactions) {
        await pool.query(
            'UPDATE messages SET reactions = $1 WHERE id = $2',
            [JSON.stringify(reactions), messageId]
        );
    },

    async deleteMessage(messageId, username) {
        const result = await pool.query(
            'DELETE FROM messages WHERE id = $1 AND username = $2 RETURNING *',
            [messageId, username]
        );
        return result.rows[0];
    },

    async getMessageStats() {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_messages,
                COUNT(DISTINCT username) as active_users,
                COUNT(CASE WHEN message_type = 'file' THEN 1 END) as file_messages,
                COUNT(CASE WHEN is_private = true THEN 1 END) as private_messages
            FROM messages
            WHERE created_at >= NOW() - INTERVAL '24 hours'
        `);
        return result.rows[0];
    },

    // Chess game operations
    async createChessGame(gameData) {
        const { gameId, whitePlayer, blackPlayer, boardState } = gameData;
        
        const result = await pool.query(`
            INSERT INTO chess_games (game_id, white_player, black_player, board_state)
            VALUES ($1, $2, $3, $4) RETURNING *
        `, [gameId, whitePlayer, blackPlayer, JSON.stringify(boardState)]);
        
        return result.rows[0];
    },

    async getChessGame(gameId) {
        const result = await pool.query('SELECT * FROM chess_games WHERE game_id = $1', [gameId]);
        if (result.rows[0]) {
            const game = result.rows[0];
            game.board_state = JSON.parse(game.board_state);
            game.move_history = JSON.parse(game.move_history || '[]');
        }
        return result.rows[0];
    },

    async updateChessGame(gameId, gameData) {
        const { currentTurn, boardState, gameStatus, moveHistory, winner } = gameData;
        
        await pool.query(`
            UPDATE chess_games 
            SET current_turn = $1, board_state = $2, game_status = $3, move_history = $4, winner = $5, updated_at = CURRENT_TIMESTAMP
            WHERE game_id = $6
        `, [currentTurn, JSON.stringify(boardState), gameStatus, JSON.stringify(moveHistory), winner, gameId]);
    },

    async getActiveChessGames() {
        const result = await pool.query(`
            SELECT game_id, white_player, black_player, current_turn, created_at 
            FROM chess_games 
            WHERE game_status = 'active' 
            ORDER BY created_at DESC
        `);
        return result.rows;
    },

    // Session management
    async createSession(userId, socketId) {
        await pool.query(
            'INSERT INTO user_sessions (user_id, socket_id) VALUES ($1, $2)',
            [userId, socketId]
        );
    },

    async removeSession(socketId) {
        await pool.query('DELETE FROM user_sessions WHERE socket_id = $1', [socketId]);
    },

    // Social: Posts
    async createPost({ username, content }) {
        const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        const user = userResult.rows[0];
        if (!user) throw new Error('User not found');
        const result = await pool.query(
            `INSERT INTO posts (user_id, username, content) VALUES ($1, $2, $3) RETURNING *`,
            [user.id, username, content]
        );
        return result.rows[0];
    },

    async getPostById(postId) {
        const result = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
        return result.rows[0];
    },

    async deletePost(postId, username) {
        const result = await pool.query('DELETE FROM posts WHERE id = $1 AND username = $2 RETURNING *', [postId, username]);
        return result.rows[0];
    },

    async getUserPosts(username, limit = 20, beforeId = null) {
        let query = `SELECT * FROM posts WHERE username = $1`;
        const params = [username];
        if (beforeId) {
            query += ` AND id < $2`;
            params.push(beforeId);
        }
        query += ` ORDER BY id DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        const result = await pool.query(query, params);
        return result.rows;
    },

    async getFeedForUser(username, limit = 30, beforeId = null) {
        // Feed = posts by self + users they follow
        const params = [username];
        let query = `
            SELECT p.*
            FROM posts p
            WHERE p.username = $1 OR p.user_id IN (
                SELECT following_id FROM follows f
                JOIN users u ON u.id = f.follower_id
                WHERE u.username = $1
            )
        `;
        if (beforeId) {
            params.push(beforeId);
            query += ` AND p.id < $${params.length}`;
        }
        params.push(limit);
        query += ` ORDER BY p.id DESC LIMIT $${params.length}`;
        const result = await pool.query(query, params);
        return result.rows;
    },

    // Social: Comments
    async addComment({ postId, username, content }) {
        const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        const user = userResult.rows[0];
        if (!user) throw new Error('User not found');
        const result = await pool.query(
            `INSERT INTO comments (post_id, user_id, username, content) VALUES ($1, $2, $3, $4) RETURNING *`,
            [postId, user.id, username, content]
        );
        // increment comment_count
        await pool.query('UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1', [postId]);
        return result.rows[0];
    },

    async getComments(postId, limit = 50, beforeId = null) {
        const params = [postId];
        let query = `SELECT * FROM comments WHERE post_id = $1`;
        if (beforeId) {
            params.push(beforeId);
            query += ` AND id < $2`;
        }
        params.push(limit);
        query += ` ORDER BY id DESC LIMIT $${params.length}`;
        const result = await pool.query(query, params);
        return result.rows.reverse();
    },

    // Social: Likes
    async likePost({ postId, username }) {
        const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        const user = userResult.rows[0];
        if (!user) throw new Error('User not found');
        await pool.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, user.id]);
        await pool.query('UPDATE posts SET like_count = (
            SELECT COUNT(*) FROM post_likes WHERE post_id = $1
        ) WHERE id = $1', [postId]);
        const post = await this.getPostById(postId);
        return post;
    },

    async unlikePost({ postId, username }) {
        const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        const user = userResult.rows[0];
        if (!user) throw new Error('User not found');
        await pool.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [postId, user.id]);
        await pool.query('UPDATE posts SET like_count = (
            SELECT COUNT(*) FROM post_likes WHERE post_id = $1
        ) WHERE id = $1', [postId]);
        const post = await this.getPostById(postId);
        return post;
    },

    async getPostLikes(postId, limit = 50) {
        const result = await pool.query(`
            SELECT u.username
            FROM post_likes pl JOIN users u ON u.id = pl.user_id
            WHERE pl.post_id = $1
            ORDER BY pl.created_at DESC
            LIMIT $2
        `, [postId, limit]);
        return result.rows.map(r => r.username);
    },

    // Social: Follows
    async followUser({ followerUsername, followingUsername }) {
        if (followerUsername === followingUsername) return { ok: true };
        const [followerRes, followingRes] = await Promise.all([
            pool.query('SELECT id FROM users WHERE username = $1', [followerUsername]),
            pool.query('SELECT id FROM users WHERE username = $1', [followingUsername])
        ]);
        const follower = followerRes.rows[0];
        const following = followingRes.rows[0];
        if (!follower || !following) throw new Error('User not found');
        await pool.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [follower.id, following.id]);
        return { ok: true };
    },

    async unfollowUser({ followerUsername, followingUsername }) {
        const [followerRes, followingRes] = await Promise.all([
            pool.query('SELECT id FROM users WHERE username = $1', [followerUsername]),
            pool.query('SELECT id FROM users WHERE username = $1', [followingUsername])
        ]);
        const follower = followerRes.rows[0];
        const following = followingRes.rows[0];
        if (!follower || !following) throw new Error('User not found');
        await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [follower.id, following.id]);
        return { ok: true };
    },

    async getFollowing(username) {
        const result = await pool.query(`
            SELECT u2.username
            FROM follows f
            JOIN users u1 ON u1.id = f.follower_id
            JOIN users u2 ON u2.id = f.following_id
            WHERE u1.username = $1
            ORDER BY u2.username
        `, [username]);
        return result.rows.map(r => r.username);
    },

    async getFollowers(username) {
        const result = await pool.query(`
            SELECT u1.username
            FROM follows f
            JOIN users u1 ON u1.id = f.follower_id
            JOIN users u2 ON u2.id = f.following_id
            WHERE u2.username = $1
            ORDER BY u1.username
        `, [username]);
        return result.rows.map(r => r.username);
    }
};

module.exports = {
    pool,
    db,
    testConnection,
    initializeTables
};
