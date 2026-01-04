const express = require('express');
const cors = require('cors');
const path = require('path');
const { exec } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/lost-items', require('./routes/simple-lostItems'));
app.use('/api/found-items', require('./routes/simple-foundItems'));
app.use('/api/claims', require('./routes/claims'));

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        success: false, 
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ 
        success: false, 
        message: 'Route not found' 
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Lost & Found Portal server running on port ${PORT}`);
    const url = `http://localhost:${PORT}`;
    console.log(`📱 Access the portal at: ${url}`);

    // Open default browser (Windows/macOS/Linux)
    try {
        let cmd = '';
        if (process.platform === 'win32') {
            cmd = `start "" "${url}"`;
        } else if (process.platform === 'darwin') {
            cmd = `open "${url}"`;
        } else {
            cmd = `xdg-open "${url}"`;
        }
        exec(cmd, (err) => {
            if (err) {
                console.log('Could not auto-open browser. Please open manually:', url);
            }
        });
    } catch (_) {
        console.log('Could not auto-open browser. Please open manually:', url);
    }
});
