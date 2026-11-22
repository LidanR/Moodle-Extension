// Runs at document_start to apply dark mode & brand gradient BEFORE first paint (zero flash)
(function () {
	'use strict';

	const THEME_KEY = 'jct-theme-mode';
	const GRADIENT_KEY = 'jct-header-gradient';
	const html = document.documentElement;

	function resolveIsDark(mode) {
		if (mode === 'dark') return true;
		if (mode === 'auto') {
			return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
		}
		return false;
	}

	function applyEarlyTheme(mode) {
		const isDark = resolveIsDark(mode);
		html.classList.toggle('jct-dark', isDark);
		html.style.colorScheme = isDark ? 'dark' : 'light';
		html.style.backgroundColor = isDark ? '#0f172a' : '';
	}

	function applyEarlyGradient(colors) {
		if (Array.isArray(colors) && colors.length >= 2 && colors[0] && colors[1]) {
			html.style.setProperty('--jct-brand-start', colors[0]);
			html.style.setProperty('--jct-brand-end', colors[1]);
		}
	}

	// 1. Synchronous read from localStorage for instant zero-flash paint
	try {
		const cachedTheme = localStorage.getItem(THEME_KEY);
		if (cachedTheme === 'dark' || cachedTheme === 'light' || cachedTheme === 'auto') {
			applyEarlyTheme(cachedTheme);
		}
		const cachedGrad = localStorage.getItem(GRADIENT_KEY);
		if (cachedGrad) {
			applyEarlyGradient(JSON.parse(cachedGrad));
		}
	} catch (_e) { /* ignore */ }

	// 2. Reconcile with chrome.storage.sync
	try {
		if (chrome?.storage?.sync) {
			chrome.storage.sync.get({ themeMode: 'light', headerGradient: null }, (res) => {
				if (chrome.runtime.lastError) return;
				const mode = res.themeMode || 'light';
				applyEarlyTheme(mode);
				try { localStorage.setItem(THEME_KEY, mode); } catch (_e) { /* ignore */ }

				if (Array.isArray(res.headerGradient) && res.headerGradient.length >= 2) {
					applyEarlyGradient(res.headerGradient);
					try { localStorage.setItem(GRADIENT_KEY, JSON.stringify(res.headerGradient)); } catch (_e) { /* ignore */ }
				}
			});
		}
	} catch (_e) { /* ignore */ }
})();
