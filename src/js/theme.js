(function (JCT) {
	'use strict';

	const LOCAL_CACHE_KEY = 'jct-theme-mode';
	const LOCAL_GRADIENT_KEY = 'jct-header-gradient';
	const mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

	function isSystemDark() {
		return Boolean(mediaQuery && mediaQuery.matches);
	}

	function getEffectiveTheme(mode = JCT.state.themeMode) {
		if (mode === 'dark') return 'dark';
		if (mode === 'auto') return isSystemDark() ? 'dark' : 'light';
		return 'light';
	}

	function updateToggleButtonUI() {
		const btn = document.getElementById('jct-navbar-theme-toggle');
		if (!btn) return;
		const effective = getEffectiveTheme();
		btn.textContent = effective === 'dark' ? '☀️' : '🌙';
		btn.title = effective === 'dark' ? 'מעבר למצב בהיר' : 'מעבר למצב כהה';
		btn.setAttribute('aria-pressed', effective === 'dark' ? 'true' : 'false');
	}

	function applyTheme(mode) {
		const normalized = mode === 'dark' || mode === 'auto' ? mode : 'light';
		JCT.state.themeMode = normalized;
		const isDark = getEffectiveTheme(normalized) === 'dark';

		const html = document.documentElement;
		html.classList.toggle('jct-dark', isDark);
		html.style.colorScheme = isDark ? 'dark' : 'light';
		html.style.backgroundColor = '';

		try {
			localStorage.setItem(LOCAL_CACHE_KEY, normalized);
		} catch (_e) { /* ignore */ }

		updateToggleButtonUI();
	}

	async function setThemeMode(mode) {
		const normalized = mode === 'dark' || mode === 'auto' ? mode : 'light';
		applyTheme(normalized);
		await JCT.storage.storageSet('sync', { themeMode: normalized });
	}

	async function toggleDarkMode() {
		const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
		await setThemeMode(next);
	}

	function applyHeaderGradient(colors) {
		const defaults = JCT.config.DEFAULT_HEADER_GRADIENT;
		const pair =
			Array.isArray(colors) && colors.length >= 2 && colors[0] && colors[1]
				? [colors[0], colors[1]]
				: defaults.slice();
		JCT.state.headerGradient = pair;

		const html = document.documentElement;
		html.style.setProperty('--jct-brand-start', pair[0]);
		html.style.setProperty('--jct-brand-end', pair[1]);

		try {
			localStorage.setItem(LOCAL_GRADIENT_KEY, JSON.stringify(pair));
		} catch (_e) { /* ignore */ }
	}

	async function setHeaderGradient(colors) {
		applyHeaderGradient(colors);
		await JCT.storage.storageSet('sync', { headerGradient: JCT.state.headerGradient });
	}

	// Inject a compact dark/light toggle right in Moodle's top navbar so it works on EVERY page
	function ensureNavbarToggle() {
		if (document.getElementById('jct-navbar-theme-toggle')) {
			updateToggleButtonUI();
			return;
		}

		const navRight = document.querySelector(
			'#usernavigation, .navbar .usernav, .navbar ul.navbar-nav.ml-auto, .navbar ul.navbar-nav.ms-auto, header.navbar .d-flex'
		);
		if (!navRight) return;

		const btn = document.createElement('button');
		btn.type = 'button';
		btn.id = 'jct-navbar-theme-toggle';
		btn.className = 'jct-navbar-theme-toggle';
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			toggleDarkMode();
		});

		navRight.insertBefore(btn, navRight.firstChild);
		updateToggleButtonUI();
	}

	// Dynamically collapse top navbar to hamburger whenever items would collide/overflow
	let navbarResponsiveBound = false;
	function setupNavbarResponsive() {
		if (navbarResponsiveBound) return;
		const nav = document.querySelector('nav.navbar.fixed-top, nav.navbar');
		if (!nav) return;

		const toggler = nav.querySelector('.navbar-toggler');
		const primaryNav = nav.querySelector('.primary-navigation');
		if (!toggler || !primaryNav) return;

		navbarResponsiveBound = true;
		const html = document.documentElement;
		let cachedRequiredWidth = 0;

		function measureExpandedWidth() {
			const container = nav.querySelector(':scope > .container-fluid') || nav;
			const style = window.getComputedStyle(container);
			const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
			let needed = pad + 40; // safety breathing room

			const brand = nav.querySelector('.navbar-brand');
			if (brand) needed += brand.getBoundingClientRect().width + 12;

			const userNav = nav.querySelector('#usernavigation');
			if (userNav) needed += userNav.getBoundingClientRect().width + 12;

			// Sum all visible primary nav items (use scrollWidth of .more-nav if larger)
			const moreNav = primaryNav.querySelector('.more-nav');
			let primaryNeeded = 0;
			if (moreNav) {
				const items = moreNav.querySelectorAll(':scope > .nav-item:not(.d-none):not([hidden])');
				items.forEach((item) => {
					primaryNeeded += item.getBoundingClientRect().width + 4;
				});
				primaryNeeded = Math.max(primaryNeeded, moreNav.scrollWidth);
			} else {
				primaryNeeded = primaryNav.scrollWidth;
			}
			needed += primaryNeeded;

			// Include any secondary direct navbar-nav lists (e.g. Boost Union custom menus)
			container.querySelectorAll(':scope > ul.navbar-nav').forEach((ul) => {
				if (ul.id === 'usernavigation') return;
				needed += ul.scrollWidth + 8;
			});

			return Math.ceil(needed);
		}

		function checkNavbarFit() {
			// Do not toggle compact mode while the desktop search bar is open
			const searchCollapse = nav.querySelector('#searchform-navbar');
			if (searchCollapse && searchCollapse.classList.contains('show') && !html.classList.contains('jct-nav-compact')) {
				return;
			}

			const navWidth = nav.clientWidth;
			if (!navWidth) return;

			if (window.innerWidth < 992) {
				html.classList.add('jct-nav-compact');
				return;
			}

			const isCompact = html.classList.contains('jct-nav-compact');

			if (!isCompact) {
				const needed = measureExpandedWidth();
				cachedRequiredWidth = needed;
				const moreNav = primaryNav.querySelector('.more-nav');
				const overflowsPrimary = moreNav ? moreNav.scrollWidth > primaryNav.clientWidth + 2 : false;
				if (needed > navWidth || overflowsPrimary) {
					html.classList.add('jct-nav-compact');
				}
			} else if (cachedRequiredWidth === 0 || navWidth >= cachedRequiredWidth + 20) {
				// Temporarily expand synchronously to measure actual fit (no visible flash)
				html.classList.remove('jct-nav-compact');
				const needed = measureExpandedWidth();
				cachedRequiredWidth = needed;
				const moreNav = primaryNav.querySelector('.more-nav');
				const overflowsPrimary = moreNav ? moreNav.scrollWidth > primaryNav.clientWidth + 2 : false;
				if (needed > navWidth || overflowsPrimary) {
					html.classList.add('jct-nav-compact');
				}
			}
		}

		if (typeof ResizeObserver !== 'undefined') {
			const ro = new ResizeObserver(() => checkNavbarFit());
			ro.observe(nav);
		}
		window.addEventListener('resize', checkNavbarFit, { passive: true });
		if (document.fonts && document.fonts.ready) {
			document.fonts.ready.then(checkNavbarFit).catch(() => {});
		}

		// Keep 0 / empty notification & message count badges strictly hidden
		// Observe only the badge nodes themselves (never the toggle buttons or drawer attributes)
		let syncingBadges = false;
		function syncBadge(badge) {
			const visibleNumEl = badge.querySelector('span[aria-hidden="true"]');
			const raw = (visibleNumEl ? visibleNumEl.textContent : badge.textContent || '').trim();
			const num = parseInt(raw, 10);
			const shouldHide = !raw || isNaN(num) || num <= 0;
			if (badge.classList.contains('jct-count-zero') !== shouldHide) {
				badge.classList.toggle('jct-count-zero', shouldHide);
			}
		}

		function syncCountBadges() {
			if (syncingBadges) return;
			syncingBadges = true;
			try {
				nav.querySelectorAll('.count-container, [data-region="count-container"]').forEach(syncBadge);
			} finally {
				syncingBadges = false;
			}
		}

		syncCountBadges();
		if (typeof MutationObserver !== 'undefined') {
			nav.querySelectorAll('.count-container, [data-region="count-container"]').forEach((badge) => {
				const badgeObs = new MutationObserver(() => syncCountBadges());
				badgeObs.observe(badge, {
					childList: true,
					subtree: true,
					characterData: true
				});
			});
		}

		// Run immediately and once more after Moodle's moremenu settles
		checkNavbarFit();
		setTimeout(() => {
			syncCountBadges();
			checkNavbarFit();
		}, 350);
	}

	if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
		mediaQuery.addEventListener('change', () => {
			if (JCT.state.themeMode === 'auto') {
				applyTheme('auto');
			}
		});
	}

	JCT.theme = {
		getEffectiveTheme,
		applyTheme,
		setThemeMode,
		toggleDarkMode,
		applyHeaderGradient,
		setHeaderGradient,
		ensureNavbarToggle,
		setupNavbarResponsive,
		updateToggleButtonUI
	};
})(window.JCT = window.JCT || {});
