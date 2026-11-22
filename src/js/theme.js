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
		updateToggleButtonUI
	};
})(window.JCT = window.JCT || {});
