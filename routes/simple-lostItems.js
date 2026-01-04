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

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (_) {}

// Multer storage for lost items
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const fname = `lost_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
        cb(null, fname);
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

// Get all lost items (public endpoint) - SIMPLIFIED
router.get('/', async (req, res) => {
    try {
        let lostItems;
        try {
            lostItems = await dbHelpers.all(`
                SELECT li.*, s.name as student_name, s.email as student_email, s.phone as student_phone
                FROM lost_items li
                LEFT JOIN students s ON li.student_id = s.id
                WHERE li.status = 'active'
                ORDER BY li.date_lost DESC, li.id DESC
                LIMIT 50
            `);
        } catch (joinErr) {
            console.error('Lost list join fallback:', joinErr.message);
            lostItems = await dbHelpers.all(`
                SELECT li.*
                FROM lost_items li
                WHERE li.status = 'active'
                ORDER BY li.id DESC
                LIMIT 50
            `);
        }

        res.json({
            success: true,
            data: {
                items: lostItems,
                pagination: {
                    total: lostItems.length,
                    limit: 50,
                    offset: 0,
                    hasMore: false
                }
            }
        });

    } catch (error) {
        console.error('Get lost items error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch lost items',
            error: error.message
        });
    }
});

// Get a specific lost item
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        let lostItem;
        try {
            lostItem = await dbHelpers.get(`
                SELECT li.*, s.name as student_name, s.email as student_email, s.phone as student_phone
                FROM lost_items li
                LEFT JOIN students s ON li.student_id = s.id
                WHERE li.id = ?
            `, [id]);
        } catch (joinErr) {
            console.error('Lost item join fallback:', joinErr.message);
            lostItem = await dbHelpers.get(`
                SELECT li.* FROM lost_items li WHERE li.id = ?
            `, [id]);
        }

        if (!lostItem) {
            return res.status(404).json({
                success: false,
                message: 'Lost item not found'
            });
        }

        res.json({
            success: true,
            data: { item: lostItem }
        });

    } catch (error) {
        console.error('Get lost item error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch lost item',
            error: error.message
        });
    }
});

// Delete a lost item
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const item = await dbHelpers.get('SELECT id, student_id, image_url FROM lost_items WHERE id = ?', [id]);
        if (!item) {
            return res.status(404).json({ success: false, message: 'Lost item not found' });
        }
        if (item.student_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not authorized to delete this lost item' });
        }
        // delete related claims
        await dbHelpers.run('DELETE FROM claims WHERE lost_item_id = ?', [id]);
        // unlink image file if exists
        try {
            if (item.image_url) {
                const diskPath = path.join(__dirname, '..', 'public', item.image_url.replace(/^\/+/, ''));
                fs.unlink(diskPath, () => {});
            }
        } catch (_) {}
        // delete row
        await dbHelpers.run('DELETE FROM lost_items WHERE id = ?', [id]);
        res.json({ success: true, message: 'Lost item deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete lost item', error: error.message });
    }
});

// Create a new lost item
router.post('/', authenticateToken, upload.single('image'), [
    body('item_name').isLength({ min: 1 }).withMessage('Item name is required'),
    body('description').isLength({ min: 10 }).withMessage('Description must be at least 10 characters'),
    body('location').isLength({ min: 1 }).withMessage('Location is required'),
    body('date_lost').isISO8601().withMessage('Please provide a valid date'),
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

        const { item_name, description, location, date_lost } = req.body;
        // Coalesce optional fields to null to avoid mysql2 undefined bind error
        const safeTime = (req.body.time_lost && req.body.time_lost !== '') ? req.body.time_lost : null;
        const safeCategory = (req.body.category && req.body.category !== '') ? req.body.category : null;
        const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

        // Insert lost item
        const result = await dbHelpers.run(`
            INSERT INTO lost_items 
            (student_id, item_name, description, location, date_lost, time_lost, category, image_url) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [req.user.id, item_name, description, location, date_lost, safeTime, safeCategory, imageUrl]);

        // Fetch the created item with student details
        const createdItem = await dbHelpers.get(`
            SELECT li.*, s.name as student_name, s.email as student_email, s.phone as student_phone
            FROM lost_items li
            JOIN students s ON li.student_id = s.id
            WHERE li.id = ?
        `, [result.id]);

        res.status(201).json({
            success: true,
            message: 'Lost item reported successfully',
            data: { item: createdItem }
        });

    } catch (error) {
        console.error('Create lost item error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to report lost item',
            error: error.message
        });
    }
});

module.exports = router;
