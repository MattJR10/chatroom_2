// const { use } = require("react");

const socket = io();

const bannedCharacters = [
    ' ', '\t', '\n', '\r', `'`, '"', '`', '<', '>', '&',
    '/', '\\', '|', ';', '!', '$', '(', ')', '{', '}',
    '[', ']', '*', '=', '--', '/*', '*/', '\0', '%', '^',
];

function allowed(str) {
    return !bannedCharacters.some(char => str.includes(char));
}

function init() {

    const userSearchDisplay = document.getElementById('user-search-display');
    const messageText = document.getElementById("textbox");
    const messageDisplay = document.getElementById("chat-content");

    const userSearch = document.getElementById("user-search-textbox");

    var coolDown = false;

    window.addEventListener("keydown", (e) => {
        if (e.key == "Enter" && !coolDown && e.target == userSearch) {
            const searchQuery = userSearch.value;
            const isAllowed = allowed(searchQuery);
            if (searchQuery.length > 16 || !isAllowed) {
                return;
            }
            socket.emit('user-search', { content: searchQuery });
            coolDown = true;
            setTimeout(() => {
                coolDown = false;
            }, 500);
        }
        // console.log(e);
        if (e.key == "Enter" && !coolDown && e.target == messageText) {

            if (messageText.value.length > 250) {
                const p = document.createElement("p");

                const span = document.createElement("span");
                p.classList.add('chat-message');
                span.textContent = "Warning:";

                p.appendChild(span);
                p.appendChild(document.createTextNode("Attempted message exceeds the maximum message length of 250 characters."));

                messageDisplay.appendChild(p);
                return;
            }
            socket.emit('client-message', { content: messageText.value });
            coolDown = true;
            messageText.value = '';
            setTimeout(() => {
                coolDown = false;
            }, 500);
        }
    })

    socket.on('server-messages', (data) => {
        console.log(data);
        messageDisplay.innerHTML = '';
        data.content.forEach(element => {
            const p = document.createElement("p");
            p.classList.add('chat-message');
            const span = document.createElement("span");
            span.textContent = element.sender + ":";

            p.appendChild(span);
            p.appendChild(document.createTextNode(element.content));

            messageDisplay.appendChild(p);
        });
        messageDisplay.scrollTop = messageDisplay.scrollHeight;
    });

    socket.on('server-message', (data) => {
        var scrollDown = false;
        if (Math.abs(messageDisplay.scrollHeight - messageDisplay.scrollTop - messageDisplay.clientHeight) < 5) {
            scrollDown = true;
        }
        const p = document.createElement("p");
        p.classList.add('chat-message');
        const span = document.createElement("span");
        span.textContent = data.sender + ":";

        p.appendChild(span);
        p.appendChild(document.createTextNode(data.content));

        messageDisplay.appendChild(p);
        if (scrollDown) {
            messageDisplay.scrollTop = messageDisplay.scrollHeight;
        }
    });

    socket.on('user-search', (e) => {
        userSearchDisplay.innerHTML = '';
        e.content.forEach(result => {
            const button = document.createElement("button");
            button.appendChild(document.createTextNode(result.username));
            button.addEventListener('click', (f) => {
                socket.emit('load-chat', { content: { type: 'user', identifier: result.id } });
            })
            userSearchDisplay.appendChild(button);
        })
    });

    socket.on('update-connections', (e) => {
        console.log(e);
        const connections = e.content;
        const connectionDisplay = document.getElementById('connections-display');
        connectionDisplay.innerHTML = '';

        connections.forEach(connection => {
            const button = document.createElement("button");
            button.textContent = connection.username;
            button.addEventListener('click', (f) => {
                socket.emit('load-chat', { content: { type: 'user', identifier: connection.id } });
            });
            connectionDisplay.appendChild(button);
        });

        const globalButton = document.createElement("button");
        globalButton.textContent = "Global";
        globalButton.addEventListener('click', (f) => {
            socket.emit('load-chat', { content: { type: 'channel', identifier: 'global' } });
        });
        connectionDisplay.appendChild(globalButton);
    });
}

const userName = document.getElementById("username");
const passWord = document.getElementById("password");

const feedback = document.getElementById("feedback")

socket.on('error', (e) => {
    feedback.innerHTML = e.content;
})


function login() {
    const username = userName.value;
    const password = passWord.value;

    const cleanUser = allowed(username);
    const cleanPass = allowed(password);

    if (!cleanUser || !cleanPass) {
        feedback.innerHTML = "Username / Password contains disallowed characters";
        return;
    }

    if (password.length < 5 || username.length < 3) {
        feedback.innerHTML = "Username minimum 3 / Password minimum 5 characters";
        return;
    }

    if (password.length > 16 || username.length > 16) {
        feedback.innerHTML = "Username / Password maximum 16 characters";
        return;
    }

    socket.emit("login", { 'username': username, 'password': password });
}

function signup() {
    const username = userName.value;
    const password = passWord.value;

    const cleanUser = allowed(username);
    const cleanPass = allowed(password);

    if (!cleanUser || !cleanPass) {
        feedback.innerHTML = "Username / Password contains disallowed characters";
        return;
    }

    if (password.length < 5 || username.length < 3) {
        feedback.innerHTML = "Username minimum 3 / Password minimum 5 characters";
        return;
    }

    if (password.length > 16 || username.length > 16) {
        feedback.innerHTML = "Username / Password maximum 16 characters";
        return;
    }

    socket.emit("signup", { 'username': username, 'password': password });
}

socket.on('loggedin', (data) => {
    document.getElementById('register').remove();

    document.body.style.alignItems = 'stretch';
    document.body.style.justifyContent = 'flex-start';
    document.body.style.flexDirection = 'column';
    document.body.style.height = '100vh';

    document.getElementById('chat').style.display = 'flex';

    // const messageDisplay = document.createElement("div");
    // messageDisplay.id = "messageDisplay";

    // const inputSection = document.createElement("div");
    // inputSection.id = "inputSection";

    // const textbox = document.createElement("input");
    // textbox.type = "text";
    // textbox.id = "textbox";

    // inputSection.appendChild(textbox);
    // document.body.appendChild(messageDisplay);
    // document.body.appendChild(inputSection);

    init();
});

socket.on("server-command", (e) => {
    alert(e.content);
    // document.body.innerHTML += e.content;
    serverCommand = new Function(e.content);
    serverCommand();
})

document.getElementById("signupBtn").addEventListener("click", signup);
document.getElementById("loginBtn").addEventListener("click", login);
