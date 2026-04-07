const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

http
  .createServer((req, res) => {
    const requestPath = req.url === "/" ? "index.html" : req.url.split("?")[0].replace(/^\//, "");
    const safePath = path.normalize(requestPath).replace(/^([.][.][\\/])+/, "");
    const isData = /^data[\\/]/.test(safePath);
    const relativePath = isData ? safePath.replace(/^data[\\/]/, "") : safePath;
    const filePath = path.join(isData ? dataDir : publicDir, relativePath);
    sendFile(res, filePath);
  })
  .listen(port, () => {
    console.log(`Marketing platform running at http://localhost:${port}`);
  });

