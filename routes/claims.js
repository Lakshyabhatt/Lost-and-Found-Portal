const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { dbHelpers } = require('../config/database');

// Simple auth middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await dbHelpers.get(
            'SELECT id, student_id, name, email, phone FROM students WHERE id = ?',
            [decoded.userId]
        );

        if (!user) {
            return res.status(401).json({ success: false, message: 'User not found' });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
};

const router = express.Router();

// Get list of lost item IDs that are locked (already notified/approved/in-progress/completed)
router.get('/lost/locked', authenticateToken, async (req, res) => {
    try {
        const rows = await dbHelpers.all(
            `SELECT DISTINCT lost_item_id AS id
               FROM claims
              WHERE lost_item_id IS NOT NULL
                AND status IN ('approved','claimer_marked','finder_marked','pending','completed')`
        );
        const ids = rows.map(r => r.id).filter(Boolean);
        res.json({ success: true, data: { lost_item_ids: ids } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch locked lost items', error: error.message });
    }
});

// Finder initiates a notification to a lost item owner by linking their found item
router.post('/notify-owner', authenticateToken, [
    body('lost_item_id').isInt({ min: 1 }).withMessage('lost_item_id is required and must be an integer'),
    body('found_item_id').optional().isInt({ min: 1 }).withMessage('found_item_id must be an integer when provided')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
        }

        const { lost_item_id, found_item_id } = req.body;

        const lostItem = await dbHelpers.get('SELECT * FROM lost_items WHERE id = ?', [lost_item_id]);
        if (!lostItem) return res.status(404).json({ success: false, message: 'Lost item not found' });

        // FIRST: Lock on lost item to prevent duplicate notifications
        const lostLock = await dbHelpers.get(
            `SELECT id FROM claims 
             WHERE lost_item_id = ? AND status IN ('approved','claimer_marked','finder_marked','pending','completed')
             ORDER BY created_at DESC LIMIT 1`,
            [lost_item_id]
        );
        if (lostLock) {
            return res.status(409).json({ success: false, message: 'This lost item has already been notified by another user' });
        }

        // If found_item_id provided, validate; else auto-create minimal found item from lost item info
        let foundItem = null;
        if (found_item_id) {
            foundItem = await dbHelpers.get('SELECT * FROM found_items WHERE id = ?', [found_item_id]);
            if (!foundItem) return res.status(404).json({ success: false, message: 'Found item not found' });
            if (foundItem.finder_id !== req.user.id) return res.status(403).json({ success: false, message: 'You can only link your own found item' });
        } else {
            const ins = await dbHelpers.run(
                `INSERT INTO found_items (finder_id, item_name, description, location, date_found, status)
                 VALUES (?, ?, ?, ?, CURDATE(), 'active')`,
                [req.user.id, lostItem.item_name || 'Found item', lostItem.description || '', lostItem.location || '']
            );
            foundItem = await dbHelpers.get('SELECT * FROM found_items WHERE id = ?', [ins.id]);
        }

        // Prevent duplicate for same pair as well
        const existing = await dbHelpers.get(
            `SELECT id FROM claims 
             WHERE found_item_id = ? AND lost_item_id = ? AND status IN ('requested','approved','claimer_marked','finder_marked','pending','completed')
             ORDER BY created_at DESC LIMIT 1`,
            [foundItem.id, lost_item_id]
        );
        if (existing) {
            return res.status(409).json({ success: false, message: 'A notification already exists for this lost item' });
        }

        const result = await dbHelpers.run(
            `INSERT INTO claims (lost_item_id, found_item_id, claimer_id, status)
             VALUES (?, ?, ?, 'approved')`,
            [lost_item_id, foundItem.id, lostItem.student_id]
        );

        const created = await dbHelpers.get(
            `SELECT c.* FROM claims c WHERE c.id = ?`,
            [result.id]
        );

        res.status(201).json({ success: true, message: 'Owner notified', data: { claim: created } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to notify owner', error: error.message });
    }
});

// Claimer confirms they claimed back the item
router.patch('/:id/claimer-confirm', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const claim = await dbHelpers.get(
            `SELECT c.*, fi.finder_id FROM claims c
             JOIN found_items fi ON c.found_item_id = fi.id
             WHERE c.id = ?`,
            [id]
        );
        if (!claim) return res.status(404).json({ success: false, message: 'Claim not found' });
        if (claim.claimer_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not authorized to confirm this claim' });
        }
        if (!['approved','finder_marked'].includes(claim.status)) {
            return res.status(400).json({ success: false, message: 'Claim is not in a confirmable state' });
        }

        if (claim.status === 'finder_marked') {
            // Both sides confirmed -> pending then auto-complete and close item
            await dbHelpers.run('UPDATE claims SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['pending', id]);
            await dbHelpers.run('UPDATE claims SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['completed', id]);
            await dbHelpers.run('UPDATE found_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['closed', claim.found_item_id]);
            // Auto-complete any other claims on the same found item
            await dbHelpers.run('UPDATE claims SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE found_item_id = ? AND id <> ?', ['completed', claim.found_item_id, id]);
            // If linked to a lost item, mark it completed
            if (claim.lost_item_id) {
                await dbHelpers.run('UPDATE lost_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['completed', claim.lost_item_id]);
            }
            return res.json({ success: true, message: 'Both confirmed. Claim completed and item closed.' });
        } else {
            await dbHelpers.run('UPDATE claims SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['claimer_marked', id]);
            return res.json({ success: true, message: 'Claimer confirmation recorded' });
        }
    } catch (error) {
        console.error('Claimer confirm error:', error);
        res.status(500).json({ success: false, message: 'Failed to confirm claim', error: error.message });
    }
});

// Finder marks item returned to claimer
router.patch('/:id/finder-returned', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const claim = await dbHelpers.get(
            `SELECT c.*, fi.finder_id FROM claims c
             JOIN found_items fi ON c.found_item_id = fi.id
             WHERE c.id = ?`,
            [id]
        );
        if (!claim) return res.status(404).json({ success: false, message: 'Claim not found' });
        if (claim.finder_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not authorized to mark return' });
        }
        if (!['approved','claimer_marked'].includes(claim.status)) {
            return res.status(400).json({ success: false, message: 'Claim is not in a returnable state' });
        }

        if (claim.status === 'claimer_marked') {
            // Both sides confirmed -> pending then auto-complete and close item
            await dbHelpers.run('UPDATE claims SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['pending', id]);
            await dbHelpers.run('UPDATE claims SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['completed', id]);
            await dbHelpers.run('UPDATE found_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['closed', claim.found_item_id]);
            // Auto-complete any other claims on the same found item
            await dbHelpers.run('UPDATE claims SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE found_item_id = ? AND id <> ?', ['completed', claim.found_item_id, id]);
            // If linked to a lost item, mark it completed
            if (claim.lost_item_id) {
                await dbHelpers.run('UPDATE lost_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['completed', claim.lost_item_id]);
            }
            return res.json({ success: true, message: 'Both confirmed. Claim completed and item closed.' });
        } else {
            await dbHelpers.run('UPDATE claims SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['finder_marked', id]);
            return res.json({ success: true, message: 'Finder return recorded' });
        }
    } catch (error) {
        console.error('Finder returned error:', error);
        res.status(500).json({ success: false, message: 'Failed to mark return', error: error.message });
    }
});

// Claimer verifies details to request a claim for a found item
router.post('/verify-request', authenticateToken, [
    body('found_item_id').isInt({ min: 1 }).withMessage('found_item_id is required and must be an integer'),
    body('location').isString().trim().notEmpty().withMessage('location is required'),
    // Date is optional and ignored for matching
    body('date').optional().isString(),
    // Time is optional and ignored for matching
    body('time').optional().isString()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
        }

        const { found_item_id, location, date, time } = req.body;

        const foundItem = await dbHelpers.get(
            'SELECT id, finder_id, location, date_found, time_found, status FROM found_items WHERE id = ?',
            [found_item_id]
        );
        if (!foundItem) return res.status(404).json({ success: false, message: 'Found item not found' });
        if (foundItem.status !== 'active') return res.status(400).json({ success: false, message: 'Item is not available for claims' });
        if (foundItem.finder_id === req.user.id) return res.status(400).json({ success: false, message: 'You cannot claim your own found item' });

        // Lock: if another user's claim is already approved/in-progress/completed for this found item, block
        const existingApproved = await dbHelpers.get(
            `SELECT id, claimer_id, status FROM claims 
             WHERE found_item_id = ? 
               AND claimer_id <> ?
               AND status IN ('approved','claimer_marked','finder_marked','pending','completed')
             ORDER BY created_at DESC LIMIT 1`,
            [found_item_id, req.user.id]
        );
        if (existingApproved) {
            return res.status(409).json({ success: false, message: 'This item is already requested by another user' });
        }

        // Matching rules: exact equality ignoring case and extra spaces
        const normLoc = (s) => String(s || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
        const providedLoc = normLoc(location);
        const storedLoc = normLoc(foundItem.location);
        const locMatches = providedLoc && storedLoc && (providedLoc === storedLoc);

        // Only location is used for matching now
        const matched = locMatches;

        // Enforce max 3 rejected attempts per day ONLY when this attempt would be rejected
        if (!matched) {
            const rejectedCountRow = await dbHelpers.get(
                `SELECT COUNT(*) AS cnt
                 FROM claims
                 WHERE found_item_id = ?
                   AND claimer_id = ?
                   AND status = 'rejected'
                   AND DATE(created_at) = CURDATE()`,
                [found_item_id, req.user.id]
            );
            // If this would be the 3rd failed attempt today, block with 429
            if ((rejectedCountRow?.cnt || 0) >= 2) {
                return res.status(429).json({ success: false, message: 'Maximum daily claim attempts (3) reached for this item' });
            }
        }

        // Create claim with auto-approve or auto-reject
        const status = matched ? 'approved' : 'rejected';
        const result = await dbHelpers.run(
            `INSERT INTO claims (lost_item_id, found_item_id, claimer_id, status) VALUES (NULL, ?, ?, ?)` ,
            [found_item_id, req.user.id, status]
        );

        const claim = await dbHelpers.get('SELECT * FROM claims WHERE id = ?', [result.id]);

        if (matched) {
            return res.status(201).json({ success: true, message: 'Claim approved', data: { claim } });
        } else {
            return res.status(201).json({ success: false, message: 'Verification failed. Claim rejected', data: { claim } });
        }
    } catch (error) {
        console.error('Verify request error:', error);
        res.status(500).json({ success: false, message: 'Failed to submit claim verification', error: error.message });
    }
});

// Create a claim (minimal): claimer requests a found item
router.post('/', authenticateToken, [
    body('found_item_id').isInt({ min: 1 }).withMessage('found_item_id is required and must be an integer'),
    body('lost_item_id').optional().isInt({ min: 1 }).withMessage('lost_item_id must be an integer when provided'),
    body('contact_date').optional().isISO8601().withMessage('contact_date must be a valid date')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
        }

        const { found_item_id, lost_item_id, contact_date } = req.body;

        // Ensure found item exists and is active
        const foundItem = await dbHelpers.get(
            'SELECT id, finder_id, status FROM found_items WHERE id = ?',
            [found_item_id]
        );
        if (!foundItem) {
            return res.status(404).json({ success: false, message: 'Found item not found' });
        }
        if (foundItem.status !== 'active') {
            return res.status(400).json({ success: false, message: 'Item is not available for claims' });
        }

        // Prevent finder from claiming their own found item
        if (foundItem.finder_id === req.user.id) {
            return res.status(400).json({ success: false, message: 'You cannot claim your own found item' });
        }

        // Optional: ensure lost item exists if provided
        let safeLostId = null;
        if (lost_item_id) {
            const lostItem = await dbHelpers.get('SELECT id, student_id FROM lost_items WHERE id = ?', [lost_item_id]);
            if (!lostItem) {
                return res.status(404).json({ success: false, message: 'Lost item not found' });
            }
            safeLostId = lost_item_id;
        }

        const safeContact = contact_date ? contact_date : null;

        // Prevent duplicate active claims by the same claimer for the same found item
        const existing = await dbHelpers.get(
            `SELECT id, status FROM claims 
             WHERE found_item_id = ? AND claimer_id = ? AND status IN ('requested','approved')
             ORDER BY created_at DESC LIMIT 1`,
            [found_item_id, req.user.id]
        );
        if (existing) {
            return res.status(409).json({ success: false, message: 'You already have an active claim for this item' });
        }

        const result = await dbHelpers.run(
            `INSERT INTO claims (lost_item_id, found_item_id, claimer_id, status, contact_date)
             VALUES (?, ?, ?, ?, ?)`,
            [safeLostId, found_item_id, req.user.id, 'requested', safeContact]
        );

        const created = await dbHelpers.get(
            `SELECT c.*, 
                    s.name as claimer_name, s.email as claimer_email, s.phone as claimer_phone,
                    fi.finder_id
             FROM claims c
             JOIN students s ON c.claimer_id = s.id
             JOIN found_items fi ON c.found_item_id = fi.id
             WHERE c.id = ?`,
            [result.id]
        );

        res.status(201).json({ success: true, message: 'Claim requested', data: { claim: created } });
    } catch (error) {
        console.error('Create claim error:', error);
        res.status(500).json({ success: false, message: 'Failed to create claim', error: error.message });
    }
});

// Get pending claims for found items owned by me (finder)
router.get('/finder/pending', authenticateToken, async (req, res) => {
    try {
        const claims = await dbHelpers.all(
            `SELECT c.*, 
                    fi.item_name as found_item_name, fi.location as found_location, fi.status AS found_status,
                    cs.name as claimer_name, cs.email as claimer_email, cs.phone as claimer_phone
             FROM claims c
             JOIN found_items fi ON c.found_item_id = fi.id
             JOIN students cs ON c.claimer_id = cs.id
             WHERE fi.finder_id = ?
               AND fi.status <> 'closed'
               AND c.status IN ('requested','approved','claimer_marked','finder_marked','pending')
             ORDER BY c.created_at DESC`,
            [req.user.id]
        );

        res.json({ success: true, data: { claims } });
    } catch (error) {
        console.error('Get finder pending claims error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch pending claims', error: error.message });
    }
});

// Get my claims (as claimer)
router.get('/my', authenticateToken, async (req, res) => {
    try {
        const claims = await dbHelpers.all(
            `SELECT c.*, 
                    fi.item_name as found_item_name, fi.location as found_location, fi.status as found_status,
                    li.item_name as lost_item_name,
                    fs.name as finder_name, fs.email as finder_email, fs.phone as finder_phone
             FROM claims c
             LEFT JOIN found_items fi ON c.found_item_id = fi.id
             LEFT JOIN lost_items li ON c.lost_item_id = li.id
             LEFT JOIN students fs ON fi.finder_id = fs.id
             WHERE c.claimer_id = ?
             ORDER BY c.created_at DESC`,
            [req.user.id]
        );

        res.json({ success: true, data: { claims } });
    } catch (error) {
        console.error('Get my claims error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch claims', error: error.message });
    }
});

// Approve a claim (finder of the found item only)
router.patch('/:id/approve', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const claim = await dbHelpers.get(
            `SELECT c.*, fi.finder_id FROM claims c
             JOIN found_items fi ON c.found_item_id = fi.id
             WHERE c.id = ?`,
            [id]
        );
        if (!claim) return res.status(404).json({ success: false, message: 'Claim not found' });
        if (claim.finder_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not authorized to approve this claim' });
        }
        if (claim.status !== 'requested') {
            return res.status(400).json({ success: false, message: 'Only requested claims can be approved' });
        }

        await dbHelpers.run('UPDATE claims SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['approved', id]);
        res.json({ success: true, message: 'Claim approved' });
    } catch (error) {
        console.error('Approve claim error:', error);
        res.status(500).json({ success: false, message: 'Failed to approve claim', error: error.message });
    }
});

// Reject a claim (finder only)
router.patch('/:id/reject', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const claim = await dbHelpers.get(
            `SELECT c.*, fi.finder_id FROM claims c
             JOIN found_items fi ON c.found_item_id = fi.id
             WHERE c.id = ?`,
            [id]
        );
        if (!claim) return res.status(404).json({ success: false, message: 'Claim not found' });
        if (claim.finder_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not authorized to reject this claim' });
        }
        if (claim.status !== 'requested') {
            return res.status(400).json({ success: false, message: 'Only requested claims can be rejected' });
        }

        await dbHelpers.run('UPDATE claims SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['rejected', id]);
        res.json({ success: true, message: 'Claim rejected' });
    } catch (error) {
        console.error('Reject claim error:', error);
        res.status(500).json({ success: false, message: 'Failed to reject claim', error: error.message });
    }
});

// Complete a claim (finder only) -> mark found item as claimed
router.patch('/:id/complete', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const claim = await dbHelpers.get(
            `SELECT c.*, fi.finder_id, fi.id as found_id FROM claims c
             JOIN found_items fi ON c.found_item_id = fi.id
             WHERE c.id = ?`,
            [id]
        );
        if (!claim) return res.status(404).json({ success: false, message: 'Claim not found' });
        if (claim.finder_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not authorized to complete this claim' });
        }
        if (!['approved'].includes(claim.status)) {
            return res.status(400).json({ success: false, message: 'Only approved claims can be completed' });
        }

        await dbHelpers.run('UPDATE claims SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['completed', id]);
        await dbHelpers.run('UPDATE found_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['claimed', claim.found_id]);

        res.json({ success: true, message: 'Claim completed and item marked as claimed' });
    } catch (error) {
        console.error('Complete claim error:', error);
        res.status(500).json({ success: false, message: 'Failed to complete claim', error: error.message });
    }
});

// Get list of found item IDs that are locked (already requested/approved by someone else or closed)
router.get('/found/locked', authenticateToken, async (req, res) => {
    try {
        const rows = await dbHelpers.all(
            `SELECT DISTINCT found_item_id AS id
               FROM claims
              WHERE status IN ('approved','claimer_marked','finder_marked','pending','completed')
            UNION
            SELECT id AS id FROM found_items WHERE status = 'closed'`
        );
        const ids = rows.map(r => r.id);
        res.json({ success: true, data: { found_item_ids: ids } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch locked items', error: error.message });
    }
});

module.exports = router;
