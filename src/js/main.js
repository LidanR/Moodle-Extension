(function (JCT) {
	'use strict';

	const { CARD_CLOSEST_SELECTOR, DEFAULT_COLUMN_COUNT } = JCT.config;
	const { getCourseIdFromCard } = JCT.utils;

	const EXTENSION_OWNED_SELECTOR = [
		'#jct-weekly-schedule',
		'#jct-navbar-theme-toggle',
		'.jct-assignments-modal',
		'.jct-calendar-modal',
		'.jct-schedule-modal',
		'.jct-time-picker-dialog',
		'.jct-scan-warning-modal',
		'.jct-day-details-modal',
		'.jct-event-edit-modal',
		'.jct-todo-modal',
		'.jct-whats-new-modal'
	].join(', ');

	let scheduled = false;

	function docReady(fn) {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', fn, { once: true });
		} else {
			fn();
		}
	}

	function scheduleLightUpdate() {
		if (scheduled || JCT.state.isReordering) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;

			if (JCT.state.currentViewMode === 'carousel') {
				if (document.querySelector('.jct-courses-grid .jct-semester-group')) {
					return;
				}
			}

			JCT.courses.removeUnwantedCourses();
			JCT.courses.hideFrontClutter();
			JCT.courses.markCoursesContainers();
			JCT.courses.setupCourseSearchBox();
			JCT.courses.ensureStructureAndColor();
			JCT.courses.refreshFavoritesUI();
			JCT.courses.applyViewMode(JCT.state.currentViewMode);
		});
	}

	function isMutationExternal(mutations) {
		for (const m of mutations) {
			const target = m.target instanceof Element ? m.target : m.target?.parentElement;
			if (!target) continue;
			if (target.closest(EXTENSION_OWNED_SELECTOR)) continue;
			if (target === document.body) {
				const nodes = [...m.addedNodes, ...m.removedNodes];
				const allOwn = nodes.length > 0 && nodes.every(
					(n) => n instanceof Element && n.matches(EXTENSION_OWNED_SELECTOR)
				);
				if (allOwn) continue;
			}
			return true;
		}
		return false;
	}

	function addActionButtons() {
		const body = document.body;
		if (!body || body.id !== 'page-site-index') return;

		if (
			document.getElementById('jct-settings-button') ||
			document.getElementById('jct-show-all-assignments-button')
		) {
			return;
		}

		const pageHeader = document.querySelector('#page-header, .page-header');

		const settingsBtn = document.createElement('button');
		settingsBtn.type = 'button';
		settingsBtn.id = 'jct-settings-button';
		settingsBtn.className = 'jct-settings-button';
		settingsBtn.innerHTML = '⚙️ אפשרויות';
		settingsBtn.title = 'פתח את אפשרויות התוסף';
		settingsBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			JCT.modals.showSettingsModal();
		});

		const assignmentsBtn = document.createElement('button');
		assignmentsBtn.type = 'button';
		assignmentsBtn.id = 'jct-show-all-assignments-button';
		assignmentsBtn.className = 'jct-settings-button jct-assignments-button';
		assignmentsBtn.innerHTML = '📝 כל המטלות';
		assignmentsBtn.title = 'הצג את כל המטלות מכל הקורסים';
		assignmentsBtn.addEventListener('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (assignmentsBtn.disabled || document.querySelector('.jct-assignments-modal')) return;

			assignmentsBtn.disabled = true;
			assignmentsBtn.innerHTML = '⏳ טוען...';
			try {
				await JCT.modals.showAllAssignmentsModal();
			} finally {
				assignmentsBtn.disabled = false;
				assignmentsBtn.innerHTML = '📝 כל המטלות';
			}
		});

		const calendarBtn = document.createElement('button');
		calendarBtn.type = 'button';
		calendarBtn.id = 'jct-calendar-button';
		calendarBtn.className = 'jct-settings-button jct-calendar-button';
		calendarBtn.innerHTML = '📅 לוח שנה';
		calendarBtn.title = 'הצג לוח שנה עם מטלות ואירועים';
		calendarBtn.addEventListener('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (calendarBtn.disabled || document.querySelector('.jct-calendar-modal')) return;

			calendarBtn.disabled = true;
			calendarBtn.innerHTML = '⏳ טוען...';
			try {
				await JCT.modals.showCalendarModal();
			} finally {
				calendarBtn.disabled = false;
				calendarBtn.innerHTML = '📅 לוח שנה';
			}
		});

		const actionsContainer = document.getElementById('jct-schedule-actions');
		if (actionsContainer) {
			actionsContainer.appendChild(calendarBtn);
			actionsContainer.appendChild(assignmentsBtn);
			actionsContainer.appendChild(settingsBtn);
		} else if (pageHeader && pageHeader.parentElement) {
			const btnRow = document.createElement('div');
			btnRow.className = 'jct-schedule-actions';
			btnRow.appendChild(calendarBtn);
			btnRow.appendChild(assignmentsBtn);
			btnRow.appendChild(settingsBtn);
			pageHeader.parentElement.insertBefore(btnRow, pageHeader.nextSibling);
		}

		JCT.storage.getAssignmentsCache().then(({ cache }) => {
			if (cache && Array.isArray(cache.assignments) && cache.assignments.length > 0) return;
			const wrapper = assignmentsBtn.parentElement;
			if (!wrapper || wrapper.querySelector('.jct-scan-hint-bubble')) return;
			wrapper.style.position = 'relative';

			const bubble = document.createElement('div');
			bubble.className = 'jct-scan-hint-bubble';
			bubble.textContent = 'לחצו כאן כדי לסרוק את המטלות שלכם';
			wrapper.appendChild(bubble);

			assignmentsBtn.addEventListener('click', () => bubble.remove(), { once: true });
		});
	}

	function setupGlobalListeners() {
		const obs = new MutationObserver((mutations) => {
			if (isMutationExternal(mutations)) {
				scheduleLightUpdate();
			}
		});
		obs.observe(document.body, { childList: true, subtree: true });

		if (chrome?.storage?.onChanged) {
			chrome.storage.onChanged.addListener((changes, area) => {
				if (area === 'sync' && changes.themeMode) {
					JCT.theme.applyTheme(changes.themeMode.newValue || 'light');
				}
				if (area === 'sync' && changes.headerGradient) {
					JCT.theme.applyHeaderGradient(changes.headerGradient.newValue);
				}
				if (area === 'sync' && changes.semesterColors) {
					JCT.state.semesterColors = changes.semesterColors.newValue;
					JCT.courses.ensureStructureAndColor();
					JCT.courses.applyCoursePageColors();
				}
				if (area === 'sync' && changes.favoriteCourseIds) {
					const arr = Array.isArray(changes.favoriteCourseIds.newValue) ? changes.favoriteCourseIds.newValue : [];
					JCT.state.favoriteCourseIds = new Set(arr.map(String));
					JCT.courses.refreshFavoritesUI();
				}
				if ((area === 'local' || area === 'sync') && changes.courseSchedules) {
					JCT.state.courseSchedules = changes.courseSchedules.newValue || {};
					JCT.schedule.updateWeeklyScheduleView();
				}
				if (area === 'sync' && changes.columnCount) {
					JCT.state.currentColumnCount = changes.columnCount.newValue || DEFAULT_COLUMN_COUNT;
					document.documentElement.style.setProperty('--jct-columns', String(JCT.state.currentColumnCount));
				}
				if (area === 'sync' && changes.viewMode) {
					JCT.courses.applyViewMode(changes.viewMode.newValue || 'grid');
				}
				if (area === 'sync' && changes.cardStyle) {
					JCT.courses.applyCardStyle(changes.cardStyle.newValue || 'compact');
				}
			});
		}

		document.addEventListener(
			'click',
			(e) => {
				const favBtn = e.target.closest('.jct-fav-toggle');
				if (favBtn) {
					e.stopPropagation();
					e.preventDefault();
					const card = favBtn.closest(CARD_CLOSEST_SELECTOR);
					if (card) {
						JCT.storage.toggleFavorite(getCourseIdFromCard(card));
					}
					return;
				}

				const scheduleBtn = e.target.closest('.jct-schedule-btn');
				if (scheduleBtn) {
					e.stopPropagation();
					e.preventDefault();
					const card = scheduleBtn.closest(CARD_CLOSEST_SELECTOR);
					if (card) {
						const courseId = getCourseIdFromCard(card);
						JCT.schedule.showScheduleDayPicker(courseId, card);
					}
				}
			},
			true
		);
	}

	JCT.main = {
		addActionButtons,
		scheduleLightUpdate
	};

	docReady(async () => {
		const html = document.documentElement;
		html.classList.add('jct-moodle-redesign');
		if (html.dir === 'rtl') html.classList.add('jct-rtl');

		await Promise.all([
			JCT.storage.loadThemeMode(),
			JCT.storage.loadHeaderGradient(),
			JCT.storage.loadSemesterColors(),
			JCT.storage.loadFavorites(),
			JCT.storage.loadCourseSchedules(),
			JCT.storage.loadViewMode()
		]);

		JCT.theme.applyTheme(JCT.state.themeMode);
		JCT.theme.applyHeaderGradient(JCT.state.headerGradient);
		JCT.theme.ensureNavbarToggle();

		JCT.courses.removeUnwantedCourses();
		JCT.courses.hideFrontClutter();
		JCT.courses.markCoursesContainers();
		JCT.courses.setupCourseSearchBox();
		JCT.courses.ensureStructureAndColor();
		JCT.courses.applyViewMode(JCT.state.currentViewMode);
		JCT.courses.applyCardStyle(JCT.state.currentCardStyle);
		JCT.courses.relocateTopBlocksAfterCourses();
		await JCT.schedule.createWeeklyScheduleView();
		addActionButtons();
		JCT.courses.applyCoursePageColors();

		if (
			window.location.href.includes('/mod/assign/view.php') ||
			window.location.href.includes('/mod/vpl/view.php')
		) {
			const assignmentId = new URLSearchParams(window.location.search).get('id');
			if (assignmentId) {
				JCT.storage.clearSubmissionStatusForAssignment(assignmentId);
			}
		}

		setupGlobalListeners();
		JCT.modals.checkAndShowWhatsNew();
	});
})(window.JCT = window.JCT || {});
