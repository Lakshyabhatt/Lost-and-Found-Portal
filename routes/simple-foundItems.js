const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { dbHelpers } = require('../config/database');

// Simple auth middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ 
            success: false, 
            message: 'Access token required' 
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await dbHelpers.get(
            'SELECT id, student_id, name, email FROM students WHERE id = ?',
            [decoded.userId]
        );

        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({ 
            success: false, 
            message: 'Invalid or expired token' 
        });
    }
};

const router = express.Router();

// CORS preflight handlers (in case global CORS is not catching these)
router.options('/', (req, res) => {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.sendStatus(204);
});
router.options('/:id', (req, res) => {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.sendStatus(204);
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (_) {}

// Multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const fname = `found_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
        cb(null, fname);
    }
});

// Delete a found item (owner only) -> soft delete by setting status='deleted'
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const item = await dbHelpers.get('SELECT id, finder_id, image_url FROM found_items WHERE id = ?', [id]);
        if (!item) {
            return res.status(404).json({ success: false, message: 'Found item not found' });
        }
        if (item.finder_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not authorized to delete this found item' });
        }
        // delete related claims
        await dbHelpers.run('DELETE FROM claims WHERE found_item_id = ?', [id]);
        // unlink image file if exists
        try {
            if (item.image_url) {
                const diskPath = path.join(__dirname, '..', 'public', item.image_url.replace(/^\/+/, ''));
                fs.unlink(diskPath, () => {});
            }
        } catch (_) {}
        // delete the row
        await dbHelpers.run('DELETE FROM found_items WHERE id = ?', [id]);
        res.json({ success: true, message: 'Found item deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete found item', error: error.message });
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const ok = ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(file.originalname || '').toLowerCase());
        cb(ok ? null : new Error('Only JPG, PNG, WEBP files allowed'), ok);
    }
});

// Get all found items (public endpoint, but will use optional auth if provided)
router.get('/', async (req, res) => {
    try {
        const foundItems = await dbHelpers.all(`
            SELECT DISTINCT fi.id, fi.*, s.name as finder_name, s.email as finder_email, s.phone as finder_phone
            FROM found_items fi
            LEFT JOIN students s ON fi.finder_id = s.id
            LEFT JOIN claims c ON c.found_item_id = fi.id
                               AND c.lost_item_id IS NOT NULL
                               AND c.status IN ('approved','claimer_marked','finder_marked','pending','completed')
            WHERE fi.status = 'active'
              AND (c.id IS NULL)
            ORDER BY fi.date_found DESC, fi.id DESC
            LIMIT 50
        `);

        res.json({
            success: true,
            data: {
                items: foundItems,
                pagination: {
                    total: foundItems.length,
                    limit: 50,
                    offset: 0,
                    hasMore: false
                }
            }
        });

    } catch (error) {
        console.error('Get found items error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch found items',
            error: error.message
        });
    }
});

// Get a specific found item
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const foundItem = await dbHelpers.get(`
            SELECT fi.*, s.name as finder_name, s.email as finder_email, s.phone as finder_phone
            FROM found_items fi
            JOIN students s ON (fi.finder_id = s.id OR fi.finder_id = s.student_id)
            WHERE fi.id = ?
        `, [id]);

        if (!foundItem) {
            return res.status(404).json({
                success: false,
                message: 'Found item not found'
            });
        }

        res.json({
            success: true,
            data: { item: foundItem }
        });

    } catch (error) {
        console.error('Get found item error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch found item',
            error: error.message
        });
    }
});

// Create a new found item
router.post('/', authenticateToken, upload.single('image'), [
    body('item_name').isLength({ min: 1 }).withMessage('Item name is required'),
    body('description').isLength({ min: 10 }).withMessage('Description must be at least 10 characters'),
    body('location').isLength({ min: 1 }).withMessage('Location is required'),
    body('date_found').isISO8601().withMessage('Please provide a valid date'),
    body('category').optional().isLength({ min: 1 }).withMessage('Category must not be empty')
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { item_name, description, location, date_found } = req.body;
        // Coalesce optional fields to null to avoid mysql2 undefined bind error
        const safeTime = (req.body.time_found && req.body.time_found !== '') ? req.body.time_found : null;
        const safeCategory = (req.body.category && req.body.category !== '') ? req.body.category : null;
        const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

        // Insert found item
        const result = await dbHelpers.run(`
            INSERT INTO found_items 
            (finder_id, item_name, description, location, date_found, time_found, category, image_url) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [req.user.id, item_name, description, location, date_found, safeTime, safeCategory, imageUrl]);

        // Fetch the created item with finder details
        const createdItem = await dbHelpers.get(`
            SELECT fi.*, s.name as finder_name, s.email as finder_email, s.phone as finder_phone
            FROM found_items fi
            JOIN students s ON fi.finder_id = s.id
            WHERE fi.id = ?
        `, [result.id]);

        res.status(201).json({
            success: true,
            message: 'Found item reported successfully',
            data: { item: createdItem }
        });

    } catch (error) {
        console.error('Create found item error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to report found item',
            error: error.message
        });
    }
});

module.exports = router;
