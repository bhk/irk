// Node web server that serves files and WebSockets

import url from "url";
import fs from "fs";
import path from "path";
import http from "http";
import {WebSocketServer} from "ws";

//----------------------------------------------------------------
// ROP/WS Server
//----------------------------------------------------------------

let count = 0;

class ServerAgent {
    constructor(ws) {
        let n = ++count;
        this.ws = ws;
        console.log(`WS ${n} (${ws.readyState})`);
        // message handler: Message
        ws.onmessage = evt => {
            let msg = evt.data;
            console.log(`${n}: ${msg}`);
            ws.send(JSON.stringify(["Update", 0, "hi"]));
        };
    }
};

//----------------------------------------------------------------
// HTTP & WebSocket Server
//----------------------------------------------------------------

let wss = new WebSocketServer({noServer: true});
// The connection event is sent when WSS is standalone; we emit it ourselves
// in the `noServer` use case for uniformity.
wss.on('connection', (ws, req) => new ServerAgent(ws));

let template = [
    "<!DOCTYPE html>",
    "<html lang=en>",
    "  <head>",
    "    <meta charset=utf-8>",
    "    <meta name=viewport content='width=786'>",
    "    <title>TITLE</title>",
    "    <style>",
    "      body { margin: 0; font: 16px Arial, Helvetica; }",
    "    </style>",
    "  </head>",
    "  <body>",
    "  <script type=module src='SRC'>",
    "  </script>",
    "  </body>",
    "</html>",
    ""
].join("\n");

let homeContent = template.replace(/SRC|TITLE/g,
                                   match => (match == "TITLE"
                                             ? "ROP Demo"
                                             : "./client.js"));

let extTypes = {
    ".js": "text/javascript",
    ".txt": "text/plain",
};

let respondHtml = (resp, code, body) => {
    resp.writeHead(code, {"Content-Type": "text/html"});
    resp.end(body);
};

let serveFile = (filePath, resp) => {
    let ext = path.extname(filePath);
    let contentType = extTypes[ext] || "text/html";

    fs.readFile(filePath, (error, content) => {
        if (error) {
            return respondHtml(resp, 500, `Error: ${error.code}`);
        } else {
            resp.writeHead(200, { "Content-Type": contentType });
            resp.end(content, 'utf-8');
        }
    });
};

let server = http.createServer( (request, resp) => {
    let u = url.parse(request.url);

    if (request.method === 'GET' && u.pathname === '/') {
        return respondHtml(resp, 200, homeContent);
    }

    if (request.method == "GET") {
        let filePath = "." + request.url;
        // remap as per package.json "browser" section
        if (filePath == "./test.js") {
            filePath = "./no-test.js";
        }
        if (filePath.match(/\.\./)) {
            return respondHtml(resp, 500, "Traversal path");
        }
        console.log(`File: ${filePath}`);
        serveFile(filePath, resp);
        return;
    }

    return respondHtml(resp, 404, "Not found");
});

server.on('upgrade', (request, socket, head) => {
    let { pathname } = url.parse(request.url);
    if (pathname == "/orca" && request.headers.upgrade == "websocket") {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

let addr = process.argv[2] || '127.0.0.1:8002';
let hostPort = addr.match(/^([^:]*):?(.*)/);
server.listen(hostPort[2], hostPort[1] || '127.0.0.1');

console.log('Listening on ' + addr + ' ...');
