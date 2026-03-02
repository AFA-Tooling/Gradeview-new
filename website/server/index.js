const cors = require('cors');
const dotenv = require('dotenv');
const express = require('express');
const fs = require('fs');
const path = require('path');

const { proxy, limit } = require('./middleware');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();

const buildDirCandidates = [
    path.join(__dirname, 'build'),
    path.join(process.cwd(), 'build'),
    path.join(process.cwd(), 'server', 'build'),
    '/app/build',
    '/website/build',
];

const buildDir = buildDirCandidates.find((dir) =>
    fs.existsSync(path.join(dir, 'index.html')),
);

if (!buildDir) {
    console.error(
        `[ERROR] React build not found. Checked: ${buildDirCandidates.join(', ')}`,
    );
}

app.use(cors());
if (buildDir) {
    app.use(express.static(buildDir));
}

// Set up API proxy middleware
// Apply a higher, scoped rate limit to API routes only, then proxy
app.use('/api', limit(60));
app.use('/api', proxy);

// Remove global rate limiting to avoid throttling static assets and pages

// Serve static files from the React app
app.get('/*', (_, res) => {
    if (_.path.startsWith('/.')) {
        return res.status(404).send('Not Found');
    }

    if (!buildDir) {
        return res.status(500).send(
            'Frontend build not found. Please run `npm run build` in website/ and ensure build files are mounted.',
        );
    }

    return res.sendFile(path.join(buildDir, 'index.html'));
});

// Start the server listening on the unix socket or port if configured otherwise port 3000.
const sock = process.env.SOCKETS_DIR && `${process.env.SOCKETS_DIR}/app.sock`;
const port = process.env.PORT || 3000;
app.listen(sock || port, () => {
    if (sock) {
        console.log(`Server is listening on ${sock}`);
        require('child_process').exec(
            `chmod o+rw ${sock}`,
            (err, stdout, stderr) => {
                if (err) {
                    console.error(`[ERROR] execution error: ${err}`);
                }
                console.log(`[LOG]: ${stdout}`);
                console.error(`[ERROR]: ${stderr}`);
            },
        );
    } else {
        console.log(`Server is listening on port ${port}`);
    }
});
