// Lost Items actions: owner claimer-confirm and finder returned
document.addEventListener('click', async (e) => {
    const ownerBtn = e.target.closest('.lost-claimer-confirm');
    const finderBtn = e.target.closest('.lost-finder-returned');
    if (!ownerBtn && !finderBtn) return;
    try {
        showLoading(true);
        const token = localStorage.getItem('token');
        if (ownerBtn) {
            const claimId = ownerBtn.getAttribute('data-claim-id');
            const res = await fetch(`${API_BASE}/claims/${claimId}/claimer-confirm`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` } });
            const body = await res.json();
            if (res.ok) {
                showToast(body.message || 'Claimed back recorded', 'success');
                await refreshMyActiveClaims();
                // Optimistic: mark this lost item's claim as claimer_marked -> completed state will come from server later
                try {
                    const c = body.data && body.data.claim ? body.data.claim : null;
                    if (c && c.lost_item_id) {
                        myClaimByLost.set(Number(c.lost_item_id), { id: c.id, status: c.status || 'claimer_marked' });
                    }
                } catch(_){}
                displayLostItems(allLostItems);
                await loadFinderPendingClaims();
            } else {
                showToast(body.message || 'Action failed', 'error');
            }
        }
        if (finderBtn) {
            const claimId = finderBtn.getAttribute('data-claim-id');
            const res2 = await fetch(`${API_BASE}/claims/${claimId}/finder-returned`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` } });
            const body2 = await res2.json();
            if (res2.ok) {
                showToast(body2.message || 'Item return recorded', 'success');
                // Optimistic: update local map so owner sees 'Item Claimed Back' next render on this client
                try {
                    const c = body2.data && body2.data.claim ? body2.data.claim : null;
                    if (c && c.lost_item_id) {
                        myFinderClaimByLost.set(Number(c.lost_item_id), { id: c.id, status: c.status || 'finder_marked' });
                    }
                } catch(_){}
                displayLostItems(allLostItems);
                await loadFinderPendingClaims();
            } else {
                showToast(body2.message || 'Action failed', 'error');
            }
        }
    } catch (err) {
        showToast('Action failed', 'error');
    } finally {
        showLoading(false);
    }
});
async function refreshLockedFound() {
    lockedFoundIds = new Set();
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const res = await fetch(`${API_BASE}/claims/found/locked`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) return;
        const body = await res.json();
        const ids = (body.data && body.data.found_item_ids) ? body.data.found_item_ids : [];
        ids.forEach(id => lockedFoundIds.add(Number(id)));
    } catch (_) { /* ignore */ }
}

// Fetch locked lost items (already notified by someone else)
async function refreshLockedLostIds() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/claims/lost/locked`, { headers: { 'Authorization': `Bearer ${token || ''}` } });
        const body = await res.json().catch(() => ({ data: { lost_item_ids: [] }}));
        if (res.ok && body && body.data && Array.isArray(body.data.lost_item_ids)) {
            lockedLostIds.clear();
            body.data.lost_item_ids.forEach(id => lockedLostIds.add(Number(id)));
        }
    } catch (_) { /* ignore */ }
}

// Blocked claims persistence helpers
function blockedStorageKeyFor(userId) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `blockedClaims:${userId || 'anon'}:${today}`;
}

function hydrateBlockedFoundIds() {
    blockedFoundIds.clear();
    if (!currentUser) return;
    const key = blockedStorageKeyFor(currentUser.id);
    const raw = localStorage.getItem(key);
    if (raw) {
        try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) arr.forEach(id => blockedFoundIds.add(Number(id)));
        } catch {}
    }
}

function persistBlockedFoundIds() {
    if (!currentUser) return;
    const key = blockedStorageKeyFor(currentUser.id);
    localStorage.setItem(key, JSON.stringify(Array.from(blockedFoundIds)));
}

function clearOldBlockedEntries() {
    // Remove previous-day blocked entries for current user
    if (!currentUser) return;
    const prefix = `blockedClaims:${currentUser.id}:`;
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) {
            const day = k.split(':')[2];
            const today = new Date().toISOString().slice(0, 10);
            if (day !== today) {
                localStorage.removeItem(k);
            }
        }
    }
}

// Global variables
let currentUser = null;
let finderClaimsInterval = null;
let allLostItems = [];
let allFoundItems = [];
let myActiveClaimFoundIds = new Set(); // found_item_id values with 'requested' or 'approved' claims by current user
let blockedFoundIds = new Set(); // found_item_id values blocked for today after server 429
let myClaimByFound = new Map(); // found_item_id -> { id, status }
let lockedFoundIds = new Set(); // found_item_id values locked by another user's claim or closed
let myClaimByLost = new Map(); // lost_item_id -> { id, status, finder_name, finder_email, finder_phone }
let myFinderClaimByLost = new Map(); // lost_item_id -> { id, status } where I am the finder
let lockedLostIds = new Set(); // lost_item_id values locked by an existing notify/claim or completed

// API Base URL
const API_BASE = '/api';

// DOM Elements
const navAuth = document.getElementById('nav-auth');
const navUser = document.getElementById('nav-user');
const userName = document.getElementById('user-name');
const logoutBtn = document.getElementById('logout-btn');
const loginBtn = document.getElementById('login-btn');
const registerBtn = document.getElementById('register-btn');

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    checkAuthStatus();
});

// Initialize application
function initializeApp() {
    // Set today's date as default for date inputs
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('lost-date').value = today;
    document.getElementById('found-date').value = today;
    
    // Load initial data
    loadLostItems();
    loadFoundItems();
}

// Claim handling
document.getElementById('found-items-grid').addEventListener('click', async (e) => {
    const btn = e.target.closest('.request-claim-btn');
    if (!btn) return;
    if (!currentUser) { showToast('Please login to request a claim', 'error'); return; }
    const foundId = btn.getAttribute('data-found-id');
    if (!foundId) return;
    // Open verify modal and set defaults
    const vf = document.getElementById('verify-found-id');
    const vd = document.getElementById('verify-date');
    const vt = document.getElementById('verify-time');
    const vl = document.getElementById('verify-location');
    if (vf) vf.value = String(foundId);
    // Default date to today
    const today = new Date().toISOString().split('T')[0];
    if (vd) vd.value = today;
    if (vt) vt.value = '';
    if (vl) vl.value = '';
    showModal('verify-claim-modal');
});

// Submit verification for claim
document.getElementById('verify-claim-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) { showToast('Please login to request a claim', 'error'); return; }
    const foundId = Number(document.getElementById('verify-found-id').value);
    const location = document.getElementById('verify-location').value;
    const date = document.getElementById('verify-date').value;
    const time = document.getElementById('verify-time').value;

    try {
        showLoading(true);
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/claims/verify-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ found_item_id: foundId, location, date, time: time || undefined })
        });
        const body = await res.json();
        if (res.status === 201 && body && body.success === true) {
            showToast('Request claim successful', 'success');
            // Cache claim id/status for this found item to enable 'Item Claimed Back'
            if (body.data && body.data.claim) {
                myClaimByFound.set(foundId, { id: body.data.claim.id, status: body.data.claim.status || 'approved' });
            }
            closeAllModals();
            // Refresh finder claims so finder gets notified soon
            Promise.resolve(loadFinderPendingClaims()).catch(() => {});
            // Refresh found items to update button label
            await loadFoundItems();
        } else if (res.status === 201 && body && body.success === false) {
            showToast('Verification failed', 'error');
        } else if (res.status === 429) {
            showToast(body.message || 'Maximum daily claim attempts (3) reached for this item', 'error');
            blockedFoundIds.add(foundId);
            persistBlockedFoundIds();
            displayFoundItems(allFoundItems);
            closeAllModals();
        } else if (res.status === 409) {
            // Locked by another user's claim
            showToast(body.message || 'This item is already requested by another user', 'error');
            lockedFoundIds.add(foundId);
            displayFoundItems(allFoundItems);
            closeAllModals();
        } else {
            showToast(body.message || 'Failed to submit verification', 'error');
        }
    } catch (err) {
        showToast('Failed to submit verification', 'error');
    } finally {
        showLoading(false);
    }
});

// Setup event listeners
function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', handleNavigation);
    });
    
    // Auth buttons
    loginBtn.addEventListener('click', () => showModal('login-modal'));
    registerBtn.addEventListener('click', () => showModal('register-modal'));
    logoutBtn.addEventListener('click', handleLogout);
    
    // Modal buttons
    document.getElementById('add-lost-item-btn').addEventListener('click', () => showModal('lost-item-modal'));
    document.getElementById('add-found-item-btn').addEventListener('click', () => showModal('found-item-modal'));
    
    // Close modals
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', closeAllModals);
    });
    
    // Modal background click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeAllModals();
            }
        });
    });
    
    // Forms
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    document.getElementById('lost-item-form').addEventListener('submit', handleLostItemSubmit);
    document.getElementById('found-item-form').addEventListener('submit', handleFoundItemSubmit);
    
    // Search functionality
    const foundSearch = document.getElementById('found-search');
    if (foundSearch) foundSearch.addEventListener('input', handleFoundSearch);
    const lostSearch = document.getElementById('lost-search');
    if (lostSearch) lostSearch.addEventListener('input', handleLostSearch);
    
    // Hero buttons
    document.querySelectorAll('.hero-buttons .btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const section = e.currentTarget.getAttribute('data-section');
            if (!section) return;

            // Manually switch active nav link
            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('data-section') === section) {
                    link.classList.add('active');
                }
            });

            // Manually switch visible section
            document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
            const target = document.getElementById(section);
            if (target) target.classList.add('active');

            // Open corresponding modal directly from Home after navigating
            if (section === 'lost-items') {
                showModal('lost-item-modal');
            } else if (section === 'found-items') {
                showModal('found-item-modal');
            }

        });
    });
}

// Finder pending claims panel
async function loadFinderPendingClaims() {
    const panel = document.getElementById('finder-claims');
    const list = document.getElementById('finder-claims-list');
    if (!panel || !list) return;
    if (!currentUser) { panel.style.display = 'none'; return; }

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/claims/finder/pending`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) { panel.style.display = 'none'; return; }
        const body = await res.json();
        let claims = (body.data && body.data.claims) ? body.data.claims : [];
        // De-duplicate by (found_item_id, claimer_id) keeping the most recent
        const seen = new Map();
        myFinderClaimByLost = new Map();
        for (const c of claims) {
            const key = `${c.found_item_id}-${c.claimer_id}`;
            if (!seen.has(key)) {
                seen.set(key, c);
            }
            if (c.lost_item_id) {
                myFinderClaimByLost.set(c.lost_item_id, { id: c.id, status: c.status });
            }
        }
        claims = Array.from(seen.values());
        if (claims.length === 0) { panel.style.display = 'none'; return; }

        panel.style.display = 'block';
        list.innerHTML = claims.map(c => `
            <div class="item-card">
                <div class="item-header">
                    <div>
                        <div class="item-name">${escapeHtml(c.found_item_name)}</div>
                    </div>
                    <div class="item-category">Claim</div>
                </div>
                <div class="item-details">
                    <div class="item-detail"><i class="fas fa-user"></i><span>${escapeHtml(c.claimer_name)}</span></div>
                    ${c.claimer_phone ? `<div class="item-detail"><i class="fas fa-phone"></i><span>${escapeHtml(c.claimer_phone)}</span></div>` : ''}
                    ${c.claimer_email ? `
                    <div class="item-detail claim-detail-row">
                        <span style="display:flex; align-items:center; gap:8px;"><i class="fas fa-envelope"></i><span>${escapeHtml(c.claimer_email)}</span></span>
                        <div class="item-status status-active">${escapeHtml(c.status)}</div>
                    </div>` : `
                    <div class="item-detail">
                        <div class="item-status status-active">${escapeHtml(c.status)}</div>
                    </div>`}
                </div>
                <div class="item-footer">
                    <div class="item-actions" style="display:flex; gap:8px;">
                        ${['approved','claimer_marked'].includes(c.status)
                            ? `<button class=\"btn btn-primary finder-returned\" data-claim-id=\"${c.id}\">Item Returned</button>`
                            : `<button class=\"btn btn-secondary\" disabled>Waiting</button>`}
                    </div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        panel.style.display = 'none';
    }
}

// Finder claims actions (new flow)
document.addEventListener('click', async (e) => {
    const frBtn = e.target.closest('.finder-returned');
    const ccBtn = e.target.closest('.claimer-confirm-btn');
    if (!frBtn && !ccBtn) return;

    try {
        showLoading(true);
        const token = localStorage.getItem('token');
        if (frBtn) {
            const claimId = frBtn.getAttribute('data-claim-id');
            const res = await fetch(`${API_BASE}/claims/${claimId}/finder-returned`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` } });
            const body = await res.json();
            if (res.ok) {
                showToast(body.message || 'Item return recorded', 'success');
                await loadFinderPendingClaims();
                await loadFoundItems();
            } else {
                showToast(body.message || 'Action failed', 'error');
            }
        }
        if (ccBtn) {
            const claimId = ccBtn.getAttribute('data-claim-id');
            const res2 = await fetch(`${API_BASE}/claims/${claimId}/claimer-confirm`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` } });
            const body2 = await res2.json();
            if (res2.ok) {
                showToast(body2.message || 'Claimed back recorded', 'success');
                await refreshMyActiveClaims();
                await loadFoundItems();
                await loadFinderPendingClaims();
            } else {
                showToast(body2.message || 'Action failed', 'error');
            }
        }
    } catch (err) {
        console.error('Claim action error:', err);
        showToast('Action failed', 'error');
    } finally {
        showLoading(false);
    }
});

// Navigation handling
function handleNavigation(e) {
    const section = e.currentTarget.getAttribute('data-section');
    
    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    e.currentTarget.classList.add('active');
    
    // Show section
    document.querySelectorAll('.section').forEach(sec => {
        sec.classList.remove('active');
    });
    document.getElementById(section).classList.add('active');
    
    // Load section data
    if (section === 'lost-items') {
        // Clear lost search when entering Lost Items for a fresh view
        const lsearch = document.getElementById('lost-search');
        if (lsearch) lsearch.value = '';
        loadLostItems();
    } else if (section === 'found-items') {
        // Clear search when entering Found Items for a fresh view
        const fsearch = document.getElementById('found-search');
        if (fsearch) fsearch.value = '';
        loadFoundItems();
    }
}

// Authentication functions
async function checkAuthStatus() {
    const token = localStorage.getItem('token');
    if (token) {
        try {
            const response = await fetch(`${API_BASE}/auth/profile`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                currentUser = data.data.user;
                updateAuthUI(true);
            } else {
                localStorage.removeItem('token');
                updateAuthUI(false);
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            localStorage.removeItem('token');
            updateAuthUI(false);
        }
    } else {
        updateAuthUI(false);
    }
}

function updateAuthUI(isLoggedIn) {
    if (isLoggedIn) {
        navAuth.style.display = 'none';
        navUser.style.display = 'flex';
        userName.textContent = currentUser.name;
        clearOldBlockedEntries();
        hydrateBlockedFoundIds();
        // Start polling finder pending claims to notify finders of approved requests
        if (!finderClaimsInterval) {
            finderClaimsInterval = setInterval(() => {
                if (currentUser) {
                    // Refresh finder-side pending claims panel
                    Promise.resolve(loadFinderPendingClaims()).catch(() => {});
                    // Refresh my claims so claimer-side buttons appear without full reload
                    Promise.resolve(refreshMyActiveClaims())
                        .then(() => displayFoundItems(allFoundItems))
                        .catch(() => {});
                }
            }, 30000); // every 30s
        }
    } else {
        navAuth.style.display = 'flex';
        navUser.style.display = 'none';
        currentUser = null;
        blockedFoundIds.clear();
        if (finderClaimsInterval) {
            clearInterval(finderClaimsInterval);
            finderClaimsInterval = null;
        }
    }
}

async function handleLogin(e) {
    e.preventDefault();
    showLoading(true);
    
    const formData = {
        student_id: document.getElementById('login-student-id').value,
        password: document.getElementById('login-password').value
    };
    
    try {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('token', data.data.token);
            currentUser = data.data.user;
            updateAuthUI(true);
            closeAllModals();
            showToast('Login successful!', 'success');
            document.getElementById('login-form').reset();
        } else {
            showToast(data.message || 'Login failed', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showToast('Login failed. Please try again.', 'error');
    } finally {
        showLoading(false);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    showLoading(true);
    
    const formData = {
        student_id: document.getElementById('register-student-id').value,
        name: document.getElementById('register-name').value,
        email: document.getElementById('register-email').value,
        phone: document.getElementById('register-phone').value,
        password: document.getElementById('register-password').value
    };
    
    try {
        const response = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('token', data.data.token);
            currentUser = data.data.user;
            updateAuthUI(true);
            closeAllModals();
            showToast('Registration successful!', 'success');
            document.getElementById('register-form').reset();
        } else {
            showToast(data.message || 'Registration failed', 'error');
        }
    } catch (error) {
        console.error('Registration error:', error);
        showToast('Registration failed. Please try again.', 'error');
    } finally {
        showLoading(false);
    }
}

function handleLogout() {
    localStorage.removeItem('token');
    currentUser = null;
    updateAuthUI(false);
    showToast('Logged out successfully', 'success');
    
    // Redirect to home
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    document.querySelector('[data-section="home"]').classList.add('active');
    
    document.querySelectorAll('.section').forEach(sec => {
        sec.classList.remove('active');
    });
    document.getElementById('home').classList.add('active');
}

// Item management functions
async function loadLostItems() {
    try {
        // If the Lost Items grid is not on this page, do nothing
        const grid = document.getElementById('lost-items-grid');
        if (!grid) return;
        const response = await fetch(`${API_BASE}/lost-items`);
        const data = await response.json();
        
        if (response.ok) {
            allLostItems = data.data.items || data.data || [];
            // refresh locked lost IDs so we can hide Notify Owner for others
            await refreshLockedLostIds();
            const lsearch = document.getElementById('lost-search');
            if (lsearch && lsearch.value.trim() !== '') {
                handleLostSearch({ target: lsearch });
            } else {
                displayLostItems(allLostItems);
            }
        } else {
            showToast('Failed to load lost items', 'error');
        }
    } catch (error) {
        // Only surface the toast if the grid is present on the page
        if (document.getElementById('lost-items-grid')) {
            console.error('Error loading lost items:', error);
            showToast('Failed to load lost items', 'error');
        }
    }
}

async function loadFoundItems() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/found-items`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        const data = await response.json();
        if (response.ok) {
            allFoundItems = data.data.items || data.data || [];
            await refreshMyActiveClaims();
            // Fetch locked items
            await refreshLockedFound();
            displayFoundItems(allFoundItems);
            // Load finder claims panel non-blocking; errors here shouldn't affect items list
            Promise.resolve(loadFinderPendingClaims()).catch(() => {});
        } else {
            showToast(data.message || 'Failed to fetch found items', 'error');
        }
    } catch (error) {
        console.error('Error loading found items:', error);
        showToast('Failed to load found items', 'error');
    }
}

async function refreshMyActiveClaims() {
    try {
        myActiveClaimFoundIds = new Set();
        if (!currentUser) return;
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/claims/my`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const body = await res.json();
        const claims = (body.data && body.data.claims) ? body.data.claims : [];
        myClaimByFound = new Map();
        myClaimByLost = new Map();
        claims.forEach(c => {
            if (c.found_item_id) {
                if (['requested','approved','claimer_marked','finder_marked','pending','completed'].includes(c.status)) {
                    myActiveClaimFoundIds.add(c.found_item_id);
                }
                myClaimByFound.set(c.found_item_id, { id: c.id, status: c.status });
            }
            if (c.lost_item_id) {
                myClaimByLost.set(c.lost_item_id, { id: c.id, status: c.status, finder_name: c.finder_name, finder_email: c.finder_email, finder_phone: c.finder_phone });
            }
        });
    } catch (_) { /* ignore */ }
}

function displayLostItems(items) {
    const container = document.getElementById('lost-items-grid');
    
    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>No Lost Items</h3>
                <p>No lost items have been reported yet.</p>
            </div>
        `;
        return;
    }
    // Show all items; we will control actions (e.g., Notify Owner) via button conditions.
    container.innerHTML = items.map(item => {
        const isOwner = currentUser && item.student_id === currentUser.id;
        const finderClaim = myFinderClaimByLost.get(item.id);
        const ownerClaim = myClaimByLost.get(item.id);
        const showFinderReturned = !!finderClaim && ['approved','claimer_marked'].includes(finderClaim.status);
        const showOwnerClaimedBack = !!ownerClaim && ['approved','finder_marked'].includes(ownerClaim.status);
        return `
        <div class="item-card">
            ${item.image_url ? `<div class=\"item-image\"><img src=\"${escapeHtml(item.image_url)}\" alt=\"${escapeHtml(item.item_name)}\"></div>` : ''}
            <div class="item-header" style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div class="item-name">${escapeHtml(item.item_name)}</div>
                </div>
                ${item.category ? `<div class="item-category">${escapeHtml(item.category)}</div>` : ''}
                ${isOwner ? `<button class="icon-btn lost-delete-btn" title="Delete" data-lost-id="${item.id}"><i class="fas fa-trash"></i></button>` : ''}
            </div>
            <div class="item-description">${escapeHtml(item.description)}</div>
            <div class="item-details">
                <div class="item-detail">
                    <i class="fas fa-map-marker-alt"></i>
                    <span>${escapeHtml(item.location)}</span>
                </div>
                <div class="item-detail">
                    <i class="fas fa-user"></i>
                    <span>${escapeHtml(item.student_name)}</span>
                </div>
                ${item.student_phone ? `
                <div class="item-detail">
                    <i class="fas fa-phone"></i>
                    <span>${escapeHtml(item.student_phone)}</span>
                </div>` : ''}
                ${item.student_email ? `
                <div class="item-detail">
                    <i class="fas fa-envelope"></i>
                    <span>${escapeHtml(item.student_email)}</span>
                </div>` : ''}
                ${isOwner && ownerClaim ? `
                <div class="item-detail">
                    <i class="fas fa-user-check"></i>
                    <span>${escapeHtml(ownerClaim.finder_name || '')}</span>
                </div>
                ${ownerClaim.finder_phone ? `<div class="item-detail"><i class=\"fas fa-phone\"></i><span>${escapeHtml(ownerClaim.finder_phone)}</span></div>` : ''}
                ${ownerClaim.finder_email ? `<div class="item-detail"><i class=\"fas fa-envelope\"></i><span>${escapeHtml(ownerClaim.finder_email)}</span></div>` : ''}
                ` : ''}
            </div>
            <div class="item-footer">
                <div class="item-date">Lost: ${formatDate(item.date_lost)}${formatTimeSuffix(item.time_lost)}</div>
                <div class="item-status status-${item.status}">${item.status}</div>
            </div>
            ${currentUser && item.status === 'active' ? `
            <div class="item-actions" style="margin-top: 8px; display: flex; justify-content: flex-end; gap:8px;">
                ${showFinderReturned ? `<button class=\"btn btn-primary lost-finder-returned\" data-claim-id=\"${finderClaim.id}\">Item Returned</button>` : ''}
                ${isOwner && showOwnerClaimedBack ? `<button class=\"btn btn-primary lost-claimer-confirm\" data-claim-id=\"${ownerClaim.id}\">Item Claimed Back</button>` : ''}
                ${(!isOwner && !finderClaim && !ownerClaim && !lockedLostIds.has(item.id)) ? `<button class=\"btn btn-secondary notify-owner-btn\" data-lost-id=\"${item.id}\">Notify Owner</button>` : ''}
            </div>` : ''}
        </div>`;
    }).join('');
}

function displayFoundItems(items) {
    const container = document.getElementById('found-items-grid');

    // Filter: hide locked found items for everyone except
    // - the finder (owner of the found post), or
    // - the claimer who has an active claim on this found item
    const filtered = (items || []).filter(item => {
        if (!currentUser) return !lockedFoundIds.has(item.id);
        const isFinder = item.finder_id === currentUser.id;
        const iHaveClaim = myClaimByFound.has(item.id);
        if (lockedFoundIds.has(item.id)) {
            return isFinder || iHaveClaim;
        }
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>No Found Items</h3>
                <p>No found items have been reported yet.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(item => {
        const isOwner = !!currentUser && item.finder_id === currentUser.id;
        return `
        <div class="item-card">
            ${item.image_url ? `<div class=\"item-image\"><img src=\"${escapeHtml(item.image_url)}\" alt=\"${escapeHtml(item.item_name)}\"></div>` : ''}
            <div class="item-header" style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <h3>${escapeHtml(item.item_name)}</h3>
                </div>
                ${item.category ? `<div class="item-category">${escapeHtml(item.category)}</div>` : ''}
                ${isOwner ? `<button class="icon-btn found-delete-btn" title="Delete" data-found-id="${item.id}"><i class="fas fa-trash"></i></button>` : ''}
            </div>
            <div class="item-description">${escapeHtml(item.description)}</div>
            <div class="item-details">
                ${isOwner ? `
                <div class="item-detail">
                    <i class="fas fa-map-marker-alt"></i>
                    <span>${escapeHtml(item.location)}</span>
                </div>` : ''}
                <div class="item-detail">
                    <i class="fas fa-user"></i>
                    <span>${escapeHtml(item.finder_name)}</span>
                </div>
                ${item.finder_phone ? `
                <div class="item-detail">
                    <i class="fas fa-phone"></i>
                    <span>${escapeHtml(item.finder_phone)}</span>
                </div>` : ''}
                ${item.finder_email ? `
                <div class="item-detail">
                    <i class="fas fa-envelope"></i>
                    <span>${escapeHtml(item.finder_email)}</span>
                </div>` : ''}
            </div>
            <div class="item-footer">
                ${isOwner ? `<div class="item-date">Found: ${formatDate(item.date_found)}${formatTimeSuffix(item.time_found)}</div>` : ''}
                <div class="item-status status-${item.status}">${item.status}</div>
            </div>
            ${currentUser && item.status === 'active' && !isOwner ? `
            <div class="item-actions" style="margin-top: 8px; display: flex; justify-content: flex-end;">
                ${(() => {
                    if (blockedFoundIds.has(item.id)) return `<button class=\"btn btn-secondary\" disabled>Blocked</button>`;
                    const my = myClaimByFound.get(item.id);
                    if (!my && lockedFoundIds.has(item.id)) {
                        return `<button class=\"btn btn-secondary\" disabled>Requested</button>`;
                    }
                    if (my && ['approved','finder_marked','claimer_marked','pending'].includes(my.status)) {
                        return `<button class=\"btn btn-primary claimer-confirm-btn\" data-claim-id=\"${my.id}\">Item Claimed Back</button>`;
                    }
                    return `<button class=\"btn btn-secondary request-claim-btn\" data-found-id=\"${item.id}\">Request Claim</button>`;
                })()}
            </div>` : ''}
        </div>`;
    }).join('');
}

// Delete handlers for Lost/Found items (owner only)
document.addEventListener('click', async (e) => {
    const lostDelBtn = e.target.closest('.lost-delete-btn');
    const foundDelBtn = e.target.closest('.found-delete-btn');
    if (!lostDelBtn && !foundDelBtn) return;
    if (!currentUser) { showToast('Please login first', 'error'); return; }
    try {
        const token = localStorage.getItem('token');
        if (lostDelBtn) {
            const id = Number(lostDelBtn.getAttribute('data-lost-id'));
            const ok = await confirmDialog('Delete this lost item?');
            if (!ok) return;
            const res = await fetch(`${API_BASE}/lost-items/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            const body = await res.json();
            if (res.ok) {
                showToast('Lost item deleted', 'success');
                await loadLostItems();
            } else {
                showToast(body.message || 'Failed to delete lost item', 'error');
            }
        } else if (foundDelBtn) {
            const id = Number(foundDelBtn.getAttribute('data-found-id'));
            const ok = await confirmDialog('Delete this found item?');
            if (!ok) return;
            const res = await fetch(`${API_BASE}/found-items/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            const body = await res.json();
            if (res.ok) {
                showToast('Found item deleted', 'success');
                await loadFoundItems();
            } else {
                showToast(body.message || 'Failed to delete found item', 'error');
            }
        }
    } catch (_) {
        showToast('Action failed', 'error');
    }
});

// Lightweight confirmation modal (UI mode) that returns a Promise<boolean>
function confirmDialog(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0,0,0,0.5)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '10000';

        const modal = document.createElement('div');
        modal.style.background = '#1f1f2e';
        modal.style.color = '#fff';
        modal.style.borderRadius = '12px';
        modal.style.minWidth = '320px';
        modal.style.maxWidth = '90%';
        modal.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';
        modal.style.padding = '20px';

        const msg = document.createElement('div');
        msg.textContent = message || 'Are you sure?';
        msg.style.marginBottom = '16px';
        msg.style.fontSize = '16px';

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '10px';
        actions.style.justifyContent = 'flex-end';

        const okBtn = document.createElement('button');
        okBtn.className = 'btn btn-primary';
        okBtn.textContent = 'Delete';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.textContent = 'Cancel';

        function cleanup(val) {
            overlay.remove();
            resolve(val);
        }

        okBtn.addEventListener('click', () => cleanup(true));
        cancelBtn.addEventListener('click', () => cleanup(false));
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) cleanup(false); });
        document.addEventListener('keydown', function onKey(ev) {
            if (ev.key === 'Escape') { document.removeEventListener('keydown', onKey); cleanup(false); }
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(okBtn);
        modal.appendChild(msg);
        modal.appendChild(actions);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    });
}

// Search functionality
function handleFoundSearch(e) {
    const searchTerm = e.target.value.toLowerCase();
    
    if (searchTerm === '') {
        displayFoundItems(allFoundItems);
        return;
    }
    
    const filteredItems = allFoundItems.filter(item => 
        item.item_name.toLowerCase().includes(searchTerm) ||
        item.description.toLowerCase().includes(searchTerm) ||
        item.location.toLowerCase().includes(searchTerm) ||
        (item.category && item.category.toLowerCase().includes(searchTerm))
    );
    
    displayFoundItems(filteredItems);
}

function handleLostSearch(e) {
    const searchTerm = e.target.value.toLowerCase();
    if (searchTerm === '') { displayLostItems(allLostItems); return; }
    const filtered = allLostItems.filter(item =>
        item.item_name.toLowerCase().includes(searchTerm) ||
        item.description.toLowerCase().includes(searchTerm) ||
        item.location.toLowerCase().includes(searchTerm) ||
        (item.category && item.category.toLowerCase().includes(searchTerm))
    );
    displayLostItems(filtered);
}

// Notify Owner flow
document.getElementById('lost-items-grid').addEventListener('click', async (e) => {
    const notifyBtn = e.target.closest('.notify-owner-btn');
    if (!notifyBtn) return;
    if (!currentUser) { showToast('Please login first', 'error'); return; }

    const lostId = notifyBtn.getAttribute('data-lost-id');
    // Derive my active found items from cached allFoundItems
    const myActiveFound = (allFoundItems || []).filter(i => i.finder_id === currentUser.id && i.status === 'active');
    if (myActiveFound.length === 0) {
        // No active found items -> notify directly without linking
        try {
            showLoading(true);
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE}/claims/notify-owner`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ lost_item_id: Number(lostId) })
            });
            const body = await res.json();
            if (res.ok) {
                showToast('Owner notified successfully', 'success');
                const claim = (await (async() => { try { return (await res.clone().json()).data.claim; } catch(_) { return null; } })());
                lockedLostIds.add(Number(lostId));
                if (claim && claim.id) {
                    myFinderClaimByLost.set(Number(lostId), { id: claim.id, status: claim.status || 'pending' });
                }
                displayLostItems(allLostItems);
                Promise.resolve(loadFinderPendingClaims()).catch(()=>{});
            } else if (res.status === 409) {
                showToast(body.message || 'This lost item has already been notified by another user', 'error');
                lockedLostIds.add(Number(lostId));
                displayLostItems(allLostItems);
            } else {
                showToast(body.message || 'Failed to notify owner', 'error');
            }
        } catch (_) {
            showToast('Failed to notify owner', 'error');
        } finally {
            showLoading(false);
        }
        return;
    }

    // Populate select
    const select = document.getElementById('notify-found-select');
    const hiddenLost = document.getElementById('notify-lost-id');
    if (!select || !hiddenLost) return;
    hiddenLost.value = String(lostId);
    select.innerHTML = '<option value="">Select your found item</option>' +
        myActiveFound.map(i => `<option value="${i.id}">${escapeHtml(i.item_name)} — ${escapeHtml(i.location)} (${formatDate(i.date_found)})</option>`).join('');

    showModal('notify-owner-modal');
});

document.getElementById('notify-owner-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) { showToast('Please login first', 'error'); return; }
    const lostId = document.getElementById('notify-lost-id').value;
    const foundId = document.getElementById('notify-found-select').value;
    if (!lostId || !foundId) { showToast('Please select a found item', 'error'); return; }

    try {
        showLoading(true);
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/claims/notify-owner`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ lost_item_id: Number(lostId), found_item_id: Number(foundId) })
        });
        const body = await res.json();
        if (res.ok) {
            showToast('Owner notified successfully', 'success');
            closeAllModals();
            try {
                const claim = body.data && body.data.claim ? body.data.claim : null;
                if (claim && claim.lost_item_id) {
                    lockedLostIds.add(Number(claim.lost_item_id));
                    myFinderClaimByLost.set(Number(claim.lost_item_id), { id: claim.id, status: claim.status || 'pending' });
                }
            } catch(_){}
            displayLostItems(allLostItems);
            Promise.resolve(loadFinderPendingClaims()).catch(()=>{});
        } else {
            showToast(body.message || 'Failed to notify owner', 'error');
        }
    } catch (err) {
        showToast('Failed to notify owner', 'error');
    } finally {
        showLoading(false);
    }
});

// Form submissions
async function handleLostItemSubmit(e) {
    e.preventDefault();
    
    if (!currentUser) {
        showToast('Please login to report a lost item', 'error');
        return;
    }
    
    showLoading(true);
    
    const formEl = document.getElementById('lost-item-form');
    const formData = new FormData();
    formData.append('item_name', document.getElementById('lost-item-name').value);
    formData.append('description', document.getElementById('lost-description').value);
    formData.append('location', document.getElementById('lost-location').value);
    formData.append('date_lost', document.getElementById('lost-date').value);
    const tl = document.getElementById('lost-time').value; if (tl) formData.append('time_lost', tl);
    const lc = document.getElementById('lost-category').value; if (lc) formData.append('category', lc);
    const lostFile = document.getElementById('lost-image').files[0];
    if (lostFile) formData.append('image', lostFile);
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/lost-items`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast('Lost item reported successfully!', 'success');
            closeAllModals();
            document.getElementById('lost-item-form').reset();
            loadLostItems();
        } else {
            showToast(data.message || 'Failed to report lost item', 'error');
        }
    } catch (error) {
        console.error('Error reporting lost item:', error);
        showToast('Failed to report lost item', 'error');
    } finally {
        showLoading(false);
    }
}

async function handleFoundItemSubmit(e) {
    e.preventDefault();
    
    if (!currentUser) {
        showToast('Please login to report a found item', 'error');
        return;
    }
    
    showLoading(true);
    
    const fd = new FormData();
    fd.append('item_name', document.getElementById('found-item-name').value);
    fd.append('description', document.getElementById('found-description').value);
    fd.append('location', document.getElementById('found-location').value);
    fd.append('date_found', document.getElementById('found-date').value);
    const tf = document.getElementById('found-time').value; if (tf) fd.append('time_found', tf);
    const fc = document.getElementById('found-category').value; if (fc) fd.append('category', fc);
    const foundFile = document.getElementById('found-image').files[0];
    if (foundFile) fd.append('image', foundFile);
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/found-items`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: fd
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast('Found item reported successfully!', 'success');
            closeAllModals();
            document.getElementById('found-item-form').reset();
            // Clear search and reload items so the new item appears
            const search = document.getElementById('found-search');
            if (search) search.value = '';
            loadFoundItems();
        } else {
            showToast(data.message || 'Failed to report found item', 'error');
        }
    } catch (error) {
        console.error('Error reporting found item:', error);
        showToast('Failed to report found item', 'error');
    } finally {
        showLoading(false);
    }
}

// Utility functions
function showModal(modalId) {
    if (!currentUser && (modalId === 'lost-item-modal' || modalId === 'found-item-modal')) {
        showToast('Please login to report items', 'error');
        return;
    }
    
    document.getElementById(modalId).style.display = 'block';
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
}

function showLoading(show) {
    const loading = document.getElementById('loading');
    if (show) {
        loading.classList.add('show');
    } else {
        loading.classList.remove('show');
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<div class="toast-message">${message}</div>`;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 5000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
        // Try to normalize plain date (YYYY-MM-DD) by appending T00:00:00
        try {
            const alt = new Date(`${dateString}T00:00:00`);
            if (!isNaN(alt.getTime())) {
                return alt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            }
        } catch (_) { /* ignore */ }
        return String(dateString);
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTimeSuffix(timeString) {
    if (!timeString) return '';
    // Accepts 'HH:MM:SS' or 'HH:MM'
    try {
        const [hStr, mStr] = String(timeString).split(':');
        let h = parseInt(hStr, 10);
        const m = parseInt(mStr || '0', 10).toString().padStart(2, '0');
        if (Number.isNaN(h)) return '';
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12; if (h === 0) h = 12;
        return `, ${h}:${m} ${ampm}`;
    } catch (_) {
        return '';
    }
}
