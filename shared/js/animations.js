/* Animations — Auto-stagger entrance system + improved toast */
/* Loaded after common.js */

(function () {
    'use strict';

    // ==========================================
    // Configuration
    // ==========================================

    const STAGGER_MS = 50;          // Delay between each item
    const BASE_DELAY_MS = 80;       // Initial delay before first animation
    const OBSERVE_THROTTLE = 100;   // Throttle observer callbacks

    // CSS selectors that get auto-animated on appearance
    const ANIMATE_SELECTORS = [
        '.stat-card',
        '.card',
        '.browse-card',
        '.radio-item',
        '.input-card',
        '.nav-section',
        '.queue-item',
        '.section-header',
        '.tabs',
        '.search-bar',
        '.now-playing-hero',
        '.section',
        '.browse-card-body',
        '[data-animate]'
    ];

    const SELECTOR_STRING = ANIMATE_SELECTORS.join(',');

    // Track animated elements to avoid re-animating
    const animated = new WeakSet();

    // ==========================================
    // Stagger entrance engine
    // ==========================================

    function animateElements(container) {
        const elements = container.querySelectorAll
            ? container.querySelectorAll(SELECTOR_STRING)
            : [];

        // Also check if container itself matches
        const targets = [];
        if (container.matches && container.matches(SELECTOR_STRING) && !animated.has(container)) {
            targets.push(container);
        }
        elements.forEach(el => {
            if (!animated.has(el)) targets.push(el);
        });

        if (targets.length === 0) return;

        targets.forEach((el, i) => {
            animated.add(el);
            el.classList.add('anim-ready');

            // Determine animation type from data attribute or default
            const type = el.dataset.animate || 'fade-up';

            requestAnimationFrame(() => {
                const delay = BASE_DELAY_MS + (i * STAGGER_MS);
                el.style.setProperty('--anim-delay', delay + 'ms');
                el.classList.remove('anim-ready');
                el.classList.add('anim-in', `anim-${type}`);

                // Cleanup after animation
                el.addEventListener('animationend', function handler() {
                    el.removeEventListener('animationend', handler);
                    el.classList.remove('anim-in', `anim-${type}`, 'anim-ready');
                    el.style.removeProperty('--anim-delay');
                }, { once: true });
            });
        });
    }

    // ==========================================
    // MutationObserver — watch for new elements
    // ==========================================

    let observerTimeout = null;
    let pendingNodes = [];

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    pendingNodes.push(node);
                }
            }
        }

        // Throttle processing
        if (observerTimeout) return;
        observerTimeout = setTimeout(() => {
            const nodes = pendingNodes.splice(0);
            for (const node of nodes) {
                animateElements(node);
            }
            observerTimeout = null;
        }, OBSERVE_THROTTLE);
    });

    // ==========================================
    // Toast system (replaces showToast from common.js)
    // ==========================================

    const TOAST_ICONS = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    let toastContainer = null;

    function ensureContainer() {
        if (!toastContainer || !document.body.contains(toastContainer)) {
            toastContainer = document.createElement('div');
            toastContainer.className = 'toast-container';
            document.body.appendChild(toastContainer);
        }
        return toastContainer;
    }

    function showToastNew(message, type = 'info', duration = 3000) {
        const container = ensureContainer();

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icon = TOAST_ICONS[type] || TOAST_ICONS.info;
        toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-message">${escapeHtml(message)}</span>`;

        container.appendChild(toast);

        // Max 4 toasts visible
        const toasts = container.querySelectorAll('.toast:not(.toast-exit)');
        if (toasts.length > 4) {
            dismissToast(toasts[0]);
        }

        // Auto-dismiss
        const timer = setTimeout(() => dismissToast(toast), duration);

        // Click to dismiss
        toast.addEventListener('click', () => {
            clearTimeout(timer);
            dismissToast(toast);
        });

        return toast;
    }

    function dismissToast(toast) {
        if (!toast || toast.classList.contains('toast-exit')) return;
        toast.classList.add('toast-exit');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }

    // ==========================================
    // Initialize
    // ==========================================

    function init() {
        // Initial page animation
        animateElements(document.body);

        // Watch for dynamically added elements (Vue.js, etc.)
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Override global showToast
        window.showToast = showToastNew;
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for manual use
    window.animateElements = animateElements;
    window.showToastNew = showToastNew;

})();
