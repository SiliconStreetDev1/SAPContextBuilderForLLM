const express = require('express');
const path = require('path');
const fs = require('fs');
const clipboardy = require('clipboardy');

// Internal modules
const SecurityManager = require('./src/security');
const ContextPacker = require('./src/contextPacker');

const app = express();

// Middleware configuration
// INCREASED LIMITS: 50mb capacity for large enterprise requests
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// State Management: Hold chunks in server memory to avoid Boomerang payloads
let serverMemoryChunks = [];

// ==========================================
// CONFIGURATION API
// ==========================================
app.get('/api/config', (req, res) => {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
        res.sendFile(configPath);
    } else {
        res.status(404).json({ error: "Config file not found." });
    }
});

// ==========================================
// SECURITY API
// ==========================================
app.post('/api/credentials', async (req, res) => {
    try {
        const { token } = req.body;
        await SecurityManager.saveGitHubToken(token);
        res.json({ success: true, message: "Token stored securely in OS keychain." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// OS INTEGRATION API (CLIPBOARD)
// ==========================================
app.post('/api/copy-os', async (req, res) => {
    try {
        if (!serverMemoryChunks || serverMemoryChunks.length === 0) {
            return res.status(400).json({ error: "No context packed to copy." });
        }
        
        // Join all chunks into a single string
        const fullPayload = serverMemoryChunks.join('\n\n');
        
        // Write directly to the OS clipboard via Node.js
        await clipboardy.write(fullPayload);
        
        res.json({ success: true, message: "Copied directly to OS clipboard!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// AUTOMATION API (PLAYWRIGHT)
// ==========================================
app.post('/api/login', async (req, res) => {
    try {
        await ChromeAutomator.openForLogin();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auto-feed', (req, res) => {
    try {
        if (!serverMemoryChunks || serverMemoryChunks.length === 0) {
            return res.status(400).json({ error: "No context packed in server memory. Please compile first." });
        }
        
        // Fire-and-Forget implementation
        ChromeAutomator.feedChunks(serverMemoryChunks).catch(err => {
            console.error("[Background Feed Error]", err);
        });

        res.json({ success: true, message: "Feeding process handed off to background worker." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// CORE PACKING API
// ==========================================
app.post('/api/pack', async (req, res) => {
    try {
        const { sources, extensions, aiPrompt } = req.body;
        
        const configPath = path.join(__dirname, 'config.json');
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        
        const characterLimit = configData.maxCharsPerChunk || 45000;
        const ignoreDirs = configData.ignoreDirs || [];
        const ignoreFiles = configData.ignoreFiles || [];
        
        const gitHubToken = await SecurityManager.getGitHubToken();
        
        serverMemoryChunks = await ContextPacker.compile(
            sources, 
            extensions, 
            aiPrompt, 
            gitHubToken, 
            characterLimit,
            ignoreDirs,
            ignoreFiles
        );
        
        res.json({ chunks: serverMemoryChunks });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Initialize server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`SAP Context Builder running on http://localhost:${PORT}`);
});