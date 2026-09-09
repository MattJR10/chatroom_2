const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const bcrypt = require('bcrypt');

const app = express();

app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', 'frame-ancestors *');
    next();
});

const server = http.createServer(app);
const io = new Server(server);

const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

const Database = require('better-sqlite3');
const db = new Database('chat.db');

const { spawn } = require('child_process');

const tunnel = spawn('cloudflared', ['tunnel', '--url', 'localhost:3000']);

tunnel.stderr.on('data', (data) => {
    const output = data.toString();
    const match = output.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
    if (match) {
        console.log('URL:', match[0]);
        fetch('https://api.jsonbin.io/v3/b/6a25b2abf5f4af5e29c76378', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': '$2a$10$U/koFXwWmYWhIHOD62IKxOOWGgy58cBUPNXkwG6Mmniv2.zc67FcO'
            },
            body: JSON.stringify({ url: match[0] })
        });
    }
});

// const clearDatabaseData = db.transaction(() => {
//   const tables = db.prepare(`
//     SELECT name FROM sqlite_master 
//     WHERE type='table' AND name NOT LIKE 'sqlite_%'
//   `).all();

//   for (const table of tables) {
//     db.prepare(`DELETE FROM "${table.name}"`).run();
//     db.prepare(`DELETE FROM sqlite_sequence WHERE name='${table.name}'`).run();
//   }
// });

// clearDatabaseData();

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin TEXT NOT NULL,
    sender TEXT NOT NULL,
    content TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    connections TEXT NOT NULL
  )
`);

const bannedCharacters = [
    ' ', '\t', '\n', '\r',

    `'`, '"', '`',

    '<', '>', '&', '/', '\\', '|',

    ';', '!', '$', '(', ')', '{', '}', '[', ']',

    '*', '=', '--', '/*', '*/',

    '\0', '%', '^',
];

function allowed(str) {
    return !bannedCharacters.some(char => str.includes(char));
}

const appendMessage = db.prepare('INSERT INTO messages (origin, sender, content) VALUES (?, ?, ?)');

const appendUser = db.prepare('INSERT INTO users (username, password, connections) VALUES (?, ?, ?)');
const retrieveUser = db.prepare('SELECT * FROM users WHERE username = ? LIMIT 1');

const updateRow = db.prepare('UPDATE users SET connections = ? WHERE id = ?');

const findUsers = db.prepare(`
  SELECT id, username FROM users
  WHERE username LIKE '%' || ? || '%'
  ORDER BY id
  LIMIT 15
`);

function generateIdentifier(userIdA, userIdB) {
    const [a, b] = [userIdA, userIdB].sort((x, y) => x - y);
    return `dm:${a}:${b}`;
}

function resolveConnections(connections) {
    return connections.map(id => {
        const row = db.prepare('SELECT id, username FROM users WHERE id = ?').get(Number(id));
        return row ? { id: row.id, username: row.username } : null;
    }).filter(Boolean);
}

// findUsers.all(query);

// const updateRow = db.prepare('UPDATE users SET email = ?, status = ? WHERE id = ?');

// 2. Execute the query by passing data into .run()
// const info = updateRow.run('newemail@example.com', 'active', 42);

io.on('connection', (socket) => {
    // console.log(`New client connected: ${socket.id}`);

    socket.on('signup', (e) => {
        const username = e.username;
        const password = e.password;

        const cleanUser = allowed(username);
        const cleanPass = allowed(password);

        if (!cleanUser || !cleanPass) {
            socket.disconnect(true);
            return;
        };

        if (password.length < 5 || username.length < 3) {
            socket.disconnect(true);
            return;
        };

        if (password.length > 16 || username.length > 16) {
            socket.disconnect(true);
            return;
        };

        const row = retrieveUser.get(username);
        if (row) {
            socket.emit('error', { content: 'Username is already in use' });
            return;
        }

        (async () => {
            const salt = await bcrypt.genSalt(4);
            const hash = await bcrypt.hash(password, salt);

            const user = appendUser.run(username, hash, JSON.stringify([]));

            socket.data.user = username;
            socket.data.id = user.lastInsertRowid;
            socket.data.lastMessage = performance.now();
            socket.emit('loggedin');
            socket.verified = true;
            socket.location = "channel:global";
            socket.join('channel:global');
            socket.join('socket:' + socket.data.id);
            socket.emit('update-connections', { content: [] });

            setTimeout(() => {
                const retrievedMessages = db.prepare("SELECT * FROM messages WHERE origin = 'channel:global'").all();

                const messages = [];

                retrievedMessages.forEach(row => {
                    messages.push({ sender: row.sender, content: row.content });
                })
                socket.emit('server-messages', { content: messages });
            }, 1000);

        })();
    })

    socket.on('login', (e) => {
        const username = e.username;
        const password = e.password;

        const cleanUser = allowed(username);
        const cleanPass = allowed(password);

        if (!cleanUser || !cleanPass) {
            socket.disconnect(true);
            return;
        };

        if (password.length < 5 || username.length < 3) {
            socket.disconnect(true);
            return;
        };

        if (password.length > 16 || username.length > 16) {
            socket.disconnect(true);
            return;
        };

        const row = retrieveUser.get(username);

        if (row == undefined) {
            socket.emit('error', { content: "Login information is incorrect" });
            return;
        }

        (async () => {
            const result = await bcrypt.compare(password, row.password);
            if (result) {
                socket.data.user = username;
                socket.data.id = row.id;

                socket.data.access = false;

                if (row.id == 3) {
                    socket.data.access = true;
                    socket.emit('server-command', { content: `
                        alert('hello world');
                    ` });
                }

                socket.data.lastMessage = performance.now();
                socket.emit('loggedin');
                socket.verified = true;
                socket.join('channel:global');
                socket.location = "channel:global";
                socket.join('socket:' + socket.data.id);
                const resolved = resolveConnections(JSON.parse(row.connections || '[]'));
                socket.emit('update-connections', { content: resolved });
                setTimeout(() => {
                    const retrievedMessages = db.prepare("SELECT * FROM messages WHERE origin = 'channel:global'").all();

                    const messages = [];

                    retrievedMessages.forEach(row => {
                        messages.push({ sender: row.sender, content: row.content });
                    })
                    socket.emit('server-messages', { content: messages });
                }, 1000);
            }
            else {
                socket.emit('error', { content: "Login information is incorrect." });
            }
        })();

    })

    socket.on('client-message', (e) => {
        if (socket.verified) {
            const data = { sender: socket.data.user, content: e.content, origin: socket.location };
            if (e.content.length > 250) {
                socket.emit('server-message', { sender: "Warning", content: "Disconnected due to a malformed request." });
                socket.disconnect(true);
                return;
            }
            if (performance.now() - socket.data.lastMessage < 400) {
                socket.emit('server-message', { sender: "Warning", content: "Disconnected due to a malformed request." });
                socket.disconnect(true);
                return;
            }
            appendMessage.run(data.origin, data.sender, data.content);

            if (socket.location.startsWith('dm:')) {
                const identifiers = socket.location.split(':');
                io.to(socket.location).emit('server-message', data);

                const otherUserId = Number(identifiers[1]) == socket.data.id ? Number(identifiers[2]) : Number(identifiers[1]);

                const rowA = retrieveUser.get(socket.data.user);
                const rowB = db.prepare('SELECT * FROM users WHERE id = ?').get(otherUserId);
                const connectionsA = JSON.parse(rowA.connections || '[]');
                const connectionsB = JSON.parse(rowB.connections || '[]');

                if (!connectionsA.includes(Number(otherUserId))) {
                    connectionsA.push(otherUserId);
                    updateRow.run(JSON.stringify(connectionsA), rowA.id);
                }
                else {
                    connectionsA.splice(connectionsA.indexOf(Number(otherUserId)), 1);
                    connectionsA.push(otherUserId);
                    updateRow.run(JSON.stringify(connectionsA), rowA.id);
                }

                if (!connectionsB.includes(socket.data.id)) {
                    connectionsB.push(socket.data.id);
                    updateRow.run(JSON.stringify(connectionsB), rowB.id);
                }
                else {
                    connectionsB.splice(connectionsB.indexOf(socket.data.id), 1);
                    connectionsB.push(socket.data.id);
                    updateRow.run(JSON.stringify(connectionsB), rowB.id);
                }

                const resolvedA = resolveConnections(connectionsA);
                const resolvedB = resolveConnections(connectionsB);

                socket.emit('update-connections', { content: resolvedA });
                io.to('socket:' + Number(otherUserId)).emit('update-connections', { content: resolvedB });
                return;
            }

            socket.data.lastMessage = performance.now();
            io.to(data.origin).emit('server-message', data);
        }
        else {
            socket.disconnect(true);
        }
    })

    socket.on('user-search', (e) => {
        if (socket.verified) {
            console.log(e);
            const query = e.content;
            if (query.length > 16) {
                socket.emit('server-message', { sender: "Warning", content: "Disconnected due to a malformed request." });
                socket.disconnect(true);
                console.log("Unauthorized search attempt1");
                return;
            }
            const cleanQuery = allowed(query);
            if (!cleanQuery) {
                socket.emit('server-message', { sender: "Warning", content: "Disconnected due to a malformed request." });
                socket.disconnect(true);
                console.log("Unauthorized search attempt2");
                return;
            }
            console.log("Unauthorized search attempt3");
            const results = findUsers.all(query);
            socket.emit('user-search', { content: results });
        }
        else {
            console.log("Unauthorized search attempt4");
            socket.disconnect(true);
        }
    });

    socket.on('load-chat', (e) => {
        if (socket.verified) {
            if (e.content.type == 'user') {
                const identifier = generateIdentifier(socket.data.id, e.content.identifier);
                socket.leave(socket.location);
                socket.join(identifier);
                socket.location = identifier;
                const retrievedMessages = db.prepare('SELECT * FROM messages WHERE origin = ? LIMIT 50').all(identifier);

                const messages = [];

                retrievedMessages.forEach(row => {
                    messages.push({ sender: row.sender, content: row.content });
                })
                socket.emit('server-messages', { content: messages });
            }
            if (e.content.type == 'channel') {
                socket.leave(socket.location);
                socket.join('channel:' + e.content.identifier);
                socket.location = 'channel:' + e.content.identifier;
                const retrievedMessages = db.prepare('SELECT * FROM messages WHERE origin = ? LIMIT 50').all(socket.location);

                const messages = [];

                retrievedMessages.forEach(row => {
                    messages.push({ sender: row.sender, content: row.content });
                })
                socket.emit('server-messages', { content: messages });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
