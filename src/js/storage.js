(function (JCT) {
	'use strict';

	const { CACHE_TTL_MS, SCAN_STALE_MS, DEFAULT_COLUMN_COUNT } = JCT.config;

	function storageGet(area, keys) {
		return new Promise((resolve) => {
			try {
				chrome.storage[area].get(keys, (res) => {
					if (chrome.runtime.lastError) {
						console.error(`[JCT Storage] get(${area}) error:`, chrome.runtime.lastError);
						resolve(typeof keys === 'object' && !Array.isArray(keys) ? { ...keys } : {});
						return;
					}
					resolve(res || {});
				});
			} catch (err) {
				console.error(`[JCT Storage] get(${area}) exception:`, err);
				resolve(typeof keys === 'object' && !Array.isArray(keys) ? { ...keys } : {});
			}
		});
	}

	function storageSet(area, data) {
		return new Promise((resolve) => {
			try {
				chrome.storage[area].set(data, () => {
					if (chrome.runtime.lastError) {
						console.error(`[JCT Storage] set(${area}) error:`, chrome.runtime.lastError);
						resolve(false);
						return;
					}
					resolve(true);
				});
			} catch (err) {
				console.error(`[JCT Storage] set(${area}) exception:`, err);
				resolve(false);
			}
		});
	}

	// ---- Theme Mode ('light' | 'dark' | 'auto') & Header Gradient ----

	async function loadThemeMode() {
		const res = await storageGet('sync', { themeMode: 'light' });
		JCT.state.themeMode = res.themeMode || 'light';
		return JCT.state.themeMode;
	}

	async function loadHeaderGradient() {
		const res = await storageGet('sync', { headerGradient: null });
		JCT.state.headerGradient =
			Array.isArray(res.headerGradient) && res.headerGradient.length >= 2
				? [res.headerGradient[0], res.headerGradient[1]]
				: JCT.config.DEFAULT_HEADER_GRADIENT.slice();
		return JCT.state.headerGradient;
	}

	// ---- Semester Colors (3 colors across all years: [אלול, א', ב']) ----

	async function loadSemesterColors() {
		const res = await storageGet('sync', { semesterColors: null });
		JCT.state.semesterColors =
			Array.isArray(res.semesterColors) && res.semesterColors.length >= 3
				? res.semesterColors
				: null;
		return JCT.state.semesterColors;
	}

	// ---- Favorites ----

	async function loadFavorites() {
		const res = await storageGet('sync', { favoriteCourseIds: [] });
		const arr = Array.isArray(res.favoriteCourseIds) ? res.favoriteCourseIds : [];
		JCT.state.favoriteCourseIds = new Set(arr.map(String));
		return JCT.state.favoriteCourseIds;
	}

	function saveFavorites() {
		return storageSet('sync', { favoriteCourseIds: Array.from(JCT.state.favoriteCourseIds) });
	}

	function isFavorite(courseId) {
		return Boolean(courseId && JCT.state.favoriteCourseIds.has(String(courseId)));
	}

	function toggleFavorite(courseId) {
		if (!courseId) return;
		const key = String(courseId);
		if (JCT.state.favoriteCourseIds.has(key)) {
			JCT.state.favoriteCourseIds.delete(key);
		} else {
			JCT.state.favoriteCourseIds.add(key);
		}
		saveFavorites();
		if (JCT.courses?.refreshFavoritesUI) {
			JCT.courses.refreshFavoritesUI();
		}
	}

	// ---- Course Schedules ----

	let isSavingSchedules = false;
	let pendingSaveResolvers = [];

	function migrateSchedules() {
		const schedules = JCT.state.courseSchedules;
		Object.keys(schedules).forEach((courseId) => {
			let entry = schedules[courseId];
			if (!entry) {
				delete schedules[courseId];
				return;
			}
			if (Array.isArray(entry)) {
				entry = { days: entry, name: `קורס ${courseId}` };
				schedules[courseId] = entry;
			}
			if (Array.isArray(entry.days) && !entry.sessions) {
				entry.sessions = entry.days.map((day) => ({
					day,
					startTime: '',
					endTime: ''
				}));
				delete entry.days;
			}
			if (Array.isArray(entry.sessions) && entry.sessions.length === 0) {
				delete schedules[courseId];
			}
		});
	}

	async function loadCourseSchedules() {
		let res = await storageGet('local', { courseSchedules: null });
		if (res.courseSchedules == null) {
			const syncRes = await storageGet('sync', { courseSchedules: {} });
			res = syncRes;
		}
		JCT.state.courseSchedules = res.courseSchedules || {};
		const before = JSON.stringify(JCT.state.courseSchedules);
		migrateSchedules();
		if (before !== JSON.stringify(JCT.state.courseSchedules)) {
			await saveCourseSchedules();
		}
		return JCT.state.courseSchedules;
	}

	function saveCourseSchedules() {
		return new Promise((resolve) => {
			pendingSaveResolvers.push(resolve);
			if (isSavingSchedules) return;

			const flush = async () => {
				isSavingSchedules = true;
				const resolvers = pendingSaveResolvers.splice(0);
				try {
					const copy = JSON.parse(JSON.stringify(JCT.state.courseSchedules));
					const ok = await storageSet('local', { courseSchedules: copy });
					if (!ok) {
						await storageSet('sync', { courseSchedules: copy });
					}
				} finally {
					isSavingSchedules = false;
					resolvers.forEach(fn => fn());
					if (pendingSaveResolvers.length > 0) {
						flush();
					}
				}
			};
			flush();
		});
	}

	// ---- View Mode & Display Settings ----

	async function loadViewMode() {
		const res = await storageGet('sync', {
			viewMode: 'grid',
			cardStyle: 'compact',
			columnCount: DEFAULT_COLUMN_COUNT,
			hideWeeklySchedule: false,
			hideTodo: false
		});
		JCT.state.currentViewMode = res.viewMode || 'grid';
		JCT.state.currentCardStyle = res.cardStyle || 'compact';
		JCT.state.currentColumnCount = res.columnCount || DEFAULT_COLUMN_COUNT;
		JCT.state.hideWeeklySchedule = Boolean(res.hideWeeklySchedule);
		JCT.state.hideTodo = Boolean(res.hideTodo);
		document.documentElement.style.setProperty('--jct-columns', String(JCT.state.currentColumnCount));
		return res;
	}

	// ---- Assignments, Due Dates, Submission Status & Grades Caches ----

	async function getAssignmentsCache() {
		const res = await storageGet('local', {
			assignmentsCache: null,
			assignmentsCacheTimestamp: 0,
			assignmentsScanningInProgress: false,
			assignmentsScanningStartedAt: 0
		});
		const stale = res.assignmentsScanningInProgress &&
			res.assignmentsScanningStartedAt > 0 &&
			(Date.now() - res.assignmentsScanningStartedAt) > SCAN_STALE_MS;

		return {
			cache: res.assignmentsCache,
			timestamp: res.assignmentsCacheTimestamp || 0,
			scanningInProgress: stale ? false : Boolean(res.assignmentsScanningInProgress)
		};
	}

	function saveAssignmentsCache(assignments, courses) {
		return storageSet('local', {
			assignmentsCache: {
				assignments,
				courses: Array.from(courses.entries())
			},
			assignmentsCacheTimestamp: Date.now(),
			assignmentsScanningInProgress: false,
			assignmentsScanningStartedAt: 0
		});
	}

	function setScanningInProgress(inProgress) {
		return storageSet('local', {
			assignmentsScanningInProgress: Boolean(inProgress),
			assignmentsScanningStartedAt: inProgress ? Date.now() : 0
		});
	}

	function isCacheValid(timestamp) {
		return Boolean(timestamp) && (Date.now() - timestamp) < CACHE_TTL_MS;
	}

	async function getDueDateCache() {
		const res = await storageGet('local', { dueDateCache: {} });
		return res.dueDateCache || {};
	}

	async function mergeDueDateCache(updates) {
		if (!updates || Object.keys(updates).length === 0) return;
		const existing = await getDueDateCache();
		Object.assign(existing, updates);
		await storageSet('local', { dueDateCache: existing });
	}

	async function getSubmissionStatusCache() {
		const res = await storageGet('local', { submissionStatusCache: {} });
		return res.submissionStatusCache || {};
	}

	async function mergeSubmissionStatusCache(updates) {
		if (!updates || Object.keys(updates).length === 0) return;
		const existing = await getSubmissionStatusCache();
		Object.assign(existing, updates);
		await storageSet('local', { submissionStatusCache: existing });
	}

	async function clearSubmissionStatusForAssignment(assignmentId) {
		if (!assignmentId) return;
		const cache = await getSubmissionStatusCache();
		let changed = false;
		const exactKey = `submission_status_${assignmentId}`;
		if (exactKey in cache) {
			delete cache[exactKey];
			changed = true;
		}
		Object.keys(cache).forEach((key) => {
			if (key.endsWith(`_${assignmentId}`) || key.endsWith(`-${assignmentId}`)) {
				delete cache[key];
				changed = true;
			}
		});
		if (changed) {
			await storageSet('local', { submissionStatusCache: cache });
		}
	}

	function clearAllAssignmentCaches() {
		return storageSet('local', {
			assignmentsCache: null,
			assignmentsCacheTimestamp: 0,
			dueDateCache: {},
			submissionStatusCache: {}
		});
	}

	// ---- Custom Events & TODOs ----

	async function getCustomEvents() {
		const res = await storageGet('local', { customEvents: [] });
		return Array.isArray(res.customEvents) ? res.customEvents : [];
	}

	function saveCustomEvents(customEvents) {
		return storageSet('local', { customEvents });
	}

	async function getTodos() {
		const res = await storageGet('local', { todoList: [] });
		return Array.isArray(res.todoList) ? res.todoList : [];
	}

	function saveTodos(todoList) {
		return storageSet('local', { todoList });
	}

	JCT.storage = {
		storageGet,
		storageSet,
		loadThemeMode,
		loadHeaderGradient,
		loadSemesterColors,
		loadFavorites,
		saveFavorites,
		isFavorite,
		toggleFavorite,
		loadCourseSchedules,
		saveCourseSchedules,
		loadViewMode,
		getAssignmentsCache,
		saveAssignmentsCache,
		setScanningInProgress,
		isCacheValid,
		getDueDateCache,
		mergeDueDateCache,
		getSubmissionStatusCache,
		mergeSubmissionStatusCache,
		clearSubmissionStatusForAssignment,
		clearAllAssignmentCaches,
		getCustomEvents,
		saveCustomEvents,
		getTodos,
		saveTodos
	};
})(window.JCT = window.JCT || {});
