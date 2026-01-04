const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
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

// Register a new student
router.post('/register', [
    body('student_id').isLength({ min: 3 }).withMessage('Student ID must be at least 3 characters'),
    body('name').isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('email').isEmail().withMessage('Please provide a valid email'),
    body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
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

        const { student_id, name, email, phone, password } = req.body;

        // Check if student already exists
        const existingStudent = await dbHelpers.get(
            'SELECT id FROM students WHERE student_id = ? OR email = ?',
            [student_id, email]
        );

        if (existingStudent) {
            return res.status(400).json({
                success: false,
                message: 'Student ID or email already exists'
            });
        }

        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Insert new student
        const result = await dbHelpers.run(
            'INSERT INTO students (student_id, name, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)',
            [student_id, name, email, phone, passwordHash]
        );

        // Generate JWT token
        const token = jwt.sign(
            { userId: result.id, student_id, email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        res.status(201).json({
            success: true,
            message: 'Student registered successfully',
            data: {
                user: {
                    id: result.id,
                    student_id,
                    name,
                    email,
                    phone
                },
                token
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed',
            error: error.message
        });
    }
});

// Login student
router.post('/login', [
    body('student_id').notEmpty().withMessage('Student ID is required'),
    body('password').notEmpty().withMessage('Password is required')
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

        const { student_id, password } = req.body;

        // Find student
        const student = await dbHelpers.get(
            'SELECT id, student_id, name, email, phone, password_hash FROM students WHERE student_id = ?',
            [student_id]
        );

        if (!student) {
            return res.status(401).json({
                success: false,
                message: 'Invalid student ID or password'
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, student.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Invalid student ID or password'
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: student.id, student_id: student.student_id, email: student.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: student.id,
                    student_id: student.student_id,
                    name: student.name,
                    email: student.email,
                    phone: student.phone
                },
                token
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: error.message
        });
    }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                user: req.user
            }
        });
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch profile',
            error: error.message
        });
    }
});

// Update user profile
router.put('/profile', authenticateToken, [
    body('name').optional().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('email').optional().isEmail().withMessage('Please provide a valid email'),
    body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number')
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

        const { name, email, phone } = req.body;
        const updates = [];
        const values = [];

        if (name) {
            updates.push('name = ?');
            values.push(name);
        }
        if (email) {
            updates.push('email = ?');
            values.push(email);
        }
        if (phone) {
            updates.push('phone = ?');
            values.push(phone);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(req.user.id);

        await dbHelpers.run(
            `UPDATE students SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        // Fetch updated user data
        const updatedUser = await dbHelpers.get(
            'SELECT id, student_id, name, email, phone FROM students WHERE id = ?',
            [req.user.id]
        );

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: {
                user: updatedUser
            }
        });

    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile',
            error: error.message
        });
    }
});

module.exports = router;
